import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowsOut,
  CaretDoubleLeft,
  CaretDown,
  CaretRight,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Plus,
  TreeStructure,
  X,
  type Icon,
} from "@phosphor-icons/react"
import { NODE_W, type Place } from "../../lib/runGraph"
import { openContextMenu } from "../../lib/ui"

/**
 * A node editor, as Blender's: nodes with a header and rows, a socket on the
 * edge of each row, and thin wires from an output socket to an input socket.
 *
 * NOTHING IS WRITTEN ON A WIRE. What a node sends is its output row; the state
 * of an input is written on the input's row, beside its socket. The wire only
 * says the state by how it is drawn:
 *
 *   missing   dashed grey, and the socket it lands on is hollow
 *   pending   the socket's colour, dimmed
 *   reading   the socket's colour, flowing
 *   read      the socket's colour
 *   failed    the error colour
 *
 * HOW THE BOARD IS HANDLED, in Blender's gestures and nobody else's:
 *
 *   drag the ground      a box; what it touches is selected
 *   Shift while boxing   added to what was selected
 *   drag a header        moves it, and everything else selected with it
 *   middle / Alt / Space drag the ground to pan
 *   wheel                zoom about the pointer
 *   A · Alt+A            select all · select none
 *   H                    fold what is selected, or unfold it
 *   X · Delete           take what is selected off the board
 *   Shift+A              put a card that was taken off back, under the pointer
 *   pull a socket        a wire, from a card that can send one onto another card
 *   press a wire         selects it, where it is one the reader may cut; X cuts it
 *   Home · .             frame everything · frame what is selected
 *
 * THE PORTS THAT PULL ARE THE ONES THE CALLER SAYS CAN, AND ONLY THOSE. A node
 * marked `connectable` has an output socket that can be pulled onto another
 * node, and an edge marked `removable` can be selected and cut; whether a pair
 * means anything is the caller's to say. Every other socket is a mark that
 * takes no pointer: a socket that looked draggable and refused would promise a
 * freedom that does not exist.
 *
 * A CARD TAKEN OFF IS NOT A VALUE TAKEN AWAY. The socket its wire landed on
 * stays where it was, hollow, as an unconnected socket does in Blender: what
 * that input is now is for whoever draws the canvas to write on its row. The
 * card itself goes to the foot of the list, which is where it is put back from.
 *
 * THE CHROME FLOATS AND THE BOARD DOES NOT STOP AT IT. A list of the nodes at
 * one side, a pill of tabs at the foot, the zoom at the other corner: rounded,
 * over the ground, taking no row or column from it, so the whole area is board
 * at every size. What they cover is given back by framing, which fits into the
 * clear part rather than the whole rectangle.
 *
 * THE LIST AND THE TABS ARE THE SAME BOARD, from two other angles: the list
 * names every node whether or not it is in view, and a tab puts a reading of
 * the board under it without leaving the editor. Both are given their contents
 * by whoever draws the canvas -- this file knows how a board is handled, not
 * what any particular board is about.
 */

export type EdgeState = "missing" | "pending" | "reading" | "read" | "failed"

/** The fixed geometry that places sockets without measuring rows. */
const HEAD_H = 26
const ROW_H = 22
const BODY_PAD = 4
const SOCKET = 10

const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.2
const FIT_PAD = 32
/** A frame of one node would otherwise fill the area with a single card. */
const PICK_ZOOM = 1.4
const STEP = 1.25

const SIDEBAR_W = 168
const DRAWER_H = 280
/** What the pill at the foot covers: its height, the air under it, and the air above it. */
const PILL_BAND = 54

export interface CanvasSocket {
  id: string
  label: string
  /** The socket's colour: what kind of value passes through it. */
  colour: string
  /** Written at the row's other end, in `noteColour`. */
  note?: string
  noteColour?: string
}

export interface CanvasNode {
  id: string
  place: Place
  h: number
  title: string
  /** The header's colour: which kind of node. */
  head: string
  output?: CanvasSocket
  inputs?: readonly CanvasSocket[]
  children?: React.ReactNode
  /** Whether this node's output socket can be pulled onto another node. */
  connectable?: boolean
}

export interface CanvasEdge {
  from: string
  to: string
  /** Which input of `to` the wire lands on. */
  socket: string
  colour: string
  state: EdgeState
  /** A wire the reader may cut: pressed, it is selected, and X or Delete takes it away through onDisconnect. */
  removable?: boolean
}

/** A card that was taken off the board: enough of it to name it where it can be put back. */
export interface CanvasRemoved {
  id: string
  title: string
  head: string
}

/** What the editor may ask of the board from outside a gesture: its header's menus are not on it. */
export interface CanvasApi {
  frame: () => void
  /** The selected cards, and the selected wire as "from>to". */
  picked: () => readonly string[]
  wire: () => string | null
  /** What X does: cuts the selected wire, or takes the selected cards off. */
  remove: () => void
}

/** One group in the list down the side: a band of the board, named. */
export interface CanvasSection {
  id: string
  label: string
  ids: readonly string[]
}

/**
 * What a tab's body is given: the board it is a reading OF, so a row in it can
 * take you to the card it is about rather than leaving you to find it.
 */
export interface CanvasBoard {
  picked: ReadonlySet<string>
  select: (ids: readonly string[]) => void
  frame: (ids?: ReadonlySet<string>) => void
}

/** One tab in the pill at the foot, holding a reading of the board it belongs to. */
export interface CanvasTab {
  id: string
  label: string
  icon?: Icon
  /** How many things in it want attention; nothing is drawn for 0. */
  badge?: number
  /** True where the body is as tall as what is in it, rather than the full drawer. */
  hug?: boolean
  body: ReactNode | ((board: CanvasBoard) => ReactNode)
}

interface View {
  x: number
  y: number
  z: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const NONE: ReadonlySet<string> = new Set<string>()

/** What a node covers on the board: its header alone while folded. */
function boxOf(n: CanvasNode, folded: ReadonlySet<string>) {
  return { x: n.place.x, y: n.place.y, w: NODE_W, h: folded.has(n.id) ? HEAD_H : n.h }
}

/** Where a node's sockets are, in board units: rows when open, the header's middle when folded. */
function outputY(n: CanvasNode, folded: boolean): number {
  return n.place.y + (folded ? HEAD_H / 2 : HEAD_H + BODY_PAD + ROW_H / 2)
}

function inputY(n: CanvasNode, index: number, folded: boolean): number {
  if (folded) return n.place.y + HEAD_H / 2
  return n.place.y + HEAD_H + BODY_PAD + (n.output ? ROW_H : 0) + index * ROW_H + ROW_H / 2
}

function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const reach = clamp(Math.abs(x2 - x1) * 0.5, 30, 160)
  return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`
}

function Socket({ colour, hollow, side }: { colour: string; hollow?: boolean; side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className="absolute top-1/2 rounded-full"
      style={{
        width: SOCKET,
        height: SOCKET,
        marginTop: -SOCKET / 2,
        [side]: -SOCKET / 2,
        background: hollow ? "var(--s-panel)" : colour,
        boxShadow: `0 0 0 1px ${hollow ? colour : "rgb(0 0 0 / 0.55)"}`,
      }}
    />
  )
}

// ---- The list's state, kept in this browser -------------------------------------------

const LIST_KEY = "terra-energy.graph.list"

const readList = () => {
  try {
    return localStorage.getItem(LIST_KEY) !== "closed"
  } catch {
    return true
  }
}

const writeList = (open: boolean) => {
  try {
    localStorage.setItem(LIST_KEY, open ? "open" : "closed")
  } catch {
    /* a convenience: the list opens again next time */
  }
}

/*
  A floating thing on the board: raised surface, a hairline of light around it
  and a shadow under it, so it reads as ABOVE the ground rather than as a strip
  cut out of it. One declaration, because the list, the drawer and both pills
  are the same object at different sizes.
*/
const floating = "rounded-xl backdrop-blur-sm"
const FLOAT_STYLE: React.CSSProperties = {
  background: "color-mix(in srgb, var(--s-panel) 92%, transparent)",
  boxShadow: "0 0 0 1px rgb(255 255 255 / 0.07), 0 10px 28px -12px rgb(0 0 0 / 0.85)",
}
/** The chosen tab, lifted out of the pill it sits in. */
const raised: React.CSSProperties = {
  background: "var(--s-float)",
  boxShadow: "0 1px 3px rgb(0 0 0 / 0.35)",
}

export function NodeCanvas({
  nodes,
  edges,
  onMove,
  onMeasure,
  onRemove,
  onRestore,
  removed,
  onConnect,
  onDisconnect,
  api,
  sections,
  tabs,
}: {
  nodes: readonly CanvasNode[]
  edges: readonly CanvasEdge[]
  onMove: (id: string, place: Place) => void
  onMeasure?: (id: string, h: number) => void
  /** Take these cards off the board. Without it nothing on the board can be removed. */
  onRemove?: (ids: readonly string[]) => void
  /** Put one back: where it was, or at the given place. */
  onRestore?: (id: string, place?: Place) => void
  /** The cards taken off, for the list and the Add menu to put back. */
  removed?: readonly CanvasRemoved[]
  /** A socket was pulled onto a node. The caller says whether that pair means anything. */
  onConnect?: (from: string, to: string) => void
  /** A removable wire was selected and cut. */
  onDisconnect?: (from: string, to: string) => void
  api?: React.RefObject<CanvasApi | null>
  /** The bands of the board, for the list down the side. Without them there is no list. */
  sections?: readonly CanvasSection[]
  /** What the pill at the foot can show under the board, beside the board itself. */
  tabs?: readonly CanvasTab[]
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>({ x: FIT_PAD, y: FIT_PAD, z: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  // Once the reader has panned, zoomed or moved a node, the view is theirs and is not refitted.
  const touched = useRef(false)
  const placesRef = useRef(nodes)
  placesRef.current = nodes
  const [folded, setFolded] = useState<ReadonlySet<string>>(NONE)
  const foldedRef = useRef(folded)
  foldedRef.current = folded
  const [picked, setPicked] = useState<ReadonlySet<string>>(NONE)
  const pickedRef = useRef(picked)
  pickedRef.current = picked
  const [list, setList] = useState(readList)
  const [tab, setTab] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // Whose keys these are: the board under the pointer, as the window's keymap decides its own scope.
  const over = useRef(false)
  const space = useRef(false)
  // Where the pointer is, for a menu opened from the keyboard to open under it.
  const pointer = useRef({ x: 0, y: 0 })
  // Set by a removal or a return, so the board is not taken for a different one.
  const edited = useRef(false)
  const removeRef = useRef(onRemove)
  removeRef.current = onRemove
  const restoreRef = useRef(onRestore)
  restoreRef.current = onRestore
  const removedRef = useRef(removed)
  removedRef.current = removed
  const disconnectRef = useRef(onDisconnect)
  disconnectRef.current = onDisconnect
  // The selected wire, as "from>to": one at a time, and never together with cards.
  const [wire, setWire] = useState<string | null>(null)
  const wireRef = useRef(wire)
  wireRef.current = wire
  // The line being pulled, in board units. State, because nothing else draws it.
  const [pulling, setPulling] = useState<{ from: string; x: number; y: number } | null>(null)

  const openTab = tabs?.find((t) => t.id === tab) ?? null

  /*
    What the floating chrome covers. Framing fits the board into what is left,
    so a card is never placed under the list or behind the pill -- the price of
    chrome that floats is that the fit has to know it is there.
  */
  const inset = useRef({ left: FIT_PAD, bottom: FIT_PAD })
  inset.current = {
    left: sections?.length && list ? SIDEBAR_W + 20 : FIT_PAD,
    bottom: PILL_BAND + (openTab ? DRAWER_H + 8 : 0),
  }

  /** Fit the whole board, or just the given nodes, into the area. */
  const frame = useCallback((ids?: ReadonlySet<string>) => {
    const host = hostRef.current
    const shown = placesRef.current.filter((n) => !ids || ids.has(n.id))
    if (!host || !shown.length) return
    const w = host.clientWidth
    const h = host.clientHeight
    if (!w || !h) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of shown) {
      const b = boxOf(n, foldedRef.current)
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.w)
      maxY = Math.max(maxY, b.y + b.h)
    }
    const gw = maxX - minX
    const gh = maxY - minY
    // An area too small for the chrome's share of it is fitted as if bare.
    const room = w - inset.current.left - FIT_PAD > 120 && h - FIT_PAD - inset.current.bottom > 120
    const left = room ? inset.current.left : FIT_PAD
    const bottom = room ? inset.current.bottom : FIT_PAD
    const availW = w - left - FIT_PAD
    const availH = h - FIT_PAD - bottom
    const z = clamp(Math.min(availW / gw, availH / gh), MIN_ZOOM, ids ? PICK_ZOOM : 1)
    setView({ z, x: left + (availW - gw * z) / 2 - minX * z, y: FIT_PAD + (availH - gh * z) / 2 - minY * z })
  }, [])

  const fit = useCallback(() => frame(), [frame])

  /** In or out about the middle of the area, which is what a button can mean by zoom. */
  const zoomBy = useCallback((factor: number) => {
    const host = hostRef.current
    if (!host) return
    touched.current = true
    const px = host.clientWidth / 2
    const py = host.clientHeight / 2
    setView((v) => {
      const z = clamp(v.z * factor, MIN_ZOOM, MAX_ZOOM)
      return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z }
    })
  }, [])

  // A different graph is a different board: fitted afresh, and nothing carried over.
  const shape = nodes.map((n) => n.id).join(",")
  useLayoutEffect(() => {
    if (edited.current) {
      // A card taken off or put back is the same board: the view stays where the reader left it.
      edited.current = false
      const here = new Set(placesRef.current.map((n) => n.id))
      setPicked((prev) => ([...prev].every((id) => here.has(id)) ? prev : new Set([...prev].filter((id) => here.has(id)))))
      return
    }
    touched.current = false
    setPicked(NONE)
    fit()
  }, [shape, fit])

  const sizes = nodes.map((n) => Math.round(n.h)).join(",")
  useLayoutEffect(() => {
    if (!touched.current) fit()
  }, [sizes, fit])

  // Nodes are measured as drawn, so a column is laid out and fitted by what is actually there.
  const measureRef = useRef(onMeasure)
  measureRef.current = onMeasure
  const watched = useRef(new Map<Element, string>())
  const nodeSizes = useRef<ResizeObserver | null>(null)
  if (nodeSizes.current === null && typeof ResizeObserver !== "undefined") {
    nodeSizes.current = new ResizeObserver((entries) => {
      for (const e of entries) {
        const id = watched.current.get(e.target)
        if (!id) continue
        const box = e.borderBoxSize?.[0]
        measureRef.current?.(id, box ? box.blockSize : e.contentRect.height)
      }
    })
  }
  useEffect(() => () => nodeSizes.current?.disconnect(), [])
  const watch = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      const ro = nodeSizes.current
      if (!ro) return
      for (const [node, seen] of watched.current) {
        if (seen === id && node !== el) {
          ro.unobserve(node)
          watched.current.delete(node)
        }
      }
      if (el) {
        watched.current.set(el, id)
        ro.observe(el)
      }
    },
    []
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => {
      if (!touched.current) fit()
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [fit])

  // Not a React handler: React registers wheel as passive, and the page must not scroll under a zoom.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      touched.current = true
      const rect = host.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      setView((v) => {
        const z = clamp(v.z * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM)
        return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z }
      })
    }
    host.addEventListener("wheel", onWheel, { passive: false })
    return () => host.removeEventListener("wheel", onWheel)
  }, [])

  // ---- What is selected, and what is folded -------------------------------------------

  const selectAll = useCallback((ids: readonly string[]) => setPicked(new Set(ids)), [])

  const pick = useCallback((id: string, additive: boolean) => {
    setPicked((prev) => {
      if (!additive) return prev.size === 1 && prev.has(id) ? prev : new Set([id])
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  /** All folded becomes all open; anything else becomes all folded. */
  const toggleFold = useCallback((ids: readonly string[]) => {
    if (!ids.length) return
    setFolded((prev) => {
      const next = new Set(prev)
      const allFolded = ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allFolded) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [])

  const remove = useCallback((ids: readonly string[]) => {
    const take = removeRef.current
    if (!take || !ids.length) return
    edited.current = true
    touched.current = true
    take(ids)
  }, [])

  const restore = useCallback((id: string, place?: Place) => {
    const put = restoreRef.current
    if (!put) return
    edited.current = true
    touched.current = true
    put(id, place)
    setPicked(new Set([id]))
  }, [])

  /** A selected wire is what X is about; with none, the selected cards are. */
  const removeSelection = useCallback(() => {
    if (wireRef.current && disconnectRef.current) {
      const [from, to] = wireRef.current.split(">")
      disconnectRef.current(from, to)
      setWire(null)
      return true
    }
    if (!pickedRef.current.size || !removeRef.current) return false
    remove([...pickedRef.current])
    return true
  }, [remove])

  useEffect(() => {
    if (!api) return
    api.current = {
      frame: () => {
        touched.current = false
        frame()
      },
      picked: () => [...pickedRef.current],
      wire: () => wireRef.current,
      remove: () => void removeSelection(),
    }
    return () => {
      api.current = null
    }
  }, [api, frame, removeSelection])

  /** Blender's Add menu: what is not on the board, put under the pointer when chosen. */
  const openAdd = useCallback(() => {
    const host = hostRef.current
    if (!host || !restoreRef.current) return
    const at = pointer.current
    const rect = host.getBoundingClientRect()
    const v = viewRef.current
    const place = { x: (at.x - rect.left - v.x) / v.z - NODE_W / 2, y: (at.y - rect.top - v.y) / v.z - HEAD_H / 2 }
    const gone = removedRef.current ?? []
    openContextMenu(
      { clientX: at.x, clientY: at.y },
      gone.length
        ? gone.map((n) => ({ type: "action" as const, label: n.title, run: () => restore(n.id, place) }))
        : [{ type: "action" as const, label: "Every card is on the board", run: () => {}, disabled: "Nothing has been taken off this board" }],
      "Add"
    )
  }, [restore])

  useEffect(() => {
    const letter = (e: KeyboardEvent) => (e.code.startsWith("Key") ? e.code.slice(3) : e.code)
    const onKey = (e: KeyboardEvent) => {
      if (!over.current || e.defaultPrevented || e.repeat) return
      const target = e.target as HTMLElement | null
      // A field inside a node is a field first: what is typed there stays there.
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      if (e.code === "Space") {
        space.current = true
        return
      }
      const key = letter(e)
      const all = placesRef.current.map((n) => n.id)
      const sel = pickedRef.current
      if ((e.metaKey || e.ctrlKey) && key === "A") {
        e.preventDefault()
        setPicked(new Set(all))
        return
      }
      if (e.metaKey || e.ctrlKey) return
      switch (key) {
        case "A":
          e.preventDefault()
          if (e.shiftKey) openAdd()
          else setPicked(e.altKey ? NONE : new Set(all))
          return
        case "X":
        case "Delete":
        case "Backspace":
          if (removeSelection()) e.preventDefault()
          return
        case "Escape":
          setPicked(NONE)
          setWire(null)
          return
        case "H":
          if (!sel.size) return
          e.preventDefault()
          toggleFold([...sel])
          return
        case "Home":
          e.preventDefault()
          touched.current = false
          frame()
          return
        case "Period":
        case "NumpadDecimal":
          e.preventDefault()
          touched.current = true
          frame(sel.size ? sel : undefined)
          return
        case "Equal":
        case "NumpadAdd":
          e.preventDefault()
          zoomBy(STEP)
          return
        case "Minus":
        case "NumpadSubtract":
          e.preventDefault()
          zoomBy(1 / STEP)
          return
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onUp)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onUp)
    }
  }, [frame, toggleFold, zoomBy, removeSelection, openAdd])

  // ---- Dragging: the ground, a box, or a node and everything with it --------------------

  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; from: View }
    | { kind: "node"; startX: number; startY: number; from: Map<string, Place> }
    | { kind: "box"; startX: number; startY: number; base: ReadonlySet<string> }
    | { kind: "link"; from: string }
    | null
  >(null)
  const [panning, setPanning] = useState(false)

  const beginGround = (e: React.PointerEvent) => {
    const onGround = e.target === e.currentTarget
    // Pan: the middle button anywhere, or the ground with Space or Alt held.
    if (e.button === 1 || (e.button === 0 && onGround && (space.current || e.altKey))) {
      touched.current = true
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, from: view }
      setPanning(true)
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0 || !onGround) return
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const base = additive ? pickedRef.current : NONE
    if (!additive) setPicked(NONE)
    drag.current = { kind: "box", startX: e.clientX, startY: e.clientY, base }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const beginNode = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    touched.current = true
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const sel = pickedRef.current
    let moving: string[]
    if (additive) {
      const next = new Set(sel)
      if (!next.delete(id)) next.add(id)
      setPicked(next)
      moving = next.has(id) ? [...next] : [id]
    } else if (sel.has(id)) {
      // Dragging one of several moves all of them, so a band can be moved as a band.
      moving = [...sel]
    } else {
      setPicked(new Set([id]))
      moving = [id]
    }
    const from = new Map(placesRef.current.filter((n) => moving.includes(n.id)).map((n) => [n.id, n.place] as const))
    drag.current = { kind: "node", startX: e.clientX, startY: e.clientY, from }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  /** Board units for a pointer, which is what a pulled wire is drawn and dropped in. */
  const atBoard = (e: React.PointerEvent) => {
    const rect = hostRef.current?.getBoundingClientRect()
    return rect ? { x: (e.clientX - rect.left - view.x) / view.z, y: (e.clientY - rect.top - view.y) / view.z } : null
  }

  const beginLink = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    touched.current = true
    drag.current = { kind: "link", from: id }
    const at = atBoard(e)
    if (at) setPulling({ from: id, ...at })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === "link") {
      const at = atBoard(e)
      if (at) setPulling({ from: d.from, ...at })
      return
    }
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.kind === "pan") {
      setView({ ...d.from, x: d.from.x + dx, y: d.from.y + dy })
      return
    }
    if (d.kind === "node") {
      for (const [id, place] of d.from) onMove(id, { x: place.x + dx / view.z, y: place.y + dy / view.z })
      return
    }
    const host = hostRef.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    const x0 = d.startX - rect.left
    const y0 = d.startY - rect.top
    const x1 = e.clientX - rect.left
    const y1 = e.clientY - rect.top
    const left = Math.min(x0, x1)
    const top = Math.min(y0, y1)
    setMarquee({ x: left, y: top, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) })
    const ax = (left - view.x) / view.z
    const ay = (top - view.y) / view.z
    const bx = (Math.max(x0, x1) - view.x) / view.z
    const by = (Math.max(y0, y1) - view.y) / view.z
    // Touched, not enclosed: a box drawn over part of a card takes the card.
    const hits = placesRef.current
      .filter((n) => {
        const b = boxOf(n, foldedRef.current)
        return b.x < bx && b.x + b.w > ax && b.y < by && b.y + b.h > ay
      })
      .map((n) => n.id)
    setPicked(new Set([...d.base, ...hits]))
  }

  // A pulled wire ends on the card under the pointer, or nowhere; the caller decides what the pair means.
  const endDrag = (e?: React.PointerEvent) => {
    const d = drag.current
    if (d?.kind === "link" && e) {
      const at = atBoard(e)
      const onto = at
        ? placesRef.current.find((n) => {
            const b = boxOf(n, foldedRef.current)
            return n.id !== d.from && at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h
          })
        : undefined
      if (onto) onConnect?.(d.from, onto.id)
    }
    drag.current = null
    setPanning(false)
    setMarquee(null)
    setPulling(null)
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  // An input is hollow where nothing reaches it: its wire is missing, or the card it came from is off the board.
  const wiredInto = new Set(edges.filter((e) => e.state !== "missing" && byId.has(e.from)).map((e) => `${e.to}>${e.socket}`))

  // ---- The chrome: a list, a drawer and two pills, floating on the board ----------------

  const listed = sections?.length ? sections : null

  const sidebar = listed && list && (
    <aside className={`${floating} absolute bottom-2 left-2 top-2 flex flex-col overflow-hidden`} style={{ ...FLOAT_STYLE, width: SIDEBAR_W }}>
      <div className="flex h-7 shrink-0 items-center justify-between gap-1 pl-2.5 pr-1.5">
        <span className="truncate text-micro text-muted-foreground">Nodes</span>
        <button
          type="button"
          title="Collapse the list"
          aria-label="Collapse the list"
          onClick={() => {
            setList(false)
            writeList(false)
          }}
          className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <CaretDoubleLeft className="size-2.5" weight="bold" />
        </button>
      </div>
      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {listed.map((section) => (
          <div key={section.id}>
            <div className="flex h-5 items-center px-1.5 pt-1">
              <span className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">{section.label}</span>
            </div>
            {section.ids.map((id) => {
              const n = byId.get(id)
              if (!n) return null
              const on = picked.has(id)
              const shut = folded.has(id)
              return (
                <div key={id} className={`flex h-[22px] items-center gap-1 rounded-full pl-1 pr-2 ${on ? "bg-selected" : "hover:bg-hover"}`}>
                  <button
                    type="button"
                    onClick={() => toggleFold([id])}
                    aria-label={shut ? `Unfold ${n.title}` : `Fold ${n.title}`}
                    aria-expanded={!shut}
                    className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                  >
                    {shut ? <CaretRight className="size-2.5" weight="bold" /> : <CaretDown className="size-2.5" weight="bold" />}
                  </button>
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: n.head }} />
                  <button
                    type="button"
                    onClick={(e) => pick(id, e.shiftKey || e.metaKey || e.ctrlKey)}
                    onDoubleClick={() => {
                      touched.current = true
                      frame(new Set([id]))
                    }}
                    title={`${n.title} — double-click to frame it`}
                    className={`min-w-0 flex-1 truncate text-left text-meta ${on ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {n.title}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
        {!!removed?.length && onRestore && (
          <div>
            <div className="flex h-5 items-center px-1.5 pt-1">
              <span className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">Removed</span>
            </div>
            {removed.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => restore(n.id)}
                title={`Put ${n.title} back on the board`}
                className="group flex h-[22px] w-full items-center gap-1 rounded-full pl-6 pr-2 text-left hover:bg-hover"
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full opacity-40" style={{ background: n.head }} />
                <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground/60 group-hover:text-foreground">{n.title}</span>
                <Plus className="size-2.5 shrink-0 text-muted-foreground" weight="bold" />
              </button>
            ))}
          </div>
        )}
    </div>
    </aside>
  )

  const drawerLeft = listed && list ? SIDEBAR_W + 16 : 8

  const pill = (on: boolean) =>
    `flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-meta transition-colors ${
      on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
    }`

  return (
    <div
      className="relative h-full w-full"
      onPointerEnter={() => {
        over.current = true
      }}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerLeave={() => {
        over.current = false
        space.current = false
      }}
    >
      <div
        ref={hostRef}
        onPointerDownCapture={() => setWire(null)}
        onPointerDown={beginGround}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={() => endDrag()}
        className="app-no-drag absolute inset-0 touch-none select-none overflow-hidden"
        style={{
          background: "var(--s-field)",
          backgroundImage: "radial-gradient(rgb(var(--p-line) / 0.45) 1px, transparent 1px)",
          backgroundSize: `${24 * view.z}px ${24 * view.z}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
          cursor: panning ? "grabbing" : "default",
        }}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg width={1} height={1} className="pointer-events-none absolute left-0 top-0 overflow-visible">
            {edges.map((edge) => {
              const a = byId.get(edge.from)
              const b = byId.get(edge.to)
              const index = b?.inputs?.findIndex((s) => s.id === edge.socket) ?? -1
              if (!a || !b || index < 0) return null
              const x1 = a.place.x + NODE_W
              const y1 = outputY(a, folded.has(a.id))
              const x2 = b.place.x
              const y2 = inputY(b, index, folded.has(b.id))
              const d = wirePath(x1, y1, x2, y2)
              const st = edge.state
              const key = `${edge.from}>${edge.to}`
              const selected = wire === key
              const stroke = selected ? "rgb(var(--p-accent))" : st === "failed" ? "var(--node-wire-failed)" : st === "missing" ? "rgb(var(--p-line-strong))" : edge.colour
              return (
                <g key={`${edge.from}-${edge.to}-${edge.socket}`}>
                  {st !== "missing" && <path d={d} fill="none" stroke="rgb(0 0 0 / 0.45)" strokeWidth={4} />}
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={selected ? 3 : st === "missing" ? 1.5 : 2}
                    strokeOpacity={st === "pending" ? 0.5 : st === "missing" ? 0.6 : 1}
                    strokeDasharray={st === "missing" ? "3 4" : st === "reading" ? "8 4" : undefined}
                    className={st === "reading" ? "wire-flow" : undefined}
                  />
                  {edge.removable && onDisconnect && (
                    // What a press lands on: the same curve, wide and invisible.
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={12}
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return
                        e.stopPropagation()
                        setPicked(NONE)
                        setWire(key)
                      }}
                    >
                      <title>Press to select; X or Delete cuts it</title>
                    </path>
                  )}
                </g>
              )
            })}
            {/* The line being pulled: dashed, as a wire that carries nothing is, until it lands. */}
            {pulling && byId.get(pulling.from) && (
              <line
                x1={byId.get(pulling.from)!.place.x + NODE_W}
                y1={outputY(byId.get(pulling.from)!, folded.has(pulling.from))}
                x2={pulling.x}
                y2={pulling.y}
                stroke="rgb(var(--p-accent))"
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
            )}
          </svg>

          {nodes.map((n) => {
            const isFolded = folded.has(n.id)
            const on = picked.has(n.id)
            return (
              <div
                key={n.id}
                ref={watch(n.id)}
                onPointerDown={(e) => {
                  if (e.button === 0) pick(n.id, e.shiftKey || e.metaKey || e.ctrlKey)
                }}
                className="absolute rounded-md"
                style={{
                  left: n.place.x,
                  top: n.place.y,
                  width: NODE_W,
                  background: "var(--node-body)",
                  boxShadow: `0 0 0 1px ${on ? "rgb(255 255 255 / 0.85)" : "rgb(0 0 0 / 0.6)"}, 0 4px 14px -6px rgb(0 0 0 / 0.6)`,
                  zIndex: on ? 1 : undefined,
                }}
              >
                <div
                  onPointerDown={(e) => beginNode(e, n.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={() => endDrag()}
                  className={`relative flex items-center gap-1 pl-1 pr-1.5 text-body text-foreground ${isFolded ? "rounded-md" : "rounded-t-md"}`}
                  style={{ height: HEAD_H, background: n.head }}
                >
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => toggleFold([n.id])}
                    aria-label={isFolded ? `Unfold ${n.title}` : `Fold ${n.title}`}
                    aria-expanded={!isFolded}
                    className="grid size-4 shrink-0 place-items-center rounded-sm text-foreground/80 hover:bg-hover hover:text-foreground"
                  >
                    {isFolded ? <CaretRight className="size-2.5" weight="bold" /> : <CaretDown className="size-2.5" weight="bold" />}
                  </button>
                  <span className="min-w-0 flex-1 cursor-grab truncate active:cursor-grabbing">{n.title}</span>
                  {onRemove && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => remove([n.id])}
                      aria-label={`Remove ${n.title}`}
                      title="Take this card off the board (X)"
                      className="grid size-4 shrink-0 place-items-center rounded-sm text-foreground/60 hover:bg-hover hover:text-foreground"
                    >
                      <X className="size-2.5" weight="bold" />
                    </button>
                  )}
                  {isFolded && n.output && <Socket colour={n.output.colour} side="right" />}
                  {isFolded && !!n.inputs?.length && <Socket colour={n.inputs[0].colour} side="left" />}
                </div>

                {!isFolded && (
                  <div style={{ paddingTop: BODY_PAD }}>
                    {n.output && (
                      <div className="relative flex items-center justify-end gap-2 px-2.5 text-meta" style={{ height: ROW_H }}>
                        <span className="min-w-0 truncate text-foreground" title={n.output.label}>
                          {n.output.label}
                        </span>
                        {n.connectable && onConnect ? (
                          // The one socket that takes a pointer: pulled onto another card.
                          <span
                            role="button"
                            aria-label={`Connect ${n.title}`}
                            title="Pull onto a card to wire it"
                            onPointerDown={(e) => beginLink(e, n.id)}
                            onPointerMove={onPointerMove}
                            onPointerUp={endDrag}
                            onPointerCancel={() => endDrag()}
                            className="absolute top-1/2 z-10 grid cursor-crosshair place-items-center"
                            style={{ width: 16, height: 16, marginTop: -8, right: -8 }}
                          >
                            <span
                              className="rounded-full transition-transform hover:scale-125"
                              style={{ width: SOCKET, height: SOCKET, background: n.output.colour, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.55)" }}
                            />
                          </span>
                        ) : (
                          <Socket colour={n.output.colour} side="right" />
                        )}
                      </div>
                    )}
                    {n.inputs?.map((s) => (
                      <div key={s.id} className="relative flex items-center gap-2 px-2.5 text-meta" style={{ height: ROW_H }}>
                        <Socket colour={s.colour} side="left" hollow={!wiredInto.has(`${n.id}>${s.id}`)} />
                        <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
                        {s.note && (
                          <span className="shrink-0 text-micro" style={{ color: s.noteColour ?? "var(--muted-foreground)" }}>
                            {s.note}
                          </span>
                        )}
                      </div>
                    ))}
                    {n.children && <div className="flex flex-col gap-1 px-2.5 pb-2 pt-1">{n.children}</div>}
                    {!n.children && <div style={{ height: BODY_PAD * 2 }} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {marquee && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-[2px]"
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.w,
              height: marquee.h,
              border: "1px solid rgb(var(--p-accent))",
              background: "rgb(var(--p-accent) / 0.12)",
            }}
          />
        )}
      </div>

      {sidebar}

      {listed && !list && (
        <button
          type="button"
          title="Show the list of nodes"
          onClick={() => {
            setList(true)
            writeList(true)
          }}
          style={FLOAT_STYLE}
          className={`${floating} absolute left-2 top-2 flex h-7 items-center gap-1.5 px-3 text-meta text-muted-foreground hover:text-foreground`}
        >
          <TreeStructure className="size-3.5" />
          <span>Nodes</span>
        </button>
      )}

      {openTab && (
        <div
          className={`${floating} absolute flex flex-col overflow-hidden`}
          style={{
            ...FLOAT_STYLE,
            bottom: PILL_BAND,
            left: drawerLeft,
            /*
              A drawer that hugs is as big as what is in it, in BOTH directions:
              a reading of eight wires in a card the width of the window is
              mostly empty card. One that does not hug -- the console -- is a
              field, and a field takes the room it is given.
            */
            ...(openTab.hug
              ? { width: "max-content", maxWidth: `calc(100% - ${drawerLeft + 8}px)`, maxHeight: DRAWER_H }
              : { right: 8, height: DRAWER_H }),
          }}
        >
          {typeof openTab.body === "function"
            ? openTab.body({
                picked,
                select: selectAll,
                frame: (ids) => {
                  touched.current = true
                  frame(ids)
                },
              })
            : openTab.body}
        </div>
      )}

      <div style={FLOAT_STYLE} className={`${floating} absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 p-1`}>
        <button
          type="button"
          aria-pressed={!tab}
          title="The board — drag the ground to select, Space or Alt to pan, A all, H fold, X remove, Shift+A add, Home frames"
          onClick={() => setTab(null)}
          className={pill(!tab)}
          style={!tab ? raised : undefined}
        >
          <TreeStructure className="size-3.5" weight="bold" />
          <span>Nodes</span>
        </button>
        {tabs?.map((t) => {
          const on = tab === t.id
          const TabIcon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTab(on ? null : t.id)}
              className={pill(on)}
              style={on ? raised : undefined}
            >
              {TabIcon && <TabIcon className="size-3.5" weight={on ? "bold" : "regular"} />}
              <span>{t.label}</span>
              {!!t.badge && (
                <span
                  className="telemetry -mr-1 rounded-full px-1.5 text-[9px] leading-[14px]"
                  style={{ color: "var(--warning)", background: "color-mix(in srgb, var(--warning) 18%, transparent)" }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div style={FLOAT_STYLE} className={`${floating} absolute bottom-2 right-2 flex items-center gap-0.5 p-1`}>
        {picked.size > 1 && (
          <span className="telemetry px-1.5 text-[9px] tabular-nums text-muted-foreground">{picked.size} selected</span>
        )}
        <button
          type="button"
          title="Zoom out (−)"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / STEP)}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <MagnifyingGlassMinus className="size-3.5" />
        </button>
        <button
          type="button"
          title="Back to 100%"
          onClick={() => {
            touched.current = true
            setView((v) => ({ ...v, z: 1 }))
          }}
          className="telemetry h-7 w-10 rounded-full text-center text-[9px] tabular-nums text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          {Math.round(view.z * 100)}%
        </button>
        <button
          type="button"
          title="Zoom in (+)"
          aria-label="Zoom in"
          onClick={() => zoomBy(STEP)}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <MagnifyingGlassPlus className="size-3.5" />
        </button>
        <button
          type="button"
          title={picked.size ? "Frame what is selected (.)" : "Frame all the nodes (Home)"}
          aria-label="Frame"
          onClick={() => {
            touched.current = !!picked.size
            frame(picked.size ? picked : undefined)
          }}
          className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <ArrowsOut className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

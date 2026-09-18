import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowsOut, CaretDown, CaretRight } from "@phosphor-icons/react"
import { NODE_W, type Place } from "../../lib/runGraph"

/**
 * A node editor, as Blender's: nodes with a header and rows, a socket on the
 * edge of each row, and thin wires from an output socket to an input socket.
 * Pan by dragging the ground, zoom with the wheel about the pointer, move a
 * node by its header, fold it with its caret.
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
}

export interface CanvasEdge {
  from: string
  to: string
  /** Which input of `to` the wire lands on. */
  socket: string
  colour: string
  state: EdgeState
}

interface View {
  x: number
  y: number
  z: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

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

export function NodeCanvas({
  nodes,
  edges,
  onMove,
  onMeasure,
}: {
  nodes: readonly CanvasNode[]
  edges: readonly CanvasEdge[]
  onMove: (id: string, place: Place) => void
  onMeasure?: (id: string, h: number) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>({ x: FIT_PAD, y: FIT_PAD, z: 1 })
  // Once the reader has panned, zoomed or moved a node, the view is theirs and is not refitted.
  const touched = useRef(false)
  const placesRef = useRef(nodes)
  placesRef.current = nodes
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const [active, setActive] = useState<string | null>(null)

  const fit = useCallback(() => {
    const host = hostRef.current
    const list = placesRef.current
    if (!host || !list.length) return
    const w = host.clientWidth
    const h = host.clientHeight
    if (!w || !h) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of list) {
      minX = Math.min(minX, n.place.x)
      minY = Math.min(minY, n.place.y)
      maxX = Math.max(maxX, n.place.x + NODE_W)
      maxY = Math.max(maxY, n.place.y + n.h)
    }
    const gw = maxX - minX
    const gh = maxY - minY
    const z = clamp(Math.min((w - FIT_PAD * 2) / gw, (h - FIT_PAD * 2) / gh), MIN_ZOOM, 1)
    setView({ z, x: (w - gw * z) / 2 - minX * z, y: (h - gh * z) / 2 - minY * z })
  }, [])

  // A different graph is a different board: fitted afresh.
  const shape = nodes.map((n) => n.id).join(",")
  useLayoutEffect(() => {
    touched.current = false
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

  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; from: View }
    | { kind: "node"; id: string; startX: number; startY: number; from: Place }
    | null
  >(null)
  const [panning, setPanning] = useState(false)

  const beginPan = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    // A left press only pans from the ground; inside a node it belongs to the node.
    if (e.button === 0 && e.target !== e.currentTarget) return
    touched.current = true
    setActive(null)
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, from: view }
    setPanning(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const beginNode = (e: React.PointerEvent, id: string, place: Place) => {
    if (e.button !== 0) return
    e.stopPropagation()
    touched.current = true
    setActive(id)
    drag.current = { kind: "node", id, startX: e.clientX, startY: e.clientY, from: place }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.kind === "pan") setView({ ...d.from, x: d.from.x + dx, y: d.from.y + dy })
    else onMove(d.id, { x: d.from.x + dx / view.z, y: d.from.y + dy / view.z })
  }

  const endDrag = () => {
    drag.current = null
    setPanning(false)
  }

  const toggleFold = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const missingInto = new Set(edges.filter((e) => e.state === "missing").map((e) => `${e.to}>${e.socket}`))

  return (
    <div
      ref={hostRef}
      onPointerDown={beginPan}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="app-no-drag relative h-full w-full touch-none select-none overflow-hidden"
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
            const stroke = st === "failed" ? "var(--node-wire-failed)" : st === "missing" ? "rgb(var(--p-line-strong))" : edge.colour
            return (
              <g key={`${edge.from}-${edge.to}-${edge.socket}`}>
                {st !== "missing" && <path d={d} fill="none" stroke="rgb(0 0 0 / 0.45)" strokeWidth={4} />}
                <path
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={st === "missing" ? 1.5 : 2}
                  strokeOpacity={st === "pending" ? 0.5 : st === "missing" ? 0.6 : 1}
                  strokeDasharray={st === "missing" ? "3 4" : st === "reading" ? "8 4" : undefined}
                  className={st === "reading" ? "wire-flow" : undefined}
                />
              </g>
            )
          })}
        </svg>

        {nodes.map((n) => {
          const isFolded = folded.has(n.id)
          return (
            <div
              key={n.id}
              ref={watch(n.id)}
              className="absolute rounded-md"
              style={{
                left: n.place.x,
                top: n.place.y,
                width: NODE_W,
                background: "var(--node-body)",
                boxShadow: `0 0 0 1px ${active === n.id ? "rgb(255 255 255 / 0.85)" : "rgb(0 0 0 / 0.6)"}, 0 4px 14px -6px rgb(0 0 0 / 0.6)`,
                zIndex: active === n.id ? 1 : undefined,
              }}
            >
              <div
                onPointerDown={(e) => beginNode(e, n.id, n.place)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className={`relative flex items-center gap-1 pl-1 pr-2 text-body text-foreground ${isFolded ? "rounded-md" : "rounded-t-md"}`}
                style={{ height: HEAD_H, background: n.head }}
              >
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggleFold(n.id)}
                  aria-label={isFolded ? `Unfold ${n.title}` : `Fold ${n.title}`}
                  aria-expanded={!isFolded}
                  className="grid size-4 shrink-0 place-items-center rounded-sm text-foreground/80 hover:bg-hover hover:text-foreground"
                >
                  {isFolded ? <CaretRight className="size-2.5" weight="bold" /> : <CaretDown className="size-2.5" weight="bold" />}
                </button>
                <span className="min-w-0 flex-1 cursor-grab truncate active:cursor-grabbing">{n.title}</span>
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
                      <Socket colour={n.output.colour} side="right" />
                    </div>
                  )}
                  {n.inputs?.map((s) => (
                    <div key={s.id} className="relative flex items-center gap-2 px-2.5 text-meta" style={{ height: ROW_H }}>
                      <Socket colour={s.colour} side="left" hollow={missingInto.has(`${n.id}>${s.id}`)} />
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

      <button
        type="button"
        onClick={() => {
          touched.current = false
          fit()
        }}
        title="Frame all nodes"
        className="absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-sm bg-selected text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ArrowsOut className="size-3.5" />
      </button>
    </div>
  )
}

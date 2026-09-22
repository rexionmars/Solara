import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowsOut, Info, Minus, Plus } from "@phosphor-icons/react"

/**
 * A reading as cards on a ground, rather than as a page inside a panel.
 *
 * WHY A BOARD AND NOT A DOCUMENT. A document has one order, decided by
 * whoever wrote it, and a reader who wants two figures side by side cannot
 * have them. On a board the reader drags the two together, folds away what
 * they are not reading, and zooms out to see the shape of the whole run. The
 * figures are the same; what changes is who chooses the arrangement.
 *
 * WHAT THE BOARD OWNS AND WHAT IT DOES NOT. The board owns the view (pan,
 * zoom, framing), the packing of cards that have not been moved, and the card
 * chrome. It never owns a card's contents: a card is handed a body and draws
 * it at the width it asked for, so a chart inside measures a real width in
 * real pixels and is never a scaled bitmap.
 *
 * THE DEFAULT ARRANGEMENT IS PACKED, NOT PLACED. A card declares a column and
 * a span, not coordinates, and the board stacks each column using the heights
 * it MEASURES. Hand-written coordinates go stale the moment a card grows a
 * row, and two cards then overlap. Once the reader moves anything, the packing
 * stops: the arrangement is theirs from that point.
 */

export type Place = { x: number; y: number }

export interface BoardCard {
  id: string
  /** Absent on a card that is a single figure: the number is its own title. */
  title?: string
  /** How wide the card is drawn, in board units. A chart asks for more than a figure does. */
  w?: number
  /** Drawn at the header's other end: a unit, a scope, a count. */
  right?: ReactNode
  /**
   * What qualifies the figures, behind the header's info button.
   *
   * Not in the body. Prose stacked under a chart is read once and then costs
   * its height forever; the reader who needs it asks for it, and the reader
   * who has already read it never pays again.
   */
  note?: ReactNode
  /** No header rule and a tighter body: a single figure and its label. */
  bare?: boolean
  /**
   * The cards this one is computed FROM. The board draws a wire per entry, so
   * the arrangement says where a figure came from and not only what it is.
   *
   * A name the board does not know is skipped rather than drawn to nowhere.
   */
  from?: readonly string[]
  /** The colour of the wires leaving this card, and of its sockets. */
  tone?: string
  children: ReactNode
}

const MIN_ZOOM = 0.3
const MAX_ZOOM = 2
const PAD = 28
/** Until a card has been measured, the packing assumes this much of it. */
const GUESS_H = 150

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const SOCKET = 4.5
const WIRE = "rgb(var(--p-line-strong))"

type Box = { x: number; y: number; w: number; h: number }

/**
 * Where a wire leaves one card and where it lands on the next.
 *
 * TWO ROUTES, CHOSEN BY GEOMETRY. A card packed to the right of its source is
 * fed from the source's right edge into its own left edge, as a node graph
 * reads. A card packed BELOW its source -- which is what a column of figures
 * derived from one table looks like -- is fed from the bottom into the top,
 * because a left-to-right wire between two stacked cards would have to loop
 * back on itself and would cross every card between them.
 */
function route(a: Box, b: Box): { d: string; x1: number; y1: number; x2: number; y2: number } {
  if (b.x >= a.x + a.w - 8) {
    const x1 = a.x + a.w
    const y1 = a.y + a.h / 2
    const x2 = b.x
    const y2 = b.y + b.h / 2
    const r = clamp(Math.abs(x2 - x1) * 0.5, 26, 130)
    return { d: `M ${x1} ${y1} C ${x1 + r} ${y1}, ${x2 - r} ${y2}, ${x2} ${y2}`, x1, y1, x2, y2 }
  }
  const x1 = a.x + a.w / 2
  const y1 = a.y + a.h
  const x2 = b.x + b.w / 2
  const y2 = b.y
  const r = clamp(Math.abs(y2 - y1) * 0.6, 22, 96)
  return { d: `M ${x1} ${y1} C ${x1} ${y1 + r}, ${x2} ${y2 - r}, ${x2} ${y2}`, x1, y1, x2, y2 }
}

interface View {
  x: number
  y: number
  z: number
}

export function Board({
  cards,
  cardWidth = 214,
  gap = 14,
  /** How tall a depth may grow before it spills into a second sub-column. */
  band = 760,
  /** The clear space between one derivation depth and the next: where the wires live. */
  rank = 76,
  places,
  onMove,
  onReset,
  /** Pinned over the board's top-left, out of the view's transform: what scopes every card. */
  toolbar,
}: {
  cards: readonly BoardCard[]
  cardWidth?: number
  gap?: number
  band?: number
  rank?: number
  /** Where the reader has put a card, by id. A card absent from it is still packed. */
  places?: Readonly<Record<string, Place>>
  onMove?: (id: string, place: Place) => void
  onReset?: () => void
  toolbar?: ReactNode
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>({ x: PAD, y: PAD, z: 1 })
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({})
  const [active, setActive] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  // Once the reader has panned or zoomed, the view is theirs and is not refitted.
  const touched = useRef(false)

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const width = (c: BoardCard) => c.w ?? cardWidth

  /**
   * The default arrangement: a column per derivation depth, left to right.
   *
   * WHY DEPTH AND NOT A MASONRY. Packed by height, the cards make one tall
   * ribbon and every wire is a two-pixel hop between stacked neighbours --
   * which is to say the graph is drawn and cannot be seen. Placed by depth,
   * a wire is a long sweep from one column to the next, so the shape of the
   * derivation is readable from across the room, which is the only reason to
   * draw it at all.
   *
   * A depth wider than the band spills into a second sub-column at the same
   * depth rather than growing without limit: eight figures taken out of one
   * table are eight siblings, not a column eight cards tall that forces the
   * reader to zoom out until nothing can be read.
   *
   * Each depth is centred on a common axis, so a card and the cards it feeds
   * sit across from one another instead of all hanging from the top.
   */
  const packed = useMemo(() => {
    const depth = new Map<string, number>()
    const known = new Set(cards.map((c) => c.id))
    const depthOf = (c: BoardCard, seen: ReadonlySet<string>): number => {
      const had = depth.get(c.id)
      if (had != null) return had
      // A card in its own ancestry would recurse forever; it is treated as a root.
      const parents = (c.from ?? []).filter((id) => known.has(id) && !seen.has(id))
      const next = new Set(seen).add(c.id)
      const d = parents.length
        ? 1 + Math.max(...parents.map((id) => depthOf(byId.get(id)!, next)))
        : 0
      depth.set(c.id, d)
      return d
    }
    for (const c of cards) depthOf(c, new Set())

    const levels = [...new Set(cards.map((c) => depth.get(c.id)!))].sort((a, b) => a - b)
    const out: Record<string, Place> = {}
    let x = 0
    for (const level of levels) {
      const here = cards.filter((c) => depth.get(c.id) === level)
      // Placed into sub-columns first, then shifted as a block once the
      // block's height is known -- it cannot be known before the pass.
      const cols: { w: number; h: number; ids: string[] }[] = [{ w: 0, h: 0, ids: [] }]
      const localY: Record<string, number> = {}
      for (const c of here) {
        let col = cols[cols.length - 1]
        const h = heights[c.id] ?? GUESS_H
        if (col.h > 0 && col.h + h > band) {
          col = { w: 0, h: 0, ids: [] }
          cols.push(col)
        }
        localY[c.id] = col.h
        col.h += h + gap
        col.w = Math.max(col.w, width(c))
        col.ids.push(c.id)
      }
      const blockH = Math.max(...cols.map((c) => c.h - gap))
      let cx = x
      for (const col of cols) {
        for (const id of col.ids) out[id] = { x: cx, y: Math.round(localY[id] - blockH / 2) }
        cx += col.w + gap
      }
      x = cx - gap + rank
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, byId, heights, cardWidth, gap, band, rank])

  const placeOf = useCallback((id: string): Place => places?.[id] ?? packed[id] ?? { x: 0, y: 0 }, [places, packed])

  /** Every card as a rectangle in board units: what a wire is routed between. */
  const boxes = useMemo(() => {
    const out: Record<string, Box> = {}
    for (const c of cards) {
      const p = placeOf(c.id)
      out[c.id] = { x: p.x, y: p.y, w: width(c), h: heights[c.id] ?? GUESS_H }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, placeOf, heights, cardWidth, gap])

  // The fit reads the arrangement as drawn, so it is computed from refs rather
  // than captured: a fit triggered by a resize must not frame a stale board.
  const frameRef = useRef({ cards, placeOf, heights, width })
  frameRef.current = { cards, placeOf, heights, width }

  const fit = useCallback(() => {
    const host = hostRef.current
    const { cards: list, placeOf: at, heights: hs, width: w } = frameRef.current
    if (!host || !list.length) return
    const vw = host.clientWidth
    const vh = host.clientHeight
    if (!vw || !vh) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const c of list) {
      const p = at(c.id)
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + w(c))
      maxY = Math.max(maxY, p.y + (hs[c.id] ?? GUESS_H))
    }
    const gw = maxX - minX
    const gh = maxY - minY
    if (gw <= 0 || gh <= 0) return
    // Never magnified to fill: a board of three cards blown up to 2x reads as
    // a mistake. Shrunk to fit, yes; grown past its natural size, no.
    const z = clamp(Math.min((vw - PAD * 2) / gw, (vh - PAD * 2) / gh), MIN_ZOOM, 1)
    setView({ z, x: (vw - gw * z) / 2 - minX * z, y: (vh - gh * z) / 2 - minY * z })
  }, [])

  // A different set of cards is a different board: framed afresh.
  const shape = cards.map((c) => c.id).join(",")
  useLayoutEffect(() => {
    touched.current = false
    setHeights({})
  }, [shape])

  // Framed again as the cards settle into their measured heights, and whenever
  // the area is resized -- but only while the view is still the board's own.
  const measured = cards.every((c) => heights[c.id] != null)
  useLayoutEffect(() => {
    if (!touched.current) fit()
  }, [measured, shape, fit])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => {
      if (!touched.current) fit()
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [fit])

  // Cards are measured as drawn: a card is as tall as its contents turned out
  // to be, never as tall as a constant said it would be.
  const watched = useRef(new Map<Element, string>())
  const sizes = useRef<ResizeObserver | null>(null)
  if (sizes.current === null && typeof ResizeObserver !== "undefined") {
    sizes.current = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let next: Record<string, number> | null = null
        for (const e of entries) {
          const id = watched.current.get(e.target)
          if (!id) continue
          const box = e.borderBoxSize?.[0]
          const h = Math.round(box ? box.blockSize : e.contentRect.height)
          if (prev[id] === h) continue
          next ??= { ...prev }
          next[id] = h
        }
        return next ?? prev
      })
    })
  }
  useEffect(() => () => sizes.current?.disconnect(), [])

  const watch = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      const ro = sizes.current
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

  // Not a React handler: React registers wheel as passive, and the area behind
  // the board must not scroll under a zoom.
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

  /** Zoom by a step about the board's middle, for the rail rather than the wheel. */
  const step = (factor: number) => {
    const host = hostRef.current
    if (!host) return
    touched.current = true
    const px = host.clientWidth / 2
    const py = host.clientHeight / 2
    setView((v) => {
      const z = clamp(v.z * factor, MIN_ZOOM, MAX_ZOOM)
      return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z }
    })
  }

  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; from: View }
    | { kind: "card"; id: string; startX: number; startY: number; from: Place }
    | null
  >(null)

  const beginPan = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    // A left press only pans from the ground; inside a card it belongs to the card.
    if (e.button === 0 && e.target !== e.currentTarget) return
    touched.current = true
    setActive(null)
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, from: view }
    setPanning(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const beginCard = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    touched.current = true
    setActive(id)
    drag.current = { kind: "card", id, startX: e.clientX, startY: e.clientY, from: placeOf(id) }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.kind === "pan") setView({ ...d.from, x: d.from.x + dx, y: d.from.y + dy })
    else onMove?.(d.id, { x: Math.round(d.from.x + dx / view.z), y: Math.round(d.from.y + dy / view.z) })
  }

  const endDrag = () => {
    drag.current = null
    setPanning(false)
  }

  const frame = () => {
    touched.current = false
    fit()
  }

  return (
    <div
      ref={hostRef}
      onPointerDown={beginPan}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="app-no-drag relative h-full w-full touch-none overflow-hidden"
      style={{
        background: "var(--s-board)",
        backgroundImage: "radial-gradient(rgb(var(--p-line) / 0.34) 1px, transparent 1px)",
        backgroundSize: `${26 * view.z}px ${26 * view.z}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor: panning ? "grabbing" : "default",
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
          // Held back until every card has been measured once, so the reader
          // never sees the guessed packing collapse into the real one.
          opacity: measured ? 1 : 0,
          transition: "opacity 120ms linear",
        }}
      >
        {/*
          The wires, under every card: a wire that crossed OVER a card would
          read as belonging to it. Drawn only once every card has been
          measured, because a route computed from a guessed height lands in
          the middle of nothing.
        */}
        <svg width={1} height={1} className="pointer-events-none absolute left-0 top-0 overflow-visible">
          {measured &&
            cards.flatMap((c) =>
              (c.from ?? []).map((src) => {
                const a = boxes[src]
                const b = boxes[c.id]
                if (!a || !b) return null
                const { d, x1, y1, x2, y2 } = route(a, b)
                const colour = byId.get(src)?.tone ?? WIRE
                // A wire the reader is looking along is lit; the rest step back,
                // so a board of twenty wires still answers "what feeds this one".
                const lit = active === null || active === src || active === c.id
                return (
                  <g key={`${src}>${c.id}`} opacity={lit ? 1 : 0.22}>
                    <path d={d} fill="none" stroke="rgb(0 0 0 / 0.5)" strokeWidth={3.5} />
                    <path d={d} fill="none" stroke={colour} strokeWidth={1.4} strokeOpacity={active === null ? 0.55 : 0.9} />
                    <circle cx={x1} cy={y1} r={SOCKET} fill={colour} stroke="var(--s-board)" strokeWidth={1.5} />
                    <circle cx={x2} cy={y2} r={SOCKET} fill="var(--s-card)" stroke={colour} strokeWidth={1.5} />
                  </g>
                )
              })
            )}
        </svg>

        {cards.map((c) => (
          <Card
            key={c.id}
            card={c}
            place={placeOf(c.id)}
            width={width(c)}
            active={active === c.id}
            measure={watch(c.id)}
            onGrab={(e) => beginCard(e, c.id)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
          />
        ))}
      </div>

      {toolbar && <div className="pointer-events-none absolute left-3 top-3 flex gap-2">{toolbar}</div>}

      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-md border border-white/[0.07] bg-card/90 backdrop-blur">
        <Rail label="Zoom in" onClick={() => step(1.25)}>
          <Plus className="size-3.5" />
        </Rail>
        <Rail label="Zoom out" onClick={() => step(0.8)}>
          <Minus className="size-3.5" />
        </Rail>
        <Rail label="Frame every card" onClick={frame}>
          <ArrowsOut className="size-3.5" />
        </Rail>
        {onReset && (
          <Rail
            label="Put the cards back where they started"
            onClick={() => {
              onReset()
              frame()
            }}
          >
            <span className="text-[9px] font-medium tracking-wide">RST</span>
          </Rail>
        )}
      </div>
    </div>
  )
}

function Rail({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="grid size-7 place-items-center text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

function Card({
  card,
  place,
  width,
  active,
  measure,
  onGrab,
  onPointerMove,
  onPointerUp,
}: {
  card: BoardCard
  place: Place
  width: number
  active: boolean
  measure: (el: HTMLDivElement | null) => void
  onGrab: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
}) {
  const [note, setNote] = useState(false)
  const grip = {
    onPointerDown: onGrab,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  }

  return (
    <div
      ref={measure}
      className="absolute rounded-xl"
      style={{
        left: place.x,
        top: place.y,
        width,
        background: "var(--s-card)",
        // A chart paints its gaps and rings in --s-sunk. On a board that is
        // the CARD's colour, not the panel's, or every ring is a dark hole.
        ["--s-sunk" as string]: "var(--s-card)",
        boxShadow: active
          ? "0 0 0 1px rgb(var(--p-accent) / 0.55), 0 22px 48px -20px rgb(0 0 0 / 0.95)"
          : "0 0 0 1px rgb(255 255 255 / 0.07), 0 18px 40px -24px rgb(0 0 0 / 0.9)",
        zIndex: active ? 1 : undefined,
      }}
    >
      {card.title ? (
        <header
          {...grip}
          className="flex cursor-grab items-center gap-2 rounded-t-xl px-3 pb-1.5 pt-2.5 active:cursor-grabbing"
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: active ? "var(--accent)" : (card.tone ?? "rgb(var(--p-line-strong) / 0.7)") }}
          />
          {/*
            Sentence case at reading size, not a tracked-out mono eyebrow. A
            card on a board is a thing with a name, and a name is written the
            way names are written.
          */}
          <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground" title={card.title}>
            {card.title}
          </h3>
          {card.right && <span className="shrink-0 text-[10px] text-muted-foreground">{card.right}</span>}
          {card.note && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setNote((v) => !v)}
              aria-expanded={note}
              aria-label={note ? "Hide what this figure assumes" : "What this figure assumes"}
              title="What this figure assumes"
              className={`grid size-4 shrink-0 place-items-center rounded-sm transition-colors hover:bg-hover ${
                note ? "text-accent" : "text-muted-foreground/70 hover:text-foreground"
              }`}
            >
              <Info className="size-3" />
            </button>
          )}
        </header>
      ) : (
        // A bare card has no header to grab, so the card itself is the handle.
        <div {...grip} className="absolute inset-0 cursor-grab rounded-xl active:cursor-grabbing" aria-hidden />
      )}

      <div className={card.title ? "px-3 pb-3" : "pointer-events-none relative px-3 py-2.5"}>{card.children}</div>

      {card.note && note && (
        <p className="mx-3 mb-3 rounded-md bg-black/25 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
          {card.note}
        </p>
      )}
    </div>
  )
}

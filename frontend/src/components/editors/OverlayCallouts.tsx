import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CaretRight } from "@phosphor-icons/react"
import { Marker } from "maplibre-gl"
import type { energy } from "../../../wailsjs/go/models"
import { currentMap } from "../../lib/mapEngine"
import { legendsShown, mapLoaded } from "../../lib/mapState"
import { seasonLabel } from "../../lib/params"
import { findItem, project, type TerrainResult } from "../../lib/project"
import { useStore } from "../../lib/store"
import { overlays } from "../../lib/tools"

/**
 * A layer's legend, tied to the ground it measures, as TERRA's OverlayCallout.
 *
 * IT IS TIED, NOT PLACED. A dot sits at the centre of the layer and the box
 * floats off it on a leader, which is what says WHICH layer the box describes
 * when several are drawn. The anchor is a coordinate, so the assembly travels
 * with the ground under pan and zoom.
 *
 * THE ANCHOR DOES NOT MOVE; THE BOX DOES. Dragging the box changes its offset
 * from the dot, and the leader is drawn from that offset on every render, so
 * it stretches while the dot keeps marking the layer.
 *
 * SHOWN BY ASKING: from the layer's row in the Outliner, its Properties, or
 * the Object menu. A new layer arrives with its legend up. The Legend overlay
 * hides every one at once.
 */

/** Where a box starts, in pixels from its anchor: up and to the left. */
const START_X = -232
const START_Y = -112
const BOX_W = 216
/** The height assumed for the one frame before the box is measured. */
const BOX_H_GUESS = 92
/** The run the leader takes off the box before it turns, and how much of it is straight. */
const STUB = 22
const STRAIGHT = 0.34

/*
  Where each box was dragged to, for the session. Outside React, so a box keeps
  its place when the map moves to another area or workspace and its marker is
  made again.
*/
const offsets = new Map<string, { x: number; y: number }>()

export type TerrainCaption = {
  subject: string
  area: string
  detail: string
  scale: energy.RenderScale
}

/** What the ramp's endpoints are the endpoints of, in the fewest words that keep the claim. */
function basisShort(scale: energy.RenderScale): string {
  if (scale.basis === "fixed") return "fixed domain"
  if (scale.basis === "shared" && scale.shared_with) return `domain shared with ${scale.shared_with}`
  return "own range, relative contrast"
}

function captionOf(d: ReturnType<typeof project.get>["data"], r: TerrainResult): TerrainCaption {
  const t = r.data
  return {
    subject: "Solar terrain",
    area: findItem(d, r.sourceId)?.name ?? r.name,
    detail: [
      seasonLabel(t.season),
      t.unit,
      basisShort(t.scale),
      `${t.hourly_years} yr`,
      t.dem_source,
      `opacity ${Math.round(r.opacity * 100)}%`,
    ]
      .filter(Boolean)
      .join(" · "),
    scale: t.scale,
  }
}

/** The legends to draw: layers on the map whose legend was asked for, while the Legend overlay is on. */
function useCaptions(): { key: string; at: [number, number]; caption: TerrainCaption }[] {
  const d = useStore(project).data
  const o = useStore(overlays)
  const shown = useStore(legendsShown)
  if (!o.legend || !o.layers) return []
  return d.results
    .filter((r): r is TerrainResult => r.kind === "terrain" && !r.hidden && !findItem(d, r.sourceId)?.hidden && shown.has(r.id))
    .map((r) => {
      const e = r.data.extent
      return { key: r.id, at: [(e.lon_min + e.lon_max) / 2, (e.lat_min + e.lat_max) / 2], caption: captionOf(d, r) }
    })
}

export function OverlayCallouts() {
  const ready = useStore(mapLoaded)
  const captions = useCaptions()
  /*
    One marker per layer, held across renders: a marker is a DOM node the map
    positions on every frame, so it is made once and moved, and the box inside
    it is portalled in, which keeps a drag alive through a caption change.
  */
  const markers = useRef(new Map<string, Marker>())
  const [elements, setElements] = useState<ReadonlyMap<string, HTMLElement>>(new Map())
  const keyOf = captions.map((c) => `${c.key}@${c.at.join(",")}`).join("|")

  useEffect(() => {
    const map = currentMap()
    if (!map || !ready) return
    const live = new Set(captions.map((c) => c.key))
    let changed = false
    for (const [key, marker] of markers.current) {
      if (live.has(key)) continue
      marker.remove()
      markers.current.delete(key)
      changed = true
    }
    for (const c of captions) {
      const held = markers.current.get(c.key)
      if (held) {
        held.setLngLat(c.at)
        continue
      }
      // The element is the ANCHOR POINT, zero-sized, so the box is placed from the dot and not from a corner.
      const el = document.createElement("div")
      el.style.width = "0"
      el.style.height = "0"
      // Not draggable: the marker is the anchor, and the box does its own dragging.
      markers.current.set(c.key, new Marker({ element: el }).setLngLat(c.at).addTo(map))
      changed = true
    }
    if (changed) setElements(new Map([...markers.current].map(([k, m]) => [k, m.getElement()])))
    // keyOf stands for `captions`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, keyOf])

  useEffect(
    () => () => {
      for (const marker of markers.current.values()) marker.remove()
      markers.current.clear()
    },
    []
  )

  return (
    <>
      {captions.map((c) => {
        const el = elements.get(c.key)
        return el ? createPortal(<CalloutBody id={c.key} caption={c.caption} />, el, c.key) : null
      })}
    </>
  )
}

/**
 * The leader, from the box's edge to the dot: a short straight run off the
 * edge that faces the dot, then one curve to it. Which edge is decided by
 * where the box is, so the line never runs back through the box.
 */
function leaderPath(dx: number, dy: number, boxH: number): string {
  const left = dx
  const right = dx + BOX_W
  const top = dy
  const bottom = dy + boxH
  const horizontal = right < 0 || left > 0
  if (horizontal) {
    const x = right < 0 ? right : left
    const y = Math.min(Math.max(0, top + 12), bottom - 12)
    const stub = right < 0 ? STUB : -STUB
    return `M ${x} ${y} L ${x + stub * STRAIGHT} ${y} Q ${x + stub} ${y}, 0 0`
  }
  const y = bottom < 0 ? bottom : top
  const x = Math.min(Math.max(0, left + 24), right - 24)
  const stub = bottom < 0 ? STUB : -STUB
  return `M ${x} ${y} L ${x} ${y + stub * STRAIGHT} Q ${x} ${y + stub}, 0 0`
}

/**
 * A line that says the whole of itself, but only where it cannot show it: a
 * caret appears only when the line is clipped. The press is stopped because
 * the box captures the pointer to be dragged, which would swallow the click.
 */
function Disclosed({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const ref = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const read = () => setClipped(el.scrollWidth > el.clientWidth + 1)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, clipped, text])

  if (!clipped && !open) {
    return (
      <p className={`mt-0.5 ${className}`}>
        <span ref={ref} className="block truncate">
          {text}
        </span>
      </p>
    )
  }
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      title={open ? "Show less" : text}
      className="mt-0.5 flex w-full items-start gap-1 text-left transition-colors hover:brightness-125"
    >
      <CaretRight aria-hidden className={`mt-[3px] size-2.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      <span ref={ref} className={`min-w-0 flex-1 ${className} ${open ? "leading-relaxed" : "truncate"}`}>
        {text}
      </span>
    </button>
  )
}

/** The ramp the layer was drawn on, its two ends, and the reference value where the quantity has one. */
function Ramp({ scale }: { scale: energy.RenderScale }) {
  const gradient = scale.stops?.length ? `linear-gradient(to right, ${scale.stops.join(", ")})` : "rgb(var(--p-line))"
  const ref = scale.reference
  const refPos = ref != null && scale.max > scale.min ? ((ref - scale.min) / (scale.max - scale.min)) * 100 : null
  const shownRef = refPos !== null && refPos >= 0 && refPos <= 100
  return (
    <>
      <div className="relative mt-1.5 h-1.5 w-full rounded-[1px]" style={{ background: gradient }}>
        {shownRef && <span className="absolute -top-0.5 h-2.5 w-px bg-foreground" style={{ left: `${refPos}%` }} />}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="telemetry text-micro text-muted-foreground">{scale.min.toFixed(scale.decimals)}</span>
        {shownRef && <span className="telemetry text-micro text-muted-foreground/70">ref {ref}</span>}
        <span className="telemetry text-micro text-muted-foreground">{scale.max.toFixed(scale.decimals)}</span>
      </div>
    </>
  )
}

function CalloutBody({ id, caption }: { id: string; caption: TerrainCaption }) {
  const [off, setOff] = useState(() => offsets.get(id) ?? { x: START_X, y: START_Y })
  const from = useRef<{ x: number; y: number } | null>(null)

  // Measured, so the leader leaves from an edge the box actually has.
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [boxH, setBoxH] = useState(BOX_H_GUESS)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const read = () => setBoxH(el.offsetHeight || BOX_H_GUESS)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      // Neither a pan of the map nor the map's own pointer handling.
      e.stopPropagation()
      e.preventDefault()
      from.current = { x: e.clientX - off.x, y: e.clientY - off.y }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [off.x, off.y]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = from.current
      if (!start) return
      e.stopPropagation()
      const next = { x: e.clientX - start.x, y: e.clientY - start.y }
      offsets.set(id, next)
      setOff(next)
    },
    [id]
  )

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    from.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const leader = leaderPath(off.x, off.y, boxH)

  return (
    <div className="relative">
      {/* One pixel and not zero: an svg with no size is not painted, whatever its overflow. */}
      <svg aria-hidden width={1} height={1} className="pointer-events-none absolute left-0 top-0 overflow-visible">
        {/* The halo first, so the line is drawn over it: on the dark basemap the halo is the dark side. */}
        <path d={leader} fill="none" stroke="rgb(var(--p-ink))" strokeWidth={3} strokeOpacity={0.6} />
        <path d={leader} fill="none" stroke="rgb(var(--p-text))" strokeWidth={1} strokeOpacity={0.85} />
      </svg>

      {/* The dot, at the coordinate itself. */}
      <span
        aria-hidden
        className="absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "rgb(var(--p-text))", boxShadow: "0 0 0 1.5px rgb(var(--p-ink) / 0.9)" }}
      />

      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="app-no-drag absolute cursor-grab select-none rounded-sm px-2.5 py-2 shadow-lg active:cursor-grabbing"
        style={{
          left: off.x,
          top: off.y,
          width: BOX_W,
          touchAction: "none",
          /*
            Frosted over the map, as TERRA's: the brightness bounds whatever is
            behind before the tint goes over it, and the blur removes the
            texture that makes small text hard to read over a map.
          */
          background: "rgb(var(--p-ink) / 0.78)",
          backdropFilter: "blur(16px) brightness(0.5) saturate(1.25)",
          WebkitBackdropFilter: "blur(16px) brightness(0.5) saturate(1.25)",
          border: "1px solid rgb(var(--p-line) / 0.35)",
        }}
      >
        <p className="eyebrow !text-[9px] truncate !text-primary">{caption.subject}</p>
        <Disclosed text={caption.area} className="text-emphasis italic text-foreground" />
        <Disclosed text={caption.detail} className="telemetry text-micro text-muted-foreground" />
        <Ramp scale={caption.scale} />
      </div>
    </div>
  )
}

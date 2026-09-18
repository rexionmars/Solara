import { useRef, useState } from "react"
import type { EditorId } from "../../lib/editors"
import { areaRects, setRatio, splitsWithin, type LayoutNode, type Rect, type Seam } from "../../lib/screen"

/**
 * The tree, drawn: every leaf placed, every division draggable -- TERRA's
 * StudioAreaTree.
 *
 * THE EDGES ARE THE SPLITS. A drag reports a new fraction for one split and
 * both children move because both are derived from it, so no two neighbours
 * can disagree about where their shared edge is. One absolutely-positioned
 * layer rather than nested flex boxes: the rectangles are already computed.
 */

/** How thick the grab target on a division is. The line itself is one pixel. */
const SEAM_PX = 6

/**
 * How near a division has to come to another before it takes its place: two
 * divisions one pixel apart read as a mistake, and a pointer cannot aim to the
 * pixel. Alt defeats it.
 */
const SNAP_PX = 5

const seamLine = (s: Seam): number => (s.dir === "row" ? s.bounds.x + s.bounds.w * s.ratio : s.bounds.y + s.bounds.h * s.ratio)

export function AreaTree({
  tree,
  viewport,
  surface,
  renderArea,
}: {
  tree: LayoutNode
  viewport: Rect
  surface: HTMLElement | null
  renderArea: (leaf: { id: string; editor: EditorId; rect: Rect }) => React.ReactNode
}) {
  const { leaves, seams } = areaRects(tree, viewport)
  const [guide, setGuide] = useState<{ dir: "row" | "col"; at: number } | null>(null)

  return (
    <>
      {leaves.map((l) => (
        <div key={l.id}>{renderArea({ id: l.id, editor: l.editor, rect: l.rect })}</div>
      ))}
      {seams.map((s) => {
        const inside = splitsWithin(tree, s.id)
        return (
          <SeamHandle
            key={s.id}
            seam={s}
            surface={surface}
            targets={seams.filter((o) => o.dir === s.dir && o.id !== s.id && !inside.has(o.id)).map(seamLine)}
            onGuide={setGuide}
          />
        )
      })}
      {/* Dashed, so the guide cannot be mistaken for a division that is actually there. */}
      {guide && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[31]"
          style={{
            left: guide.dir === "row" ? guide.at : viewport.x,
            top: guide.dir === "row" ? viewport.y : guide.at,
            width: guide.dir === "row" ? 1 : viewport.w,
            height: guide.dir === "row" ? viewport.h : 1,
            backgroundImage: `repeating-linear-gradient(${guide.dir === "row" ? "to bottom" : "to right"}, rgb(var(--p-accent)) 0 4px, transparent 4px 8px)`,
          }}
        />
      )}
    </>
  )
}

function SeamHandle({
  seam,
  surface,
  targets,
  onGuide,
}: {
  seam: Seam
  surface: HTMLElement | null
  targets: number[]
  onGuide: (g: { dir: "row" | "col"; at: number } | null) => void
}) {
  const horizontal = seam.dir === "row"
  const { bounds, ratio } = seam
  const x = horizontal ? bounds.x + bounds.w * ratio : bounds.x
  const y = horizontal ? bounds.y : bounds.y + bounds.h * ratio
  const dragging = useRef(false)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = true
    // Read once: the studio does not move while a division is dragged.
    const origin = surface?.getBoundingClientRect()
    const ox = origin?.left ?? 0
    const oy = origin?.top ?? 0
    const lines = targets.slice()
    let held: number | null = null
    const move = (ev: PointerEvent) => {
      const raw = horizontal ? ev.clientX - ox : ev.clientY - oy
      // The NEAREST division within reach, so the snap depends on the pointer and not the tree's shape.
      let snap: number | null = null
      if (!ev.altKey) {
        let best = SNAP_PX
        for (const l of lines) {
          const d = Math.abs(l - raw)
          if (d <= best) {
            best = d
            snap = l
          }
        }
      }
      if (snap !== held) {
        held = snap
        onGuide(snap === null ? null : { dir: seam.dir, at: snap })
      }
      const coord = snap ?? raw
      setRatio(seam.id, horizontal ? (coord - bounds.x) / bounds.w : (coord - bounds.y) / bounds.h)
    }
    const up = () => {
      dragging.current = false
      onGuide(null)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const less = horizontal ? "ArrowLeft" : "ArrowUp"
    const more = horizontal ? "ArrowRight" : "ArrowDown"
    if (e.key !== less && e.key !== more) return
    e.preventDefault()
    // A fiftieth of the split at a time, a tenth with shift.
    const step = e.shiftKey ? 0.1 : 0.02
    setRatio(seam.id, ratio + (e.key === more ? step : -step))
  }

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label="Move this division"
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setRatio(seam.id, 0.5)}
      className={`group absolute z-[30] ${horizontal ? "cursor-col-resize" : "cursor-row-resize"}`}
      style={{
        left: horizontal ? x - SEAM_PX / 2 : bounds.x,
        top: horizontal ? bounds.y : y - SEAM_PX / 2,
        width: horizontal ? SEAM_PX : bounds.w,
        height: horizontal ? bounds.h : SEAM_PX,
      }}
    >
      {/* Lit on hover and focus, invisible otherwise: a permanent line on every division is a grid of rules. */}
      <span
        className={`absolute bg-accent opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100 ${
          horizontal ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2"
        }`}
        aria-hidden
      />
    </div>
  )
}


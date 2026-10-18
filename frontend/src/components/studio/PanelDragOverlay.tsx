import { editorMeta } from "../../lib/editors"
import { panelDrag } from "../../lib/panelDrag"
import { findArea } from "../../lib/screen"
import { useStore } from "../../lib/store"

export function PanelDragOverlay({ surface }: { surface: HTMLElement | null }) {
  const drag = useStore(panelDrag)
  if (!drag || !surface) return null
  const origin = surface.getBoundingClientRect()
  const target = drag.target
  const sourceName = editorMeta(findArea(drag.source)?.editor ?? "map").label
  const targetName = target ? editorMeta(findArea(target.id)?.editor ?? "map").label : ""
  const action = !target ? "Drop on another panel" : target.position === "center" ? `Swap with ${targetName}`
    : `Dock ${target.position === "top" ? "above" : target.position === "bottom" ? "below" : `${target.position} of`} ${targetName}`
  return <div className="pointer-events-none absolute inset-0 z-[45] overflow-hidden">
    {target && <div aria-hidden className="absolute rounded-md border-2 border-accent bg-accent/20 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.3)]" style={{ left: target.rect.x, top: target.rect.y, width: target.rect.w, height: target.rect.h }} />}
    <div role="status" aria-live="polite" className="absolute max-w-[min(24rem,90%)] rounded-sm border border-accent/50 bg-sunk px-3 py-2 shadow-xl"
      style={{ left: Math.max(8, Math.min(origin.width - 300, drag.x - origin.left + 18)), top: Math.max(8, Math.min(origin.height - 90, drag.y - origin.top + 18)) }}>
      <p className="text-emphasis text-foreground">{sourceName} · {action}</p>
      <p className="mt-1 text-micro text-muted-foreground">{drag.keyboard ? "Tab: target · Arrows: dock · C: swap · Enter: apply · Esc: cancel" : "Center: swap · Edges: dock · Esc: cancel"}</p>
    </div>
  </div>
}

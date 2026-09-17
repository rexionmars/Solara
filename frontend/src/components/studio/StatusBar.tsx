import { mapMounted, mapView } from "../../lib/mapState"
import { formatKeys } from "../../lib/operators"
import { project } from "../../lib/project"
import { hoveredArea } from "../../lib/screen"
import { selection } from "../../lib/selection"
import { useStore } from "../../lib/store"
import { TOOLS, activeTool } from "../../lib/tools"
import type { EditorId } from "../../lib/editors"

/** The strip's height, which the area tree subtracts from its rectangle. */
export const STATUS_BAR_PX = 22

const BINDINGS: Partial<Record<EditorId, [string, string][]>> = {
  outliner: [
    ["Press", "Select"],
    ["Double", "Rename"],
    ["↑↓", "Walk"],
    [formatKeys("X"), "Delete"],
    [formatKeys("Period"), "Frame"],
  ],
  properties: [
    ["Drag", "Scrub"],
    ["Press", "Type"],
    ["↑↓", "Step"],
    ["Delete", "Default"],
  ],
  console: [
    ["Enter", "Run"],
    ["Tab", "Complete"],
    ["↑↓", "History"],
  ],
  table: [
    ["Press header", "Sort"],
    ["Press row", "Select"],
  ],
}

/**
 * The one strip across the studio's foot, as TERRA's: LEFT what the pointer
 * does here, RIGHT what is in the project and how much of it is picked. No
 * middle: a run's progress is drawn where the run was started, and the latest
 * report is a toast.
 */
export function StatusBar() {
  const { editor } = useStore(hoveredArea)
  const tool = useStore(activeTool)
  const mounted = useStore(mapMounted)
  const view = useStore(mapView)
  const d = useStore(project).data
  const { id } = useStore(selection)

  const bindings: [string, string][] =
    editor === "map"
      ? (TOOLS.find((t) => t.id === tool)?.hints ?? []).map(([k, v]) => [k.replace("Click", "Press"), v])
      : (BINDINGS[editor ?? "outliner"] ?? [])

  // Ground resolution at the centre: what a zoom level is worth on this latitude.
  const mPerPx = (40075016.686 * Math.cos((view.lat * Math.PI) / 180)) / (512 * 2 ** view.zoom)
  const ground = mPerPx >= 1000 ? `${(mPerPx / 1000).toFixed(1)}km` : `${mPerPx.toFixed(mPerPx < 10 ? 1 : 0)}m`
  const picked = id ? 1 : 0
  const objects = d.sites.length + d.areas.length

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-t px-2"
      style={{ height: STATUS_BAR_PX, background: "var(--s-app)", borderColor: "rgb(var(--p-line) / 0.28)" }}
    >
      {mounted && (
        <span className="telemetry flex shrink-0 items-center gap-2 text-[9px] text-muted-foreground">
          <Figure label="zoom" value={view.zoom.toFixed(1)} />
          <Figure label="ground" value={ground} />
        </span>
      )}
      {mounted && bindings.length > 0 && <span className="hidden h-3 w-px shrink-0 self-center border-l lg:block" style={{ borderColor: "var(--hairline)" }} />}
      <span className="telemetry flex min-w-0 items-center gap-2 overflow-hidden text-[9px] text-muted-foreground">
        {bindings.map(([keys, what]) => (
          <Binding key={keys + what} keys={keys} what={what} />
        ))}
      </span>

      <span className="flex-1" />

      <span className="telemetry flex shrink-0 items-center gap-2 text-[9px] text-muted-foreground">
        <span>
          <span className={picked ? "text-foreground" : ""}>{picked}</span>/{objects + d.results.length} picked
        </span>
        <span>
          {d.sites.length} {d.sites.length === 1 ? "site" : "sites"}
        </span>
        <span>
          {d.areas.length} {d.areas.length === 1 ? "area" : "areas"}
        </span>
        <span>
          {d.results.length} {d.results.length === 1 ? "result" : "results"}
        </span>
      </span>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="tabular-nums text-foreground">{value}</span>
      {label}
    </span>
  )
}

/** One binding: the key in the foreground, what it does beside it. */
function Binding({ keys, what }: { keys: string; what: string }) {
  return (
    <span className="hidden shrink-0 items-center gap-1 lg:inline-flex">
      <span className="rounded-[2px] px-1 text-foreground" style={{ background: "rgb(var(--p-line) / 0.28)" }}>
        {keys}
      </span>
      {what}
    </span>
  )
}

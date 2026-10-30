import { useEffect, useState } from "react"
import { formatLat, formatLng } from "../../lib/format"
import { geoPackage } from "../../lib/geopackage"
import { gridStore, storeReport } from "../../lib/grid"
import { cursor, mapMounted, mapView } from "../../lib/mapState"
import { sidecar } from "../../lib/sidecarStatus"
import { formatKeys } from "../../lib/operators"
import { project } from "../../lib/project"
import { hoveredArea } from "../../lib/screen"
import { selection } from "../../lib/selection"
import { useStore } from "../../lib/store"
import { TOOLS, activeTool } from "../../lib/tools"
import type { EditorId } from "../../lib/editors"

/** The strip's height, which the area tree subtracts from its rectangle. */
export const STATUS_BAR_PX = 26

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

/** Whether the machine says it has a network, kept current by its events. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    return () => {
      window.removeEventListener("online", on)
      window.removeEventListener("offline", off)
    }
  }, [])
  return online
}

/**
 * The one strip across the studio's foot. LEFT where the pointer is on the map
 * (the map's centre when it is elsewhere), the ground a pixel covers, and what
 * the pointer does here. RIGHT the reads in progress, then the state of what
 * the readings depend on -- the engine, the grid store, the network -- and what
 * is in the project. A run's progress is drawn where the run was started, and
 * the latest report is a toast.
 */
export function StatusBar() {
  const { editor } = useStore(hoveredArea)
  const tool = useStore(activeTool)
  const mounted = useStore(mapMounted)
  const view = useStore(mapView)
  const d = useStore(project).data
  const { id } = useStore(selection)
  const held = storeReport(useStore(gridStore))
  const pointer = useStore(cursor)
  const engine = useStore(sidecar)
  const online = useOnline()
  const local = useStore(geoPackage)
  const reading = local.file?.layers.filter((l) => local.views[l.name]?.loading).map((l) => l.label) ?? []
  const at = pointer ?? { lat: view.lat, lng: view.lng }

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
      className="flex shrink-0 items-center gap-3 border-t px-3"
      style={{ height: STATUS_BAR_PX, background: "var(--s-chrome)", borderColor: "var(--s-line-soft)" }}
    >
      {mounted && (
        <span className="telemetry flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
          <span className="text-foreground" title={pointer ? "Under the pointer" : "The centre of the map"}>
            {formatLat(at.lat, 3)}  {formatLng(at.lng, 3)}
          </span>
          <Figure label="zoom" value={view.zoom.toFixed(1)} />
          <Figure label="a pixel" value={ground} />
        </span>
      )}
      {mounted && bindings.length > 0 && <span className="hidden h-3 w-px shrink-0 self-center border-l lg:block" style={{ borderColor: "var(--hairline)" }} />}
      <span className="telemetry flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-muted-foreground">
        {bindings.map(([keys, what]) => (
          <Binding key={keys + what} keys={keys} what={what} />
        ))}
      </span>

      <span className="flex-1" />

      {reading.length > 0 && (
        <span className="telemetry flex min-w-0 shrink items-center gap-1.5 text-[11px] text-muted-foreground" title={reading.join(", ")}>
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
          <span className="truncate">Reading {reading.length === 1 ? reading[0] : `${reading.length} layers`}</span>
        </span>
      )}
      <span
        className="telemetry flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"
        title={engine.kind === "failed" ? engine.message : engine.kind === "ready" ? `Python ${engine.version}` : "Starting the calculation engine"}
      >
        <span className={`size-1.5 rounded-full ${engine.kind === "ready" ? "bg-success" : engine.kind === "failed" ? "bg-destructive-quiet" : "animate-pulse bg-warning"}`} />
        {engine.kind === "ready" ? "Engine ready" : engine.kind === "failed" ? "Engine failed" : "Engine starting"}
      </span>
      <span className="telemetry flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground" title="Weather, imagery and public data need the network">
        <span className={`size-1.5 rounded-full ${online ? "bg-success" : "bg-warning"}`} />
        {online ? "Online" : "Offline"}
      </span>

      {/* Which store the map's layers and the grid readings are read from, said
          wherever the reader is: data on the map with nothing naming its source
          is data nobody can account for. */}
      <span className="telemetry flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground" title={held?.reachable ? held.dsn : "Connect one in Settings › Grid store"}>
        <span className={`size-1.5 rounded-full ${held?.reachable ? "bg-success" : "bg-warning"}`} />
        {held?.reachable ? (
          <span className="max-w-[22rem] truncate">
            store <span className="text-foreground">{held.coverage?.store?.name ?? held.dsn}</span>
          </span>
        ) : (
          <span>no store connected</span>
        )}
      </span>
      <span className="h-3 w-px shrink-0 self-center border-l" style={{ borderColor: "var(--hairline)" }} />

      <span className="telemetry flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
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

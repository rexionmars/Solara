import { useEffect, useState, type ReactNode } from "react"
import { CaretDown, CaretUp, X } from "@phosphor-icons/react"
import { analysis } from "../../lib/analysis"
import { area } from "../../lib/area"
import { BASEMAP_MAX_ZOOM, BASEMAP_NAME } from "../../lib/basemap"
import { runCommand } from "../../lib/commands"
import {
  SEASON_OPTIONS,
  seasonLabel,
  solarParams,
  terrainParams,
  windParams,
  type SolarParams,
  type TerrainParams,
  type WindParams,
} from "../../lib/energyParams"
import { formatLat, formatLng } from "../../lib/format"
import { polygonAreaKm2 } from "../../lib/geo"
import { terrainLayer, toggleTerrainLayer } from "../../lib/layers"
import { mapView } from "../../lib/mapController"
import { sidecar } from "../../lib/sidecarStatus"
import { site } from "../../lib/site"
import { useStore, type Store } from "../../lib/store"

// Property grid cells: a label and a value either side of a rule, one row to a
// property, as the Properties palette of desktop CAD lays them out.
const GRID_ROW = "grid min-h-[22px] grid-cols-[112px_1fr] border-b border-line/40"
const LABEL_CELL = "flex items-center truncate border-r border-line/40 px-2 text-[11.5px] text-muted"
const CONTROL =
  "h-full w-full min-w-0 bg-transparent px-2 font-mono text-[11px] text-ink outline-none placeholder:text-muted/45 hover:bg-hover/40 focus:bg-sunken focus:ring-1 focus:ring-inset focus:ring-accent"
const SMALL_BUTTON = "h-6 flex-1 rounded-sm border border-line bg-raised px-2 text-[11.5px] text-ink hover:bg-hover active:bg-sunken"

/** A collapsible group of properties, as a CAD properties palette groups them. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section>
      <h3 className="border-b border-line/70 bg-raised">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex h-[22px] w-full items-center justify-between px-2 text-left text-[12px] font-medium text-ink/90 hover:text-ink"
        >
          {title}
          <span className="grid h-3.5 w-3.5 place-items-center rounded-[2px] bg-chrome text-muted">
            {open ? <CaretUp size={9} weight="bold" aria-hidden="true" /> : <CaretDown size={9} weight="bold" aria-hidden="true" />}
          </span>
        </button>
      </h3>
      {open && <dl className="flex flex-col">{children}</dl>}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={GRID_ROW}>
      <dt className={LABEL_CELL}>{label}</dt>
      <dd className="flex items-center truncate px-2 font-mono text-[11px] text-ink" title={value}>
        {value}
      </dd>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="border-b border-line/40 px-2 py-1 text-[11.5px] italic text-muted">{children}</p>
}

function parse(text: string): number | undefined {
  return text.trim() === "" ? undefined : Number(text)
}

/**
 * A number the user may set, or leave empty for the sidecar's default.
 *
 * The field keeps what was typed. It is re-seeded only when the stored value
 * stops matching it, so a value cleared elsewhere shows here without "0.50"
 * collapsing to "0.5" under the cursor.
 */
function NumberRow<T extends object>({
  store,
  field,
  label,
  unit,
  step = "any",
}: {
  store: Store<T>
  field: keyof T & string
  label: string
  unit?: string
  step?: number | "any"
}) {
  const value = useStore(store)[field] as number | undefined
  const [text, setText] = useState(value === undefined ? "" : String(value))

  useEffect(() => {
    if (parse(text) !== value) setText(value === undefined ? "" : String(value))
    // `text` is read, not tracked: this runs when the store changes.
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const id = `param-${String(field)}-${label}`
  return (
    <div className={GRID_ROW}>
      <label className={LABEL_CELL} htmlFor={id}>
        {label}
      </label>
      <div className="flex min-w-0 items-center">
        <input
          id={id}
          type="number"
          step={step}
          value={text}
          placeholder="default"
          onChange={(e) => {
            const t = e.target.value
            setText(t)
            const n = parse(t)
            if (n === undefined || Number.isFinite(n)) store.set((p) => ({ ...p, [field]: n }))
          }}
          className={CONTROL}
        />
        {unit && <span className="w-9 shrink-0 pr-1 text-right text-[10px] text-muted">{unit}</span>}
      </div>
    </div>
  )
}

function SeasonRow() {
  const { season } = useStore(terrainParams)
  return (
    <div className={GRID_ROW}>
      <label className={LABEL_CELL} htmlFor="param-season">
        Window
      </label>
      <select
        id="param-season"
        value={season ?? ""}
        onChange={(e) => terrainParams.set((p) => ({ ...p, season: e.target.value || undefined }))}
        className={`${CONTROL} bg-panel`}
      >
        <option value="">default</option>
        {SEASON_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function SiteSection() {
  const { point, picking } = useStore(site)
  return (
    <Section title="Site">
      {point ? (
        <>
          <Row label="Latitude" value={formatLat(point.lat)} />
          <Row label="Longitude" value={formatLng(point.lon)} />
        </>
      ) : (
        <Note>{picking ? "Click the map…" : "No site set."}</Note>
      )}
      <div className="flex px-2 py-1.5">
        <button type="button" onClick={() => void runCommand("SITE")} className={SMALL_BUTTON}>
          {point ? "Move site" : "Pick on map"}
        </button>
      </div>
    </Section>
  )
}

function AreaSection() {
  const { polygon, drawing } = useStore(area)
  return (
    <Section title="Area">
      {polygon ? (
        <>
          <Row label="Vertices" value={String(polygon.coordinates[0].length - 1)} />
          <Row label="Area" value={`${polygonAreaKm2(polygon).toFixed(2)} km²`} />
        </>
      ) : (
        <Note>{drawing ? "Drawing…" : "No area drawn."}</Note>
      )}
      <div className="flex gap-1 px-2 py-1.5">
        <button type="button" onClick={() => void runCommand("AREA")} className={SMALL_BUTTON}>
          {polygon ? "Redraw" : "Draw on map"}
        </button>
        {polygon && (
          <button type="button" onClick={() => void runCommand("AREACLEAR")} className={SMALL_BUTTON}>
            Clear
          </button>
        )}
      </div>
    </Section>
  )
}

function LayersSection() {
  const { terrain } = useStore(analysis)
  const layer = useStore(terrainLayer)
  return (
    <Section title="Layers">
      {terrain ? (
        <>
          <label className="flex min-h-[22px] items-center gap-2 border-b border-line/40 px-2 text-[11.5px] text-ink">
            <input type="checkbox" checked={layer.visible} onChange={toggleTerrainLayer} className="accent-accent" />
            Solar terrain · {seasonLabel(terrain.result.season)}
          </label>
          <div className={GRID_ROW}>
            <label className={LABEL_CELL} htmlFor="layer-terrain-opacity">
              Opacity
            </label>
            <input
              id="layer-terrain-opacity"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={layer.opacity}
              onChange={(e) => terrainLayer.set((l) => ({ ...l, opacity: Number(e.target.value) }))}
              className="mx-2 accent-accent"
            />
          </div>
        </>
      ) : (
        <Note>No layers yet.</Note>
      )}
    </Section>
  )
}

function ViewSection() {
  const v = useStore(mapView)
  return (
    <Section title="View">
      <Row label="Center latitude" value={formatLat(v.lat)} />
      <Row label="Center longitude" value={formatLng(v.lng)} />
      <Row label="Zoom" value={v.zoom.toFixed(2)} />
      <Row label="Bearing" value={`${v.bearing.toFixed(1)}°`} />
      <Row label="Pitch" value={`${v.pitch.toFixed(1)}°`} />
    </Section>
  )
}

function SidecarSection() {
  const s = useStore(sidecar)
  const status = s.kind === "ready" ? "Ready" : s.kind === "failed" ? "Unavailable" : "Checking…"
  return (
    <Section title="Sidecar">
      <Row label="Status" value={status} />
      {s.kind === "ready" && <Row label="Python" value={s.version} />}
      {s.kind !== "checking" && s.python && <Row label="Interpreter" value={s.python} />}
      {s.kind === "failed" && <Row label="Reason" value={s.message} />}
    </Section>
  )
}

/**
 * What is selected, and its attributes, followed by the parameters of the
 * energy products. Nothing on the map is selectable yet, so the panel reports
 * the site, the area, the layers, the view, the basemap and the sidecar.
 */
export function PropertiesPanel() {
  return (
    <aside aria-labelledby="properties-title" className="flex w-[19rem] shrink-0 border-r border-sunken bg-panel">
      {/* The palette's title runs up a strip at its edge, with its close button at the head. */}
      <div className="flex w-6 shrink-0 flex-col items-center border-r border-line/60 bg-chrome py-1">
        <button
          type="button"
          onClick={() => void runCommand("PROPERTIES")}
          title="Hide the palette (PROPERTIES)"
          className="grid h-5 w-5 place-items-center rounded-sm text-muted hover:bg-hover hover:text-ink"
        >
          <X size={11} weight="bold" aria-hidden="true" />
        </button>
        <h2
          id="properties-title"
          className="mt-auto rotate-180 select-none pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted [writing-mode:vertical-rl]"
        >
          Properties
        </h2>
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-3">
        <div className="flex items-center gap-1 border-b border-line/70 bg-chrome px-1.5 py-1.5">
          <p className="flex h-6 flex-1 items-center rounded-sm border border-line bg-sunken px-2 text-[12px] text-ink/90">
            No selection
          </p>
        </div>
        <SiteSection />
        <AreaSection />
        <LayersSection />
        <Section title="Solar resource">
          <NumberRow<SolarParams> store={solarParams} field="climatologyYears" label="Climatology" unit="yr" step={1} />
          <NumberRow<SolarParams> store={solarParams} field="hourlyYears" label="Hourly record" unit="yr" step={1} />
          <NumberRow<SolarParams> store={solarParams} field="surfaceAzimuth" label="Surface azimuth" unit="° N" />
          <NumberRow<SolarParams> store={solarParams} field="performanceRatio" label="Perf. ratio" unit="0–1" step={0.01} />
        </Section>
        <Section title="Wind screening">
          <NumberRow<WindParams> store={windParams} field="recordYears" label="Record" unit="yr" step={1} />
          <NumberRow<WindParams> store={windParams} field="hubHeightM" label="Hub height" unit="m" />
          <NumberRow<WindParams> store={windParams} field="calmThresholdMS" label="Calm threshold" unit="m/s" />
          <NumberRow<WindParams> store={windParams} field="recordMaxFloorMS" label="Max. floor" unit="m/s" />
          <NumberRow<WindParams> store={windParams} field="roughnessLowM" label="Roughness low" unit="m" />
          <NumberRow<WindParams> store={windParams} field="roughnessHighM" label="Roughness high" unit="m" />
        </Section>
        <Section title="Solar terrain">
          <NumberRow<TerrainParams> store={terrainParams} field="hourlyYears" label="Hourly record" unit="yr" step={1} />
          <SeasonRow />
        </Section>
        <p className="px-2 py-1.5 text-[10px] leading-snug text-muted">
          An empty field uses the sidecar's default. Each result states the values it was computed with.
        </p>
        <ViewSection />
        <Section title="Basemap">
          <Row label="Source" value={BASEMAP_NAME} />
          <Row label="Detail to zoom" value={String(BASEMAP_MAX_ZOOM)} />
        </Section>
        <SidecarSection />
      </div>
    </aside>
  )
}

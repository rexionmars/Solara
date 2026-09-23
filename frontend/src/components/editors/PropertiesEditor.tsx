import { useState, type ReactNode } from "react"
import { ArrowSquareOut, CaretDown, CaretRight, Pencil, Warning } from "@phosphor-icons/react"
import { running } from "../../lib/analysis"
import { reveal } from "../../lib/export"
import { formatLat, formatLng } from "../../lib/format"
import { polygonAreaKm2, ringCentre } from "../../lib/geo"
import { legendsShown, setLegendShown } from "../../lib/mapState"
import { setResultOpacity, setSiteCoordinate } from "../../lib/objects"
import { RUN_OPERATOR, runOperator } from "../../lib/operators"
import { seasonLabel } from "../../lib/params"
import {
  PRODUCT_NAMES,
  commit,
  findItem,
  isResult,
  project,
  renameItem,
  resultsOf,
  setHidden,
  staleReason,
  type AnyItem,
  type AreaObject,
  type Product,
  type ResultObject,
  type SiteObject,
} from "../../lib/project"
import { showResult } from "../../lib/screen"
import { select, useActiveItem } from "../../lib/selection"
import { sidecar } from "../../lib/sidecarStatus"
import { useStore } from "../../lib/store"
import { COLUMNS, formatCell } from "../../lib/table"
import { Legend } from "../energy/Legend"
import { AreaHeader } from "../studio/StudioArea"
import { btnGhostDense } from "../ui/buttons"
import { Checkbox, FieldRow, Figure, NumberField, OperatorButton, PanelSection, TextField } from "../ui/Fields"
import { NowSection } from "./NowSection"
import { ParamFields } from "./ParamFields"

/**
 * What is active, and everything with a value attached to it -- TERRA's
 * properties column. A product is run from its own card here, beside the
 * settings it reads and the figures it last produced: where a run is started
 * is where its progress and its answer are read.
 */

const SUBJECT: Record<AnyItem["kind"], string> = {
  site: "Site",
  area: "Area",
  solar: "Solar resource",
  wind: "Wind screening",
  terrain: "Solar terrain",
  connection: "Grid connection",
  demand: "Area demand",
}

/** The subject, its name and where it is, as TERRA heads a reading. */
function Head({ item, meta }: { item: AnyItem; meta: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.name)
  const commitName = () => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== item.name) renameItem(item.id, draft)
  }
  return (
    <div className="flex flex-col gap-0.5 px-2.5 pb-2 pt-2.5">
      <p className="eyebrow !text-[9px] truncate tracking-[0.08em]">{SUBJECT[item.kind]}</p>
      {editing ? (
        <input
          autoFocus
          value={draft}
          aria-label="Name"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commitName}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter") commitName()
            if (e.key === "Escape") setEditing(false)
          }}
          className="w-full rounded-sm border bg-sunk px-1.5 py-0.5 text-[12px] font-medium leading-tight text-foreground outline-none"
        />
      ) : (
        <button
          type="button"
          onDoubleClick={() => {
            setDraft(item.name)
            setEditing(true)
          }}
          title="Double-click to rename"
          className="group flex max-w-full cursor-text items-center gap-1.5 rounded-sm text-left hover:bg-hover"
        >
          <span className="min-w-0 truncate text-[12px] font-medium leading-tight tracking-wide text-foreground">{item.name}</span>
          <Pencil className="size-2.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70" aria-hidden />
        </button>
      )}
      <p className="telemetry selectable truncate text-[9px] text-muted-foreground">{meta}</p>
    </div>
  )
}

function StaleNote({ reason, onRerun }: { reason: string; onRerun?: () => void }) {
  return (
    <div className="flex items-start gap-1.5 rounded-sm px-2 py-1.5 text-body leading-snug" style={{ background: "rgb(213 190 75 / 0.12)", color: "var(--warning)" }}>
      <Warning className="mt-0.5 size-3 shrink-0" weight="fill" />
      <span className="flex-1">{reason}. The figures describe the source as it was.</span>
      {onRerun && (
        <button type="button" onClick={onRerun} className="shrink-0 rounded-sm px-1 text-meta underline-offset-2 hover:underline">
          Run again
        </button>
      )}
    </div>
  )
}

function Disclosure({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 py-0.5 text-meta text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <CaretDown className="size-2.5" /> : <CaretRight className="size-2.5" />}
        {label}
      </button>
      {open && <div className="pt-1">{children}</div>}
    </div>
  )
}

/** A result's headline figures, from the comparison table's own columns. */
function Figures({ result }: { result: ResultObject }) {
  const d = useStore(project).data
  const skip = new Set(["name", "source", "created", "stale", "lat", "lon"])
  return (
    <div className="flex flex-col">
      {COLUMNS[result.kind]
        .filter((c) => !skip.has(c.key))
        .map((c) => {
          const v = c.value(result, d)
          return <Figure key={c.key} label={c.label} value={`${formatCell(c, v)}${c.unit && v !== null ? ` ${c.unit}` : ""}`} />
        })}
    </div>
  )
}

const RUN = RUN_OPERATOR

const WHAT: Record<Product, string> = {
  solar: "NASA POWER at the site's radiation cell; the photovoltaic yield with pvlib.",
  wind: "MERRA-2 at the site's cell, extrapolated to hub height. Gross and unvalidated: a screening.",
  terrain: "Plane-of-array irradiation over the area's 30 m terrain, with horizon shading. Draws a layer.",
  connection: "Where the area could join the transmission network, and what the plants already joined there lost. Read from the grid store.",
  demand:
    "What the area already draws from the network and already generates behind the meter, from the BDGD register in the grid store.",
}

/** A product's card: what it reads, its settings, the run, and what it last produced. */
function ProductCard({ product, source }: { product: Product; source: SiteObject | AreaObject }) {
  const d = useStore(project).data
  const job = useStore(running)
  const results = resultsOf(d, source.id).filter((r) => r.kind === product)
  const latest = results.at(-1)
  const here = job && job.sourceId === source.id && job.product === product
  const stale = latest ? staleReason(d, latest) : null

  return (
    <PanelSection
      title={PRODUCT_NAMES[product]}
      aside={latest && <span className="telemetry text-[9px] text-muted-foreground">{results.length} run{results.length === 1 ? "" : "s"}</span>}
    >
      <p className="text-body leading-relaxed text-muted-foreground">{WHAT[product]}</p>
      <Disclosure label="Settings" defaultOpen={!latest}>
        <ParamFields group={product} />
      </Disclosure>
      {here && job ? (
        <div className="flex flex-col gap-1 rounded-sm px-2 py-1.5" style={{ background: "var(--s-control)" }} role="status">
          <div className="h-1 overflow-hidden rounded-full bg-sunk">
            <div className={`h-full bg-accent transition-[width] ${job.progress === null ? "w-1/4 animate-pulse" : ""}`} style={job.progress === null ? undefined : { width: `${job.progress}%` }} />
          </div>
          <p className="telemetry flex justify-between gap-2 text-[9px] text-muted-foreground">
            <span className="truncate">{job.message}</span>
            <span className="text-foreground">{job.progress === null ? "" : `${job.progress}%`}</span>
          </p>
          <OperatorButton name="CANCEL" label="Stop" />
        </div>
      ) : (
        <OperatorButton name={RUN[product]} label={latest ? `Run ${PRODUCT_NAMES[product].toLowerCase()} again` : `Run ${PRODUCT_NAMES[product].toLowerCase()}`} primary className="w-full" />
      )}
      {latest && (
        <div className="flex flex-col gap-1 border-y py-1.5" style={{ borderColor: "rgb(var(--p-line) / 0.4)" }}>
          {stale && <StaleNote reason={stale} />}
          <Figures result={latest} />
          <div className="flex gap-1 pt-1">
            <button type="button" className={btnGhostDense} onClick={() => select(latest.id)}>
              Select
            </button>
            <button type="button" className={`${btnGhostDense} flex-1`} onClick={() => showResult(latest.id, product)}>
              <ArrowSquareOut className="size-3" />
              Read it
            </button>
          </div>
        </div>
      )}
    </PanelSection>
  )
}

/**
 * The layer a result drew, whichever product drew it: shown or not, its
 * legend, its opacity and the ramp it was drawn on.
 */
function ResultLayer({ result }: { result: Extract<ResultObject, { kind: "terrain" | "demand" }> }) {
  const legends = useStore(legendsShown)
  const layer =
    result.kind === "terrain"
      ? { scale: result.data.scale, unit: result.data.unit, title: seasonLabel(result.data.season) }
      : result.data.density
        ? { scale: result.data.density.scale, unit: result.data.density.unit, title: `Cells of ${result.data.density.cell_km} km` }
        : null
  if (!layer) return null
  return (
    <PanelSection title="Layer">
      <Checkbox checked={!result.hidden} onChange={(v) => setHidden(result.id, !v)} label="Drawn on the map" />
      <Checkbox
        checked={legends.has(result.id)}
        onChange={(v) => setLegendShown(result.id, v)}
        label="Legend on the map"
        title="Its legend, tied to the layer it describes; drag the box out of the way"
      />
      <FieldRow label="Opacity">
        <NumberField
          label="Opacity"
          allowEmpty={false}
          value={Math.round(result.opacity * 100)}
          step={5}
          decimals={0}
          unit="%"
          validate={(v) => (v < 0 || v > 100 ? "Between 0 and 100" : null)}
          onChange={(v) => v !== undefined && setResultOpacity(result.id, v / 100)}
        />
      </FieldRow>
      <Legend scale={layer.scale} unit={layer.unit} title={layer.title} />
    </PanelSection>
  )
}

const PARAM_LABELS: Record<string, string> = {
  climatologyYears: "Climatology",
  hourlyYears: "Hourly record",
  surfaceAzimuth: "Surface azimuth",
  performanceRatio: "Performance ratio",
  recordYears: "Record",
  hubHeightM: "Hub height",
  calmThresholdMS: "Calm threshold",
  recordMaxFloorMS: "Maximum floor",
  roughnessLowM: "Roughness low",
  roughnessHighM: "Roughness high",
  season: "Window",
}

function SiteBody({ site }: { site: SiteObject }) {
  return (
    <>
      <Head item={site} meta={`${formatLat(site.lat)}  ${formatLng(site.lon)} · WGS 84`} />
      <PanelSection title="Location">
        <FieldRow label="Latitude">
          <NumberField
            label="Latitude"
            allowEmpty={false}
            value={site.lat}
            step={0.001}
            unit="°"
            validate={(v) => (Math.abs(v) <= 90 ? null : "Between -90 and 90")}
            onChange={(v) => v !== undefined && setSiteCoordinate(site.id, "lat", v)}
          />
        </FieldRow>
        <FieldRow label="Longitude">
          <NumberField
            label="Longitude"
            allowEmpty={false}
            value={site.lon}
            step={0.001}
            unit="°"
            validate={(v) => (Math.abs(v) <= 180 ? null : "Between -180 and 180")}
            onChange={(v) => v !== undefined && setSiteCoordinate(site.id, "lon", v)}
          />
        </FieldRow>
        <Checkbox checked={!site.hidden} onChange={(v) => setHidden(site.id, !v)} label="Drawn on the map" />
      </PanelSection>
      <NowSection lat={site.lat} lon={site.lon} sourceId={site.id} />
      <ProductCard product="solar" source={site} />
      <ProductCard product="wind" source={site} />
    </>
  )
}

function AreaBody({ area }: { area: AreaObject }) {
  const d = useStore(project).data
  const c = ringCentre(area.polygon)
  const latest = resultsOf(d, area.id).filter((r) => r.kind === "terrain").at(-1)
  return (
    <>
      <Head item={area} meta={`${polygonAreaKm2(area.polygon).toFixed(2)} km² · ${area.polygon.coordinates[0].length - 1} vertices`} />
      <PanelSection title="Geometry">
        <Figure label="Area" value={`${polygonAreaKm2(area.polygon).toFixed(2)} km²`} />
        <Figure label="Vertices" value={area.polygon.coordinates[0].length - 1} />
        <Figure label="Centre" value={`${formatLat(c.lat, 3)} ${formatLng(c.lon, 3)}`} />
        <Checkbox checked={!area.hidden} onChange={(v) => setHidden(area.id, !v)} label="Drawn on the map" />
      </PanelSection>
      <NowSection lat={c.lat} lon={c.lon} sourceId={area.id} />
      <ProductCard product="terrain" source={area} />
      {(latest?.kind === "terrain" || latest?.kind === "demand") && <ResultLayer result={latest} />}
      <ProductCard product="connection" source={area} />
    </>
  )
}

function ResultBody({ result }: { result: ResultObject }) {
  const d = useStore(project).data
  const source = findItem(d, result.sourceId)
  const stale = staleReason(d, result)
  const params = Object.entries(result.params as Record<string, unknown>)
  return (
    <>
      <Head item={result} meta={`${source ? source.name : "deleted source"} · ${result.createdAt.slice(0, 16).replace("T", " ")}`} />
      <PanelSection title="Figures" aside={<button type="button" className={btnGhostDense} onClick={() => showResult(result.id, result.kind)}><ArrowSquareOut className="size-3" />Read it</button>}>
        {stale && <StaleNote reason={stale} onRerun={() => void runOperator("RERUN")} />}
        <Figures result={result} />
      </PanelSection>
      <PanelSection title="Computed with">
        {params.length === 0 ? (
          <p className="text-body text-muted-foreground">Every setting at the engine's default. The reading states the values applied.</p>
        ) : (
          params.map(([k, v]) => <Figure key={k} label={PARAM_LABELS[k] ?? k} value={k === "season" ? seasonLabel(String(v)) : String(v)} />)
        )}
        {source && (
          <button type="button" className={`${btnGhostDense} self-start`} onClick={() => select(source.id)}>
            Select {source.name}
          </button>
        )}
      </PanelSection>
      {(result.kind === "terrain" || result.kind === "demand") && <ResultLayer result={result} />}
      <PanelSection title="Export">
        <div className="flex flex-wrap gap-1">
          <OperatorButton name="EXPORT_CSV" label="CSV" />
          <OperatorButton name="EXPORT_JSON" label="JSON" />
          {result.kind === "terrain" && <OperatorButton name="EXPORT_GEOTIFF" label="GeoTIFF" />}
        </div>
      </PanelSection>
    </>
  )
}

function ProjectBody() {
  const p = useStore(project)
  const s = useStore(sidecar)
  return (
    <>
      <div className="flex flex-col gap-0.5 px-2.5 pb-2 pt-2.5">
        <p className="eyebrow !text-[9px]">Project</p>
        {/* The name is the file's until it is saved under another; it can be changed here first. */}
        <TextField
          value={p.data.name}
          ariaLabel="Project name"
          onCommit={(v) => v.trim() && commit("Rename Project", (x) => ({ ...x, name: v.trim() }))}
          className="!text-[12px] font-medium"
        />
        <p className="telemetry selectable truncate text-[9px] text-muted-foreground">{p.path ?? "not saved yet"}</p>
      </div>
      <PanelSection title="Nothing is active">
        <p className="text-body leading-relaxed text-muted-foreground">
          Select a site, an area or a result in the Outliner or on the map. Its settings, its runs and its figures are edited here.
        </p>
      </PanelSection>
      <PanelSection title="Contents">
        <Figure label="Sites" value={p.data.sites.length} />
        <Figure label="Areas" value={p.data.areas.length} />
        <Figure label="Results" value={p.data.results.length} />
        <Figure label="Stale" value={p.data.results.filter((r) => staleReason(p.data, r)).length} />
        <Figure label="State" value={p.dirty ? "unsaved changes" : "saved"} />
        <div className="flex gap-1 pt-1">
          <OperatorButton name="SAVE" />
          {p.path && (
            <button type="button" className={btnGhostDense} onClick={() => void reveal(p.path!)}>
              Reveal
            </button>
          )}
        </div>
      </PanelSection>
      <PanelSection title="Calculation engine" aside={<OperatorButton name="PING" label="Check" />}>
        <Figure
          label="Status"
          value={
            <span style={{ color: s.kind === "failed" ? "var(--destructive-quiet)" : s.kind === "ready" ? "var(--success)" : undefined }}>
              {s.kind === "ready" ? `ready · Python ${s.version}` : s.kind === "failed" ? "unavailable" : "starting"}
            </span>
          }
        />
        {s.kind === "failed" && <p className="selectable text-meta text-destructive-quiet">{s.message}</p>}
      </PanelSection>
    </>
  )
}

export function PropertiesEditor() {
  const active = useActiveItem()
  return (
    <>
      <AreaHeader />
      <div className="panel-scroll h-full min-h-0 overflow-y-auto">
        {!active ? (
          <ProjectBody />
        ) : active.kind === "site" ? (
          <SiteBody site={active} />
        ) : active.kind === "area" ? (
          <AreaBody area={active} />
        ) : isResult(active) ? (
          <ResultBody result={active} />
        ) : null}
      </div>
    </>
  )
}

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { ArrowsClockwise, CircleNotch, Eye, Fan, Mountains, Play, PlugsConnected, Stop, Sun, Warning, type Icon } from "@phosphor-icons/react"
import { lastFailure, running } from "../../lib/analysis"
import { defaults } from "../../lib/defaults"
import { formatLat, formatLng } from "../../lib/format"
import { polygonAreaKm2 } from "../../lib/geo"
import { RUN_OPERATOR, runOperator, useOperator } from "../../lib/operators"
import {
  FALLBACK_SEASONS,
  CONNECTION_FIELDS,
  SOLAR_FIELDS,
  TERRAIN_FIELDS,
  WIND_FIELDS,
  fieldError,
  seasonLabel,
  setParam,
  windSettingsError,
  type Group,
  type NumberField as FieldDef,
} from "../../lib/params"
import { checkGridStore, dsnSourceLabel, gridStore, storeReachable, storeReport } from "../../lib/grid"
import { PRODUCT_NAMES, isAreaProduct, project, type Product } from "../../lib/project"
import {
  cardValues,
  currentInputs,
  defaultPlaces,
  lastRun,
  runGraph,
  type Place,
  type RunNodeId,
} from "../../lib/runGraph"
import { reading, signature, subject, supplied, type RunValue } from "../../lib/runValue"
import { areaStates, setAreaState, showResult } from "../../lib/screen"
import { activeArea, activeSite, select, selection } from "../../lib/selection"
import { useStore } from "../../lib/store"
import { NodeCanvas, type CanvasEdge, type CanvasNode, type EdgeState } from "../studio/NodeCanvas"
import { StudioHeaderMenu } from "../studio/HeaderControls"
import { AreaHeader } from "../studio/StudioArea"
import { btnGhostDense } from "../ui/buttons"
import { NumberField, Select } from "../ui/Fields"

/**
 * The run graph, as TERRA's board: one product's request laid out as cards,
 * each card one part of it, wired into the card that runs it.
 *
 * THE CARDS ARE THE SETTINGS, not a picture of them. A field on a card is the
 * project's setting, the same one Properties edits, so the graph is a second
 * way in rather than a second copy.
 *
 * THE WIRES ARE THE ANSWER'S PROVENANCE. Each says whether the reading on
 * screen read what its card holds now; see NodeCanvas for the five states.
 */

const PRODUCT_ICON: Record<Product, Icon> = { solar: Sun, terrain: Mountains, wind: Fan, connection: PlugsConnected }
const PRODUCTS: Product[] = ["solar", "terrain", "wind", "connection"]
const OPERATOR = RUN_OPERATOR

const EDGE_NOTE: Record<EdgeState, string> = {
  missing: "not set",
  pending: "pending",
  reading: "reading",
  read: "read",
  failed: "error",
}

const NOTE_COLOUR: Record<EdgeState, string | undefined> = {
  missing: undefined,
  pending: undefined,
  reading: "rgb(var(--p-accent))",
  read: "var(--success)",
  failed: "var(--destructive-quiet)",
}

/*
  A node's header says which part of a request it is, and its socket what
  kind of value it sends, as Blender colours a node by its category and a
  socket by its type. Both are declared in index.css, under the node editor.
*/
const kindOf = (v: RunValue) => subject(v) ?? "value"
const headOf = (v: RunValue) => `var(--node-head-${kindOf(v)})`
const socketOf = (v: RunValue) => `var(--node-socket-${kindOf(v)})`

// ---- Card positions, kept per product in this browser ----------------------------

// v2: the inputs became one column; positions kept from the two-column board would scatter them.
const PLACES_KEY = "terra-energy.graph.places.v2"

function readPlaces(): Partial<Record<Product, Record<string, Place>>> {
  try {
    return JSON.parse(localStorage.getItem(PLACES_KEY) ?? "{}") ?? {}
  } catch {
    return {}
  }
}

function useKeptPlaces(product: Product) {
  const [all, setAll] = useState(readPlaces)
  const write = (next: Partial<Record<Product, Record<string, Place>>>) => {
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify(next))
    } catch {
      /* a convenience: the cards fall back to their columns */
    }
    return next
  }
  const move = useCallback(
    (id: string, place: Place) => setAll((prev) => write({ ...prev, [product]: { ...prev[product], [id]: place } })),
    [product]
  )
  const reset = () => setAll((prev) => write({ ...prev, [product]: {} }))
  return [all[product] ?? {}, move, reset] as const
}

// ---- Card parts --------------------------------------------------------------------

const FIELDS: Record<Group, FieldDef<string>[]> = {
  solar: SOLAR_FIELDS,
  wind: WIND_FIELDS,
  terrain: TERRAIN_FIELDS,
  connection: CONNECTION_FIELDS,
}

/** A project setting, in a card: the drag field Properties uses, with its name inside it. */
function Param({ group, field, label }: { group: Group; field: string; label: string }) {
  const values = useStore(project).data.settings[group] as Record<string, number | undefined>
  const d = useStore(defaults)
  const f = FIELDS[group].find((x) => x.key === field)
  if (!f) return null
  return (
    <div className="flex" title={f.description}>
      <NumberField
        label={label}
        inlineLabel
        value={values[f.key]}
        fallback={d ? f.defaultOf(d) : undefined}
        step={f.step ?? (f.integer ? 1 : 0.1)}
        decimals={f.integer ? 0 : undefined}
        unit={f.unit}
        validate={(v) => fieldError(f, v)}
        onChange={(v) => setParam(group, f.key, v)}
      />
    </div>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-micro leading-relaxed text-muted-foreground">{children}</p>
}

// ---- The editor ----------------------------------------------------------------------

export function RunGraphEditor({ areaId }: { areaId: string }) {
  const d = useStore(project).data
  useStore(selection)
  const engine = useStore(defaults)
  const run = useStore(running)
  const failure = useStore(lastFailure)
  const stored = useStore(areaStates)[areaId]?.product as Product | undefined
  const site = activeSite()
  const area = activeArea()
  const product: Product = stored && PRODUCTS.includes(stored) ? stored : area ? "terrain" : "solar"
  const source = isAreaProduct(product) ? area : site
  const store = useStore(gridStore)
  const report = storeReport(store)
  // The store is asked about once, when a board first needs its card.
  useEffect(() => {
    if (product === "connection" && gridStore.get().kind === "unknown") void checkGridStore()
  }, [product])
  const busy = !!run && run.product === product && run.sourceId === source?.id
  const { poll } = useOperator(OPERATOR[product])

  const [places, move, resetPlaces] = useKeptPlaces(product)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const onMeasure = useCallback((id: string, h: number) => {
    setHeights((prev) => (Math.abs((prev[id] ?? 0) - h) < 0.5 ? prev : { ...prev, [id]: h }))
  }, [])

  const graph = runGraph(product)
  const fallback = defaultPlaces(graph, heights)
  const values = cardValues(currentInputs(d, product, site, area, storeReachable(store)), engine)
  const last = lastRun(d, product, source, failure)
  const lastValues = last ? cardValues(last.inputs, engine) : null
  const pct = run?.progress === null || !run ? null : Math.round(Math.max(0, Math.min(100, run.progress)))

  const sourcePicker = (kind: "site" | "area") => {
    const list = kind === "site" ? d.sites : d.areas
    const chosen = kind === "site" ? site : area
    return (
      <>
        {list.length ? (
          <Select
            value={chosen?.id ?? ""}
            ariaLabel={kind === "site" ? "Site" : "Area"}
            onChange={(id) => select(id || null)}
            options={[
              ...(chosen ? [] : [{ value: "", label: kind === "site" ? "Choose a site" : "Choose an area" }]),
              ...list.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        ) : (
          <Muted>{kind === "site" ? "No site in the project yet." : "No area in the project yet."}</Muted>
        )}
        {chosen?.kind === "site" && (
          <span className="telemetry text-micro text-muted-foreground">
            {formatLat(chosen.lat, 4)} {formatLng(chosen.lon, 4)}
          </span>
        )}
        {chosen?.kind === "area" && (
          <span className="telemetry text-micro text-muted-foreground">{polygonAreaKm2(chosen.polygon).toFixed(2)} km²</span>
        )}
        <button
          type="button"
          className={`${btnGhostDense} !h-6 self-start`}
          onClick={() => void runOperator(kind === "site" ? "TOOL_SITE" : "TOOL_AREA")}
          title={kind === "site" ? "Click the map to add a site (P)" : "Draw an area on the map (D)"}
        >
          {kind === "site" ? "Place a site" : "Draw an area"}
        </button>
      </>
    )
  }

  const seasons = engine?.terrain.seasons?.length ? engine.terrain.seasons : FALLBACK_SEASONS
  const roughnessError = windSettingsError(d.settings.wind)

  const body: Record<RunNodeId, ReactNode> = {
    site: sourcePicker("site"),
    area: sourcePicker("area"),
    record:
      product === "wind" ? (
        <>
          <Param group="wind" field="recordYears" label="Years" />
          <Param group="wind" field="recordMaxFloorMS" label="Max floor" />
        </>
      ) : (
        <Param group={product} field="hourlyYears" label="Hourly" />
      ),
    radiation: <Param group="solar" field="climatologyYears" label="Climatology" />,
    product: (
      <Select
        value={product}
        ariaLabel="Product"
        onChange={(v) => setAreaState(areaId, { product: v as Product })}
        options={PRODUCTS.map((p) => ({ value: p, label: PRODUCT_NAMES[p] }))}
      />
    ),
    array: <Param group="solar" field="surfaceAzimuth" label="Azimuth" />,
    store: (
      <>
        <div className="flex items-center gap-1.5">
          <span
            className={`size-1.5 shrink-0 rounded-full ${store.kind === "checking" ? "animate-pulse bg-accent" : report?.reachable ? "bg-success" : "bg-muted-foreground/50"}`}
          />
          <span className="telemetry text-meta text-foreground">
            {store.kind === "checking" ? "checking" : report ? (report.reachable ? "reachable" : "unreachable") : store.kind === "failed" ? "not checked" : "unknown"}
          </span>
          {report && <span className="ml-auto truncate text-micro text-muted-foreground">{dsnSourceLabel(report.dsn_source)}</span>}
        </div>
        {report && (
          <span className="telemetry selectable truncate text-micro text-muted-foreground" title={report.dsn}>
            {report.dsn}
          </span>
        )}
        {(report?.unreachable || store.kind === "failed") && (
          <p className="line-clamp-3 text-micro leading-snug text-muted-foreground" title={report?.unreachable ?? (store.kind === "failed" ? store.message : "")}>
            {report?.unreachable ?? (store.kind === "failed" ? store.message : "")}
          </p>
        )}
        {report?.reachable && report.coverage && (
          <span className="text-micro text-muted-foreground">
            {report.coverage.plants.registered.toLocaleString()} plants · {report.coverage.network.lines_in_service.toLocaleString()} lines
          </span>
        )}
        <button
          type="button"
          className={`${btnGhostDense} !h-6 self-start`}
          disabled={store.kind === "checking"}
          onClick={() => void checkGridStore(true)}
          title="Ask the grid store again; Settings › Grid store chooses another"
        >
          <ArrowsClockwise className="size-3" />
          Check again
        </button>
      </>
    ),
    reach: <Param group="connection" field="searchRadiusKm" label="Radius" />,
    performance: <Param group="solar" field="performanceRatio" label="Ratio" />,
    season: (
      <Select
        value={d.settings.terrain.season ?? ""}
        ariaLabel="Season"
        onChange={(v) => setParam("terrain", "season", v || undefined)}
        options={[
          { value: "", label: `Default (${engine ? seasonLabel(engine.terrain.season) : "engine"})` },
          ...seasons.map((id) => ({ value: id, label: seasonLabel(id) })),
        ]}
      />
    ),
    turbine: (
      <>
        <Param group="wind" field="hubHeightM" label="Hub" />
        <Param group="wind" field="calmThresholdMS" label="Calm below" />
      </>
    ),
    roughness: (
      <>
        <Param group="wind" field="roughnessLowM" label="Low" />
        <Param group="wind" field="roughnessHighM" label="High" />
        {roughnessError && (
          <p className="text-micro leading-snug" style={{ color: "var(--warning)" }}>
            {roughnessError}.
          </p>
        )}
      </>
    ),
    run: (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => poll === true && void runOperator(OPERATOR[product])}
          aria-disabled={poll !== true || undefined}
          title={poll === true ? `Run ${PRODUCT_NAMES[product].toLowerCase()}` : poll}
          className={`flex w-full items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-meta transition-colors focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring ${
            poll !== true || busy ? "cursor-not-allowed bg-control text-muted-foreground" : "bg-accent font-semibold text-accent-foreground hover:opacity-90"
          }`}
        >
          {busy ? <CircleNotch className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Run {PRODUCT_NAMES[product].toLowerCase()}
        </button>

        {busy && run && (
          <div className="flex flex-col gap-1">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="telemetry shrink-0 text-[9px] tabular-nums text-muted-foreground">{pct === null ? "…" : `${pct}%`}</span>
              <span className="min-w-0 flex-1 truncate text-meta text-foreground" title={run.message}>
                {run.message || "Running"}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-line-strong/30">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${pct ?? 0}%` }}
                role="progressbar"
                aria-valuenow={pct ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${PRODUCT_NAMES[product]} progress`}
              />
            </div>
            <button type="button" className={`${btnGhostDense} !h-6`} onClick={() => void runOperator("CANCEL")}>
              <Stop className="size-3" />
              Cancel
            </button>
          </div>
        )}

        {!busy && poll !== true && <Muted>{poll}.</Muted>}

        {!busy && last && !last.ok && (
          <p className="flex items-start gap-1 text-micro leading-snug text-destructive-quiet">
            <Warning className="mt-px size-3 shrink-0" />
            The last attempt failed. Reports has the reason.
          </p>
        )}

        {!busy && last?.ok && last.resultId && (
          <button type="button" className={`${btnGhostDense} !h-6`} onClick={() => showResult(last.resultId!, product)}>
            <Eye className="size-3" />
            Show the reading
          </button>
        )}
      </div>
    ),
  }

  const state = (from: RunNodeId): EdgeState => {
    const value = values[from]
    if (!supplied(value)) return "missing"
    if (busy) return "reading"
    if (lastValues && signature(lastValues[from]) === signature(value)) return last!.ok ? "read" : "failed"
    return "pending"
  }

  const nodes: CanvasNode[] = graph.nodes.map((spec) => {
    const common = { id: spec.id, place: places[spec.id] ?? fallback[spec.id], h: heights[spec.id] ?? spec.h, children: body[spec.id] }
    if (spec.id === "run") {
      return {
        ...common,
        title: spec.label,
        head: "var(--node-head-run)",
        inputs: graph.edges.map(([from]) => {
          const st = state(from)
          return {
            id: from,
            label: graph.nodes.find((n) => n.id === from)?.label ?? from,
            colour: socketOf(values[from]),
            note: EDGE_NOTE[st],
            noteColour: NOTE_COLOUR[st],
          }
        }),
      }
    }
    const value = values[spec.id]
    return {
      ...common,
      title: spec.label,
      head: headOf(value),
      output: { id: "out", label: reading(value) || "none", colour: socketOf(value) },
    }
  })

  const edges: CanvasEdge[] = graph.edges.map(([from, to]) => ({
    from,
    to,
    socket: from,
    colour: socketOf(values[from]),
    state: state(from),
  }))

  return (
    <>
      <AreaHeader
        menus={
          <StudioHeaderMenu
            label="View"
            items={() => [
              ...PRODUCTS.map((p) => ({
                type: "action" as const,
                label: PRODUCT_NAMES[p],
                icon: PRODUCT_ICON[p],
                checked: p === product,
                run: () => setAreaState(areaId, { product: p }),
              })),
              { type: "sep" as const },
              { type: "action" as const, label: "Put the nodes back in columns", run: resetPlaces },
            ]}
          />
        }
        centre={
          <span className="header-label truncate text-meta text-muted-foreground">
            {PRODUCT_NAMES[product]}
            {source ? ` ${product === "terrain" ? "over" : "at"} ${source.name}` : ""}
          </span>
        }
      />
      <NodeCanvas nodes={nodes} edges={edges} onMove={move} onMeasure={onMeasure} />
    </>
  )
}

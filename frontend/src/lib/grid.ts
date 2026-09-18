import type { FeatureCollection, LineString, Point } from "geojson"
import { GridNetwork, GridPlants, InspectGridStore, SetGridStore } from "../../wailsjs/go/main/App"
import type { grid } from "../../wailsjs/go/models"
import { errorMessage } from "./errors"
import { fail, info, note } from "./reports"
import { createStore } from "./store"

/**
 * The grid store: the local PostGIS database TERRA loads with the Brazilian
 * electrical record, as TERRA's plantRegister.ts and its store card read it.
 *
 * Three things live here: whether the store answered and what it holds, the
 * plant register and the transmission network as map layers, and the words
 * the record's codes stand for. The layers are read once per session and only
 * when first drawn: the register is several megabytes, and a map with the
 * layer off should not pay for it.
 */

// ---- The store ----------------------------------------------------------------------

export type GridStoreState =
  | { kind: "unknown" }
  | { kind: "checking"; last: grid.StoreReport | null }
  | { kind: "known"; report: grid.StoreReport }
  | { kind: "failed"; message: string }

export const gridStore = createStore<GridStoreState>({ kind: "unknown" })

/** The last report, whatever is happening now. */
export function storeReport(s: GridStoreState = gridStore.get()): grid.StoreReport | null {
  return s.kind === "known" ? s.report : s.kind === "checking" ? s.last : null
}

export const storeReachable = (s: GridStoreState = gridStore.get()) => !!storeReport(s)?.reachable

/** Where the DSN came from, in the words the settings screen uses. */
export function dsnSourceLabel(source: string): string {
  if (source === "TERRA_BR_DSN") return "set by TERRA_BR_DSN"
  if (source === "chosen") return "chosen here"
  return "the default"
}

function settle(report: grid.StoreReport, announce: boolean): void {
  const wasReachable = storeReachable()
  gridStore.set({ kind: "known", report })
  // A store that came back is read again, so layers asked for while it was away arrive.
  if (report.reachable && !wasReachable) retryLayers()
  if (!announce) return
  if (report.reachable) {
    const c = report.coverage
    info(`Grid store reachable: ${c?.plants.registered.toLocaleString() ?? 0} plants, ${c?.network.lines_in_service.toLocaleString() ?? 0} lines in service.`)
  } else {
    fail(`Grid store unreachable: ${report.unreachable}`)
  }
}

/** Check the store. Quiet unless `announce`, which a button that asked for it sets. */
export async function checkGridStore(announce = false): Promise<void> {
  gridStore.set({ kind: "checking", last: storeReport() })
  try {
    settle(await InspectGridStore(), announce)
  } catch (e) {
    const message = errorMessage(e)
    gridStore.set({ kind: "failed", message })
    if (announce) fail(`Could not check the grid store: ${message}`)
  }
}

/**
 * Point the grid products at another store; an empty DSN returns to the
 * default. The shell refuses a store that does not answer and saves nothing,
 * so the report comes back unreachable and the choice is unchanged.
 */
export async function chooseGridStore(dsn: string): Promise<boolean> {
  gridStore.set({ kind: "checking", last: storeReport() })
  try {
    const report = await SetGridStore(dsn)
    const refused = !!dsn.trim() && !report.reachable && report.dsn_source === "chosen"
    settle(report, false)
    if (refused) {
      fail(`Not saved: ${report.unreachable}`)
      return false
    }
    if (report.dsn_source === "TERRA_BR_DSN") note("Saved, but TERRA_BR_DSN is set and is what the grid products read.")
    else info(dsn.trim() ? "Grid store chosen." : "Grid store back to the default.")
    return true
  } catch (e) {
    const message = errorMessage(e)
    gridStore.set({ kind: "failed", message })
    fail(`Could not set the grid store: ${message}`)
    return false
  }
}

// ---- The layers ---------------------------------------------------------------------

export type PlantProps = {
  ceg: string
  name: string
  kind: string | null
  uf: string | null
  municipality: string | null
  mw: number | null
  since: string | null
  metered: boolean
}

export type LineProps = {
  id: number
  name: string
  kv: number | null
  mva: number | null
  in_service: boolean
  published_km: number | null
  straight_km: number | null
}

export type BusProps = {
  bus: number
  name: string
  kv: number | null
  uf: string | null
  subsystem: string | null
  operator: string | null
}

export type PlantRegister = {
  geojson: FeatureCollection<Point, PlantProps>
  counts: grid.PlantCounts
  note: string
}

export type NetworkRegister = {
  lines: FeatureCollection<LineString, LineProps>
  substations: FeatureCollection<Point, BusProps>
  counts: grid.NetworkCounts
  routeFactor: grid.RouteFactor
  note: string
}

export type LayerState<T> = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; data: T } | { kind: "failed"; message: string }

export const plantRegister = createStore<LayerState<PlantRegister>>({ kind: "idle" })
export const networkRegister = createStore<LayerState<NetworkRegister>>({ kind: "idle" })

/** Read the plant register, once. A failure is kept, and retried when asked again. */
export function loadPlants(): void {
  const s = plantRegister.get()
  if (s.kind === "loading" || s.kind === "ready") return
  plantRegister.set({ kind: "loading" })
  GridPlants()
    .then((layer) => {
      // The Go side passes the collection through undecoded; it arrives parsed.
      plantRegister.set({ kind: "ready", data: { geojson: layer.geojson, counts: layer.counts, note: layer.note } })
    })
    .catch((e) => plantRegister.set({ kind: "failed", message: errorMessage(e) }))
}

/** Read the transmission register, once. */
export function loadNetwork(): void {
  const s = networkRegister.get()
  if (s.kind === "loading" || s.kind === "ready") return
  networkRegister.set({ kind: "loading" })
  GridNetwork()
    .then((layer) =>
      networkRegister.set({
        kind: "ready",
        data: {
          lines: layer.lines,
          substations: layer.substations,
          counts: layer.counts,
          routeFactor: layer.route_factor,
          note: layer.note,
        },
      })
    )
    .catch((e) => networkRegister.set({ kind: "failed", message: errorMessage(e) }))
}

function retryLayers(): void {
  if (plantRegister.get().kind === "failed") {
    plantRegister.set({ kind: "idle" })
    loadPlants()
  }
  if (networkRegister.get().kind === "failed") {
    networkRegister.set({ kind: "idle" })
    loadNetwork()
  }
}

/** Forget both layers, so the next draw reads the store now chosen. */
export function forgetLayers(): void {
  plantRegister.set({ kind: "idle" })
  networkRegister.set({ kind: "idle" })
}

// ---- The record's words ---------------------------------------------------------------

/** What ONS's restriction reasons stand for (TERRA's curtailment.py REASON_MEANING). */
export const REASON_MEANING: Record<string, string> = {
  ENE: "surplus energy: more generation offered than the system can absorb",
  CNF: "reliability: the system could not securely accept the output",
  REL: "reliability of the plant or its connection",
  PAR: "scheduled outage or partial availability",
}

/** Where a restriction originated. LOC is the one a siting decision can act on. */
export const ORIGIN_MEANING: Record<string, string> = {
  LOC: "local, at this connection",
  SIS: "systemic, across the subsystem",
}

/**
 * The colours ANEEL's own network map uses by voltage (TERRA's gridVoltage.ts),
 * so a line reads as the level a reader who knows that map expects.
 */
export const VOLTAGE_COLOUR: readonly { kv: number; colour: string }[] = [
  { kv: 138, colour: "#F3C71F" },
  { kv: 230, colour: "#1A9B43" },
  { kv: 345, colour: "#00A2EC" },
  { kv: 440, colour: "#B684A1" },
  { kv: 500, colour: "#C90E16" },
]
export const UNNAMED_VOLTAGE = "#C6D4E1"

export const km = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)} km`)
export const mw = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v).toLocaleString()} MW`)
export const kv = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v)} kV`)
export const mwh = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(2)} TWh` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} GWh` : `${Math.round(v)} MWh`
export const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`)

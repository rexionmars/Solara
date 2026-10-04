import type { Feature, FeatureCollection, LineString, Point } from "geojson"
import {
  DisconnectGridStore,
  GridConcessions,
  GridDemandReach,
  GridNetwork,
  GridPlants,
  GridStoreConnection,
  GridTownDemand,
  InspectGridStore,
  ParseGridStoreURL,
  SetGridStore,
  SetGridStoreConnection,
  TestGridStore,
} from "../../wailsjs/go/main/App"
import { energy } from "../../wailsjs/go/models"
import type { grid } from "../../wailsjs/go/models"
import { errorMessage } from "./errors"
import { stateMesh, type CatalogueFrom } from "./places"
import { fail, info, note } from "./reports"
import { createStore, type Store } from "./store"

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

/** What kind of store answered and what it can do; null until one has. */
export const storeInfo = (s: GridStoreState = gridStore.get()) => storeReport(s)?.coverage?.store ?? null

/**
 * Where the catalogue of areas reads: the store's own boundaries when it
 * carries them, IBGE's when the store is TERRA's and so the ground is Brazil,
 * and otherwise the boundaries of any country, which need no store at all.
 */
export function catalogueSource(s: GridStoreState = gridStore.get()): CatalogueFrom {
  const report = storeReport(s)
  const caps = report?.reachable ? report.coverage?.store?.capabilities : undefined
  if (caps?.boundaries) return { store: report!.dsn }
  if (caps?.brazil) return "ibge"
  return "world"
}

export const storeReachable = (s: GridStoreState = gridStore.get()) => !!storeReport(s)?.reachable

/** Where the DSN came from, in the words the settings screen uses. */
export function dsnSourceLabel(source: string): string {
  if (source === "TERRA_BR_DSN") return "set by TERRA_BR_DSN"
  if (source === "chosen") return "connected here"
  return "not connected"
}

function settle(report: grid.StoreReport, announce: boolean): void {
  const wasReachable = storeReachable()
  gridStore.set({ kind: "known", report })
  // A store that came back is read again, so layers asked for while it was away arrive.
  if (report.reachable && (!wasReachable || announce)) retryLayers()
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
 * Point the grid products at another store. The shell refuses a store that
 * does not answer and saves nothing, so the report comes back unreachable and
 * the choice is unchanged. `named` is whether a store was named at all: 
 * disconnecting is never refused.
 */
async function choose(ask: () => Promise<grid.StoreReport>, named: boolean): Promise<boolean> {
  gridStore.set({ kind: "checking", last: storeReport() })
  try {
    const report = await ask()
    const refused = named && !report.reachable && report.dsn_source === "chosen"
    settle(report, false)
    if (refused) {
      fail(`Not saved: ${report.unreachable}`)
      return false
    }
    if (report.dsn_source === "TERRA_BR_DSN") note("Saved, but TERRA_BR_DSN is set and is what the grid products read.")
    else info(named ? "Grid store connected." : "Grid store disconnected.")
    return true
  } catch (e) {
    const message = errorMessage(e)
    // What was known about the store in use still holds: nothing was changed.
    const last = storeReport()
    gridStore.set(last ? { kind: "known", report: last } : { kind: "failed", message })
    fail(`Could not set the grid store: ${message}`)
    return false
  }
}

/** Point the grid products at a connection string; an empty one disconnects, and nothing is read until another is connected. */
export const chooseGridStore = (dsn: string) => choose(() => SetGridStore(dsn), !!dsn.trim())

// ---- The connection card --------------------------------------------------------------

/**
 * The store's connection as the fields of its card. Every field may be empty,
 * which is the driver's own default for it; `has_password` says a password is
 * saved that the card was never given, and an empty password then keeps it.
 */
export type StoreConnection = grid.StoreConnection

export const EMPTY_CONNECTION: StoreConnection = { host: "", port: "", user: "", password: "", database: "", ssl_mode: "", has_password: false }

/** The store chosen here, as fields. Empty when none was chosen, or when it was written in a form the card does not read. */
export async function savedConnection(): Promise<StoreConnection> {
  try {
    return await GridStoreConnection()
  } catch {
    return { ...EMPTY_CONNECTION }
  }
}

/** A pasted connection string as fields, or null with the reason said. */
export async function importConnection(url: string): Promise<StoreConnection | null> {
  try {
    return await ParseGridStoreURL(url)
  } catch (e) {
    fail(`Could not import the connection: ${errorMessage(e)}`)
    return null
  }
}

/** Whether the store the fields describe answers, and what it holds. Changes nothing. */
export async function testGridStore(conn: StoreConnection): Promise<grid.StoreReport | { failed: string }> {
  try {
    return await TestGridStore(conn)
  } catch (e) {
    return { failed: errorMessage(e) }
  }
}

/** Stop reading the store for this session; the connection stays remembered for the next Connect. */
export const disconnectGridStore = () => choose(() => DisconnectGridStore(), false)

/** Point the grid products at the store the fields describe. */
export const chooseGridConnection = (conn: StoreConnection) => choose(() => SetGridStoreConnection(conn), true)

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

/**
 * Consumption by municipality, joined to IBGE's mesh of the states the
 * register reaches.
 *
 * A LAYER, NOT A READING. Until this existed the map said nothing about where
 * consumption is, so choosing a ground to read was choosing blind -- the same
 * argument the plant register's layer is written on. The figures come from the
 * BDGD in the store; the shapes come from IBGE, joined on the municipality
 * code both of them carry.
 */
export const townDemand = createStore<LayerState<TownDemandLayer>>({ kind: "idle" })

export type TownDemandLayer = {
  geojson: FeatureCollection
  /** The highest municipal consumption, which the ramp is drawn against. */
  max: number
  towns: number
  /** Every register drawn; the layer is not about one of them. */
  registers: { distribuidora: string; ano: number }[]
  unit: string
  note: string
}

/**
 * Read the municipal figures and the meshes they are drawn on, once.
 *
 * The mesh is fetched per state because that is how IBGE publishes it, and
 * only for the states the register actually reaches: a distributor of Rio
 * Grande do Norte asks for one.
 */
export function loadTownDemand(): void {
  const s = townDemand.get()
  if (s.kind !== "idle") return
  townDemand.set({ kind: "loading" })
  GridTownDemand()
    .then(async (layer) => {
      const byCode = new Map(layer.municipios.map((t) => [String(t.mun), t]))
      const features: Feature[] = []
      for (const uf of layer.ufs) {
        const mesh = await stateMesh(uf)
        for (const f of mesh.features) {
          const code = String((f.properties as { codarea?: string } | null)?.codarea ?? "")
          const town = byCode.get(code)
          // A municipality the register does not reach is left out rather than
          // drawn as zero: the two are different facts.
          if (!town) continue
          features.push({
            ...f,
            properties: {
              code,
              energy: town.energia_ano_mwh,
              units: town.unidades,
              injected: town.injetada_ano_mwh,
              generators: town.geradores,
              distribuidora: town.distribuidora,
            },
          })
        }
      }
      townDemand.set({
        kind: "ready",
        data: {
          geojson: { type: "FeatureCollection", features },
          max: Math.max(1, ...features.map((f) => Number(f.properties?.energy ?? 0))),
          towns: features.length,
          registers: layer.registros,
          unit: layer.unit,
          note: layer.nota,
        },
      })
    })
    .catch((e) => townDemand.set({ kind: "failed", message: errorMessage(e) }))
}

/**
 * Where each register the store holds actually reaches.
 *
 * THE LAYER THAT SAYS WHETHER A QUESTION CAN BE ASKED. A demand reading is
 * always about one distributor, and the register exists only where that
 * distributor is the distributor; ground outside every shape here comes back
 * empty, and ground outside all of them with more than one holding loaded is
 * REFUSED, because the reading will not guess which register it is about.
 * Neither fact is knowable from the map without this.
 *
 * The shapes come from the store itself -- the union of each register's
 * tariff sets -- so unlike the municipal layer it needs nothing from the
 * network and costs tens of kilobytes.
 */
export const concessions = createStore<LayerState<ConcessionLayer>>({ kind: "idle" })

// ---- How much of one area each register covers, before a reading is run --------------

/** One register measured against one ground, as the reading itself measures it. */
export type ReachCoverage = {
  distribuidora: string
  ano: number
  unidades: number
  area_km2: number
  concessao_km2: number
  dentro_km2: number
  /** Null where the ground has no area to divide by. */
  cobertura_pct: number | null
}

export type ReachProbe = {
  holdings: { distribuidora: string; ano: number; unidades: number }[]
  /** Most ground first. Empty where the store carries no tariff sets to measure against. */
  coberturas: ReachCoverage[]
  note: string
}

/**
 * How much of an area each loaded register can answer about.
 *
 * PER AREA AND NOT PER SESSION, which is why this is not one of the layer
 * stores above: the answer is about a ground, so a second area is a second
 * question. Kept by area id so returning to an area does not ask again.
 *
 * The figure is the one `coverage()` computes inside the reading, from the
 * same function on the unsimplified tariff sets -- NOT measured off the
 * concession layer, which is simplified to about 200 m and would put a second
 * number for one quantity on screen.
 */
export const reachByArea = createStore<Record<string, { key: string; state: LayerState<ReachProbe> }>>({})

/*
  THE GROUND IS PART OF THE KEY, not just the area's identity. An area that is
  redrawn keeps its id, and a probe stored under the id alone would answer
  about the shape that is gone. The key is the ring itself, so a moved area is
  a question that has not been asked yet.
*/
const ringKey = (polygon: { coordinates: number[][][] }) => JSON.stringify(polygon.coordinates)

export function loadReach(areaId: string, polygon: { type: string; coordinates: number[][][] }): void {
  const key = ringKey(polygon)
  const held = reachByArea.get()[areaId]
  if (held?.key === key && (held.state.kind === "loading" || held.state.kind === "ready")) return
  const set = (state: LayerState<ReachProbe>) => reachByArea.set({ ...reachByArea.get(), [areaId]: { key, state } })
  set({ kind: "loading" })
  GridDemandReach(energy.Polygon.createFrom(polygon))
    .then((probe) =>
      set({
        kind: "ready",
        data: {
          holdings: probe.holdings ?? [],
          coberturas: (probe.coberturas ?? []) as ReachCoverage[],
          note: probe.nota ?? "",
        },
      }),
    )
    .catch((e) => set({ kind: "failed", message: errorMessage(e) }))
}

/** What a clicked reach says about itself. */
export type ReachProps = {
  name: string
  distribuidora: string
  ano: number
  units: number
  areaKm2: number | null
}

export type ConcessionLayer = {
  geojson: FeatureCollection
  /** Every holding, including one whose reach the load did not bring. */
  holdings: { distribuidora: string; ano: number; unidades: number }[]
  /** Holdings that have no shape to draw; named so the map can say which. */
  undrawn: string[]
  note: string
}

export function loadConcessions(): void {
  const s = concessions.get()
  if (s.kind !== "idle") return
  concessions.set({ kind: "loading" })
  GridConcessions()
    .then((layer) => {
      const features: Feature[] = []
      const undrawn: string[] = []
      for (const c of layer.concessoes) {
        const name = `${c.distribuidora} · ${c.ano}`
        if (!c.geometry) {
          undrawn.push(name)
          continue
        }
        features.push({
          type: "Feature",
          geometry: c.geometry as unknown as Feature["geometry"],
          properties: {
            name,
            distribuidora: c.distribuidora,
            ano: c.ano,
            units: c.unidades,
            areaKm2: c.area_km2 ?? null,
            // Two lines drawn on the shape itself. A polygon nobody can name
            // is decoration: the reader has to know WHOSE register this is
            // without clicking it first.
            label: `${c.distribuidora}\n${c.ano} register · ${c.unidades.toLocaleString()} units`,
          } satisfies ReachProps & { label: string },
        })
      }
      concessions.set({
        kind: "ready",
        data: {
          geojson: { type: "FeatureCollection", features },
          holdings: layer.holdings,
          undrawn,
          note: layer.nota,
        },
      })
    })
    .catch((e) => concessions.set({ kind: "failed", message: errorMessage(e) }))
}

export const plantRegister = createStore<LayerState<PlantRegister>>({ kind: "idle" })
export const networkRegister = createStore<LayerState<NetworkRegister>>({ kind: "idle" })

/** Read the plant register, once. A failure is kept, and retried when asked again. */
export function loadPlants(): void {
  const s = plantRegister.get()
  if (s.kind !== "idle") return
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
  if (s.kind !== "idle") return
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

/*
  A failed layer is not asked for again by the draw that shows it failed: the
  map syncs on every change of these stores, so a load that retried on failure
  would be a loop of requests against a store that is not there. It is asked
  again here, when the store answers or is checked by hand, and by
  forgetLayers when another store is connected.
*/
function retryLayers(): void {
  for (const layer of [plantRegister, networkRegister, concessions, townDemand] as Store<LayerState<unknown>>[]) {
    if (layer.get().kind === "failed") layer.set({ kind: "idle" })
  }
}

/** Forget every layer read from the store, so the next draw reads the store now connected, or nothing. */
export function forgetLayers(): void {
  plantRegister.set({ kind: "idle" })
  networkRegister.set({ kind: "idle" })
  concessions.set({ kind: "idle" })
  townDemand.set({ kind: "idle" })
  reachByArea.set({})
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

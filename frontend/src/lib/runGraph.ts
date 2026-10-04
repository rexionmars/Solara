import type { energy } from "../../wailsjs/go/models"
import type { RunFailure } from "./analysis"
import { seasonLabel } from "./params"
import {
  type AreaObject,
  type ConnectionParams,
  type DemandParams,
  type Polygon,
  type Product,
  type ProjectData,
  type SiteObject,
  type SolarParams,
  type TerrainParams,
  type WindParams,
} from "./project"
import type { RunValue } from "./runValue"

/**
 * The shape of a run, as TERRA's runGraph.ts: one node per part of the
 * request, and a wire from each into an input of the run node.
 *
 * FAN-IN, and only fan-in. Every product here is a request whose parts are
 * independent of each other, so every wire ends at the run card; there is no
 * gate between two inputs to draw.
 */

export type RunNodeId =
  | "catalogue"
  | "site"
  | "area"
  | "record"
  | "radiation"
  | "product"
  | "array"
  | "performance"
  | "season"
  | "turbine"
  | "roughness"
  | "store"
  | "reach"
  | "ceiling"
  | "cell"
  | "catalogue2"
  | "region"
  | "layer"
  | "mapdraw"
  | "run"

export interface RunNodeSpec {
  id: RunNodeId
  label: string
  col: number
  /**
   * Which cluster on the board this card belongs to.
   *
   * The board holds more than one graph. They share a canvas and nothing
   * else: no wire crosses between them, and the default layout gives each its
   * own band so the reader sees two things rather than one tangle.
   */
  band: number
  /** A first guess at the card's height, replaced by its measurement once drawn. */
  h: number
}

export const NODE_W = 208
export const COL_GAP = 120
export const ROW_GAP = 16
/** Between one band and the next: wide enough that nobody reads them as one column. */
export const BAND_GAP = 90

const SPEC: Record<RunNodeId, Omit<RunNodeSpec, "col" | "band">> = {
  // Taller than the rest because it holds a list; it is the card a run over an
  // area starts at.
  catalogue: { id: "catalogue", label: "Catalogue", h: 300 },
  site: { id: "site", label: "Site", h: 96 },
  area: { id: "area", label: "Area", h: 96 },
  record: { id: "record", label: "Record", h: 74 },
  radiation: { id: "radiation", label: "Radiation", h: 74 },
  product: { id: "product", label: "Product", h: 74 },
  array: { id: "array", label: "Array", h: 74 },
  performance: { id: "performance", label: "Performance", h: 74 },
  season: { id: "season", label: "Season", h: 74 },
  turbine: { id: "turbine", label: "Turbine", h: 100 },
  roughness: { id: "roughness", label: "Roughness", h: 100 },
  store: { id: "store", label: "Grid store", h: 290 },
  reach: { id: "reach", label: "Reach", h: 74 },
  ceiling: { id: "ceiling", label: "Yield ceiling", h: 74 },
  cell: { id: "cell", label: "Layer cell", h: 74 },
  catalogue2: { id: "catalogue2", label: "Catalogue", h: 300 },
  region: { id: "region", label: "Region", h: 118 },
  layer: { id: "layer", label: "Layer", h: 132 },
  mapdraw: { id: "mapdraw", label: "Map", h: 118 },
  run: { id: "run", label: "Run", h: 96 },
}

export interface RunGraph {
  nodes: readonly RunNodeSpec[]
  edges: readonly (readonly [RunNodeId, RunNodeId])[]
}

const at = (id: RunNodeId, col: number, band = 0): RunNodeSpec => ({ ...SPEC[id], col, band })

/*
  ONE COLUMN OF INPUTS, in the order of the run node's rows, so no wire
  crosses another or passes under a node: where, what, when, then the values.

  THE CATALOGUE IS THE EXCEPTION, and it is an exception about what a wire
  means. Every other wire carries a value the run is made of, and ends at the
  run card. The catalogue's wire ends at the AREA card, because what it
  supplies is the ground itself: the area products have no other source of one
  since the drawing tool was removed, and a graph that showed the area arriving
  from nowhere would be hiding the only step the reader has to take.
*/
/**
 * What a graph can be about.
 *
 * The five products are a request each. "map" is not a request at all -- it
 * ends at the screen instead of at a run -- but it is the same question in
 * the same words: what ground, read how, drawn where. A reader who has
 * learnt one graph has learnt the other, which is the whole reason it lives
 * here rather than in a popover of its own.
 */
/** The map's cards, which are on every board and belong to no product. */
export const MAP_NODES = ["region", "layer", "mapdraw"] as const
export const isMapNode = (id: RunNodeId): boolean => (MAP_NODES as readonly string[]).includes(id)

const INPUTS: Record<Product, RunNodeId[]> = {
  solar: ["site", "product", "record", "radiation", "array", "performance"],
  wind: ["site", "product", "record", "turbine", "roughness"],
  terrain: ["area", "product", "record", "season"],
  connection: ["area", "product", "store", "reach"],
  demand: ["area", "product", "store", "ceiling", "cell"],
}

/**
 * One board, two graphs.
 *
 * THE RUN, in the top band: what the chosen product reads, ending at the card
 * that runs it. THE MAP, in the band below: what ground a layer is drawn over
 * and whether it is drawn, ending at the screen.
 *
 * They are not wired to each other and must not be. A run answers about a
 * ground the reader chose; a layer is drawn before any ground is chosen, so a
 * wire between them would claim an order that does not exist. What they share
 * is the vocabulary -- a card is a setting, a wire is where a value goes --
 * which is the whole reason the map is configured here and not in a popover
 * of checkboxes nobody could read.
 */
export function runGraph(product: Product): RunGraph {
  const inputs = INPUTS[product]
  const overArea = inputs.includes("area")
  const col = overArea ? 1 : 0
  const run = [...inputs.map((id) => at(id, col)), at("run", col + 1)]
  const runEdges = inputs.map((id) => [id, "run"] as const)
  const nodes = overArea ? [at("catalogue", 0), ...run] : run
  const edges = overArea ? [["catalogue", "area"] as const, ...runEdges] : runEdges

  /*
    THE STORE'S CARD IS ON EVERY BOARD. It is where a store is connected, and
    it used to exist only on the two products that read one in their run: on
    a solar or wind board there was nowhere to connect at all, while the map
    below drew its layers from that same store. Where the run does not take
    it, it stands in the map's band and feeds the map, which is what reads it
    there.
  */
  const storeOnMap = !inputs.includes("store")
  // The map's own chain, in its own band: catalogue, ground, layer, screen.
  const mapNodes = [
    at("catalogue2", 0, 1),
    at("region", 1, 1),
    at("layer", 1, 1),
    ...(storeOnMap ? [at("store", 1, 1)] : []),
    at("mapdraw", 2, 1),
  ]
  const mapEdges = [
    ["catalogue2", "region"] as const,
    ["region", "mapdraw"] as const,
    ["layer", "mapdraw"] as const,
    // The store feeds the map from wherever its card stands.
    ["store", "mapdraw"] as const,
  ]
  return { nodes: [...nodes, ...mapNodes], edges: [...edges, ...mapEdges] }
}

export type Place = { x: number; y: number }

/** Columns left to right, each centred on the tallest. */
export function defaultPlaces(graph: RunGraph, measured: Readonly<Record<string, number>> = {}): Record<string, Place> {
  const tallOf = (n: RunNodeSpec) => measured[n.id] ?? n.h
  const heightOf = (list: RunNodeSpec[]) => list.reduce((sum, n) => sum + tallOf(n), 0) + ROW_GAP * (list.length - 1)
  const out: Record<string, Place> = {}

  const bands = [...new Set(graph.nodes.map((n) => n.band))].sort((a, b) => a - b)
  let top = 0
  for (const band of bands) {
    const here = graph.nodes.filter((n) => n.band === band)
    const cols = new Map<number, RunNodeSpec[]>()
    for (const n of here) cols.set(n.col, [...(cols.get(n.col) ?? []), n])
    const tallest = Math.max(...[...cols.values()].map(heightOf))
    for (const [col, list] of cols) {
      let y = top + (tallest - heightOf(list)) / 2
      for (const n of list) {
        out[n.id] = { x: col * (NODE_W + COL_GAP), y }
        y += tallOf(n) + ROW_GAP
      }
    }
    // Clear air between the bands, so two graphs read as two.
    top += tallest + BAND_GAP
  }
  return out
}

// ---- What each card supplies ------------------------------------------------------

/**
 * Everything a run of one product reads: where, and with what settings. Built
 * from the project as it stands for the cards, and from a result (or a failed
 * attempt) for the run the cards are compared against.
 */
export type RunInputs = {
  product: Product
  site: Pick<SiteObject, "name" | "lon" | "lat"> | null
  area: { name: string; polygon: Polygon } | null
  solar: SolarParams
  wind: WindParams
  terrain: TerrainParams
  connection: ConnectionParams
  demand: DemandParams
  /** Whether the grid store answered: what the store card supplies. */
  storeReachable: boolean
  /** The map's ground: absent where the layer is drawn over everything it reaches. */
  region?: { label: string; at?: string } | null
  /** Which layer the map graph configures, by its label. */
  mapLayer?: string | null
}

export const SHORT_PRODUCT: Record<Product, string> = { solar: "Resource", terrain: "Terrain", wind: "Wind", connection: "Connection", demand: "Demand" }

/**
 * Total over the node ids, so a card added without saying what it supplies
 * does not compile. A setting left empty reads as the engine's default, which
 * is what a run is given for it.
 */
export function cardValues(p: RunInputs, d: energy.ParameterDefaults | null): Record<RunNodeId, RunValue> {
  const or = (v: number | undefined, fallback: number | undefined) => v ?? fallback ?? NaN
  const s = p.solar
  const w = p.wind
  const t = p.terrain
  const record: RunValue =
    p.product === "solar"
      ? { kind: "record", years: or(s.hourlyYears, d?.solar.hourly_years), of: "hourly" }
      : p.product === "wind"
        ? {
            kind: "record",
            years: or(w.recordYears, d?.wind.record_years),
            of: "MERRA-2",
            also: [or(w.recordMaxFloorMS, d?.wind.record_max_floor_ms)],
          }
        : { kind: "record", years: or(t.hourlyYears, d?.terrain.hourly_years), of: "hourly" }
  const season = t.season ?? d?.terrain.season
  return {
    site: {
      kind: "ground",
      label: p.site?.name ?? null,
      at: p.site ? `${p.site.lon},${p.site.lat}` : undefined,
    },
    area: {
      kind: "ground",
      label: p.area?.name ?? null,
      at: p.area ? JSON.stringify(p.area.polygon.coordinates) : undefined,
    },
    // The catalogue supplies the area rather than the run, so it has no value
    // of its own to compare between runs: it is a register, not a setting.
    catalogue: { kind: "choice", label: "IBGE" },
    // The map band's own catalogue card: a register, like the run's, and with
    // no value of its own to compare between runs.
    catalogue2: { kind: "choice", label: "IBGE" },
    ceiling: { kind: "measure", of: or(p.demand.yieldCeilingKWhKWp, d?.demand?.yield_ceiling_kwh_kwp), unit: "kWh/kWp" },
    cell: { kind: "measure", of: or(p.demand.cellKm, d?.demand?.cell_km), unit: "km" },
    record,
    radiation: { kind: "record", years: or(s.climatologyYears, d?.solar.climatology_years), of: "climatology" },
    product: { kind: "choice", label: SHORT_PRODUCT[p.product] },
    array: { kind: "measure", of: or(s.surfaceAzimuth, d?.solar.surface_azimuth), unit: "° az" },
    performance: { kind: "measure", of: or(s.performanceRatio, d?.solar.performance_ratio), unit: "PR" },
    // Never absent: an unset season is the engine's, even before the engine has said which.
    season: { kind: "choice", label: season ? seasonLabel(season) : "Default" },
    turbine: {
      kind: "measure",
      of: or(w.hubHeightM, d?.wind.hub_height_m),
      unit: "m hub",
      also: [or(w.calmThresholdMS, d?.wind.calm_threshold_ms)],
    },
    roughness: {
      kind: "band",
      low: or(w.roughnessLowM, d?.wind.roughness_band_m?.[0]),
      high: or(w.roughnessHighM, d?.wind.roughness_band_m?.[1]),
      unit: "m",
    },
    store: { kind: "store", reachable: p.storeReachable },
    reach: { kind: "measure", of: or(p.connection.searchRadiusKm, d?.connection?.search_radius_km), unit: "km" },
    /*
      The map's three cards. They are given a value here, with every other
      card, because a card added to the graph and not to this table does not
      compile -- which is the only reason this record is total.
    */
    region: { kind: "ground", label: p.region?.label ?? null, at: p.region?.at },
    layer: { kind: "choice", label: p.mapLayer ?? null },
    mapdraw: { kind: "none" },
    run: { kind: "none" },
  }
}

/** What the cards hold now, for a product at the given site or area. */
export function currentInputs(
  d: ProjectData,
  product: Product,
  site: SiteObject | null,
  area: AreaObject | null,
  storeReachable: boolean
): RunInputs {
  return { product, site, area, ...d.settings, storeReachable }
}

/** The run the cards are compared against: its inputs, whether it succeeded, and the result it left. */
export type LastRun = { inputs: RunInputs; ok: boolean; resultId: string | null }

/**
 * The newest run of this product at this source, a failed attempt included.
 *
 * The source's CURRENT name is used for both sides, so renaming a site does
 * not send its wire back to pending: a name is not something a run reads.
 */
export function lastRun(
  d: ProjectData,
  product: Product,
  source: SiteObject | AreaObject | null,
  failure: RunFailure | null
): LastRun | null {
  if (!source) return null
  const result = d.results.filter((r) => r.kind === product && r.sourceId === source.id).at(-1)
  // A run that reached the sidecar read the store it was pointed at, so the store card's wire settles with it.
  const base = { product, site: null, area: null, solar: {}, wind: {}, terrain: {}, connection: {}, demand: {}, storeReachable: true }
  const failed =
    failure && failure.product === product && failure.sourceId === source.id && (!result || Date.parse(result.createdAt) < failure.at)
      ? failure
      : null
  if (failed) {
    const f = failed.source
    return {
      ok: false,
      resultId: null,
      inputs: {
        ...base,
        site: f.kind === "site" ? { name: source.name, lon: f.lon, lat: f.lat } : null,
        area: f.kind === "area" ? { name: source.name, polygon: f.polygon } : null,
        [product]: failed.params,
      },
    }
  }
  if (!result) return null
  return {
    ok: true,
    resultId: result.id,
    inputs:
      result.kind === "terrain"
        ? { ...base, area: { name: source.name, polygon: result.polygon }, terrain: result.params }
        : result.kind === "connection"
          ? { ...base, area: { name: source.name, polygon: result.polygon }, connection: result.params }
          : result.kind === "demand"
            ? { ...base, area: { name: source.name, polygon: result.polygon }, demand: result.params }
            : result.kind === "solar"
            ? { ...base, site: { name: source.name, ...result.site }, solar: result.params }
          : { ...base, site: { name: source.name, ...result.site }, wind: result.params },
  }
}

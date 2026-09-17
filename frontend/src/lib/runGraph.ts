import type { energy } from "../../wailsjs/go/models"
import type { RunFailure } from "./analysis"
import { seasonLabel } from "./params"
import {
  type AreaObject,
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
  | "run"

export interface RunNodeSpec {
  id: RunNodeId
  label: string
  col: number
  /** A first guess at the card's height, replaced by its measurement once drawn. */
  h: number
}

export const NODE_W = 208
export const COL_GAP = 120
export const ROW_GAP = 16

const SPEC: Record<RunNodeId, Omit<RunNodeSpec, "col">> = {
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
  run: { id: "run", label: "Run", h: 96 },
}

export interface RunGraph {
  nodes: readonly RunNodeSpec[]
  edges: readonly (readonly [RunNodeId, RunNodeId])[]
}

const at = (id: RunNodeId, col: number): RunNodeSpec => ({ ...SPEC[id], col })

const fanIn = (nodes: RunNodeSpec[]): RunGraph => ({
  nodes,
  edges: nodes.filter((n) => n.id !== "run").map((n) => [n.id, "run"] as const),
})

/*
  ONE COLUMN OF INPUTS, in the order of the run node's rows, so no wire
  crosses another or passes under a node: where, what, when, then the values.
*/
export function runGraph(product: Product): RunGraph {
  const inputs: RunNodeId[] =
    product === "solar"
      ? ["site", "product", "record", "radiation", "array", "performance"]
      : product === "terrain"
        ? ["area", "product", "record", "season"]
        : ["site", "product", "record", "turbine", "roughness"]
  return fanIn([...inputs.map((id) => at(id, 0)), at("run", 1)])
}

export type Place = { x: number; y: number }

/** Columns left to right, each centred on the tallest. */
export function defaultPlaces(graph: RunGraph, measured: Readonly<Record<string, number>> = {}): Record<string, Place> {
  const cols = new Map<number, RunNodeSpec[]>()
  for (const n of graph.nodes) cols.set(n.col, [...(cols.get(n.col) ?? []), n])
  const tallOf = (n: RunNodeSpec) => measured[n.id] ?? n.h
  const heightOf = (list: RunNodeSpec[]) => list.reduce((sum, n) => sum + tallOf(n), 0) + ROW_GAP * (list.length - 1)
  const tallest = Math.max(...[...cols.values()].map(heightOf))
  const out: Record<string, Place> = {}
  for (const [col, list] of cols) {
    let y = (tallest - heightOf(list)) / 2
    for (const n of list) {
      out[n.id] = { x: col * (NODE_W + COL_GAP), y }
      y += tallOf(n) + ROW_GAP
    }
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
}

export const SHORT_PRODUCT: Record<Product, string> = { solar: "Resource", terrain: "Terrain", wind: "Wind" }

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
    run: { kind: "none" },
  }
}

/** What the cards hold now, for a product at the given site or area. */
export function currentInputs(d: ProjectData, product: Product, site: SiteObject | null, area: AreaObject | null): RunInputs {
  return { product, site, area, ...d.settings }
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
  const base = { product, site: null, area: null, solar: {}, wind: {}, terrain: {} }
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
        : result.kind === "solar"
          ? { ...base, site: { name: source.name, ...result.site }, solar: result.params }
          : { ...base, site: { name: source.name, ...result.site }, wind: result.params },
  }
}

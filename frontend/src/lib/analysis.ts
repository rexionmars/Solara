import {
  AnalyzeSolarResource,
  AnalyzeSolarTerrain,
  AnalyzeWindResource,
  CancelRun,
} from "../../wailsjs/go/main/App"
import { energy } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { errorMessage } from "./errors"
import { formatLat, formatLng } from "./format"
import { polygonAreaKm2 } from "./geo"
import { setLegendShown } from "./mapState"
import { seasonLabel, windSettingsError } from "./params"
import {
  PRODUCT_NAMES,
  allNames,
  commit,
  newId,
  project,
  uniqueName,
  type AreaObject,
  type Product,
  type ResultObject,
  type Settings,
  type SiteObject,
} from "./project"
import { fail, info, note } from "./reports"
import { showResult } from "./screen"
import { createStore } from "./store"

export type Running = {
  product: Product
  sourceId: string
  /** 0 to 100, or null before the sidecar has reported one. */
  progress: number | null
  message: string
}

/** The analysis in flight. The Go side runs one at a time and refuses a second. */
export const running = createStore<Running | null>(null)

/** A run that failed, and what it was given. */
export type RunFailure = {
  product: Product
  sourceId: string
  source: SiteObject | AreaObject
  params: Settings[Product]
  at: number
}

/**
 * The last run that failed, with what it was given, so the run graph can say
 * which inputs a failure read. Cleared by the next run that succeeds; a
 * cancelled run is not a failure and leaves it as it was.
 */
export const lastFailure = createStore<RunFailure | null>(null)

/**
 * Relay the sidecar's progress into the running analysis. One channel is
 * enough because only one analysis runs at a time. Returns the function that
 * stops listening.
 */
export function listenForProgress(): () => void {
  return EventsOn("sidecar:progress", (p: { progress: number; msg: string }) => {
    running.set((r) =>
      r ? { ...r, progress: p.progress >= 0 ? p.progress : r.progress, message: p.msg || r.message } : r
    )
  })
}

// A result as a run produces it, before it is named and filed under its source.
type NewResult = ResultObject extends infer R
  ? R extends ResultObject
    ? Omit<R, "id" | "name" | "sourceId" | "createdAt" | "hidden">
    : never
  : never

// The Go runner's error text for a run stopped by CancelRun.
const CANCELLED = "the request was cancelled"

/**
 * One run. The source and the settings are read once, at the start, so moving
 * the site or editing a field mid-run does not relabel the result: it is
 * recorded as computed, and marked stale against the changed project.
 *
 * `replace` names a result the new one takes the place of, for Adjust Last
 * Operation; it is removed only once the new result has arrived.
 */
async function run(
  product: Product,
  source: SiteObject | AreaObject,
  where: string,
  call: () => Promise<NewResult>,
  summary: (r: ResultObject) => string,
  replace?: string
): Promise<string | null> {
  const busy = running.get()
  if (busy) {
    fail(`${PRODUCT_NAMES[busy.product]} is still running. Cancel it first.`)
    return null
  }
  const params = { ...project.get().data.settings[product] }
  running.set({ product, sourceId: source.id, progress: null, message: "starting" })
  note(`${PRODUCT_NAMES[product]} ${where}…`)
  try {
    const partial = await call()
    const id = newId()
    commit(PRODUCT_NAMES[product], (d) => {
      const results = replace ? d.results.filter((r) => r.id !== replace) : d.results
      const taken = allNames({ ...d, results })
      const replaced = replace ? d.results.find((r) => r.id === replace) : undefined
      const result = {
        ...partial,
        id,
        name: replaced?.name ?? uniqueName(PRODUCT_NAMES[product], taken),
        sourceId: source.id,
        createdAt: new Date().toISOString(),
        hidden: false,
      } as ResultObject
      return { ...d, results: [...results, result] }
    })
    running.set(null)
    lastFailure.set(null)
    // A new layer arrives with its legend up, taken over from the one it replaces.
    if (product === "terrain") {
      setLegendShown(id, true)
      if (replace) setLegendShown(replace, false)
    }
    const result = project.get().data.results.find((r) => r.id === id)
    if (result) info(summary(result), { label: "Show", run: () => showResult(id, product) })
    return id
  } catch (e) {
    running.set(null)
    const msg = errorMessage(e)
    if (msg === CANCELLED) info(`${PRODUCT_NAMES[product]} cancelled.`)
    else {
      lastFailure.set({ product, sourceId: source.id, source, params, at: Date.now() })
      fail(`${PRODUCT_NAMES[product]} failed: ${msg}`)
    }
    return null
  }
}

const siteLabel = (s: SiteObject) => `at ${s.name} (${formatLat(s.lat, 4)} ${formatLng(s.lon, 4)})`

export function runSolar(site: SiteObject, replace?: string): Promise<string | null> {
  const p = project.get().data.settings.solar
  const at = { lon: site.lon, lat: site.lat }
  return run(
    "solar",
    site,
    siteLabel(site),
    async () => ({
      kind: "solar" as const,
      site: at,
      params: { ...p },
      data: await AnalyzeSolarResource(
        energy.SolarRequest.createFrom({
          ...at,
          climatology_years: p.climatologyYears,
          hourly_years: p.hourlyYears,
          surface_azimuth: p.surfaceAzimuth,
          performance_ratio: p.performanceRatio,
        })
      ),
    }),
    (r) =>
      r.kind === "solar"
        ? `Solar resource at ${site.name}: GHI ${r.data.resource.ghi_annual_kwh_m2.toFixed(0)} kWh/m²/yr, ` +
          `specific yield ${r.data.pv.specific_yield_kwh_kwp_year.toFixed(0)} kWh/kWp/yr.`
        : "",
    replace
  )
}

export async function runWind(site: SiteObject, replace?: string): Promise<string | null> {
  const p = project.get().data.settings.wind
  const problem = windSettingsError(p)
  if (problem) {
    fail(`Wind screening not started: ${problem}.`)
    return null
  }
  const at = { lon: site.lon, lat: site.lat }
  return run(
    "wind",
    site,
    siteLabel(site),
    async () => ({
      kind: "wind" as const,
      site: at,
      params: { ...p },
      data: await AnalyzeWindResource(
        energy.WindRequest.createFrom({
          ...at,
          record_years: p.recordYears,
          hub_height_m: p.hubHeightM,
          calm_threshold_ms: p.calmThresholdMS,
          record_max_floor_ms: p.recordMaxFloorMS,
          roughness_band_m:
            p.roughnessLowM !== undefined && p.roughnessHighM !== undefined
              ? [p.roughnessLowM, p.roughnessHighM]
              : undefined,
        })
      ),
    }),
    (r) =>
      r.kind === "wind"
        ? `Wind screening at ${site.name}: ${r.data.hub.mean_speed_ms.toFixed(2)} m/s at ${r.data.hub_height_m.toFixed(0)} m, ` +
          `gross capacity factor ${r.data.hub.gross_capacity_factor_pct.toFixed(1)}% (unvalidated).`
        : "",
    replace
  )
}

export function runTerrain(area: AreaObject, replace?: string): Promise<string | null> {
  const p = project.get().data.settings.terrain
  const polygon = area.polygon
  return run(
    "terrain",
    area,
    `over ${area.name} (${polygonAreaKm2(polygon).toFixed(2)} km²)`,
    async () => ({
      kind: "terrain" as const,
      polygon,
      params: { ...p },
      opacity: 0.85,
      // createFrom, not a literal: Wails gives a request with a nested struct
      // a convertValues method, which a plain object does not have.
      data: await AnalyzeSolarTerrain(
        energy.SolarTerrainRequest.createFrom({ area: polygon, hourly_years: p.hourlyYears, season: p.season })
      ),
    }),
    (r) =>
      r.kind === "terrain"
        ? `Solar terrain over ${area.name}: ${seasonLabel(r.data.season).toLowerCase()}, mean ` +
          `${r.data.poa_mean.toFixed(r.data.scale.decimals)} ${r.data.unit}, spread ${r.data.poa_std_pct.toFixed(1)}%.`
        : "",
    replace
  )
}

export async function cancelRun(): Promise<void> {
  if (!running.get()) return
  const stopped = await CancelRun()
  if (!stopped) info("Nothing was running.")
}

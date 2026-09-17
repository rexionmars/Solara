import {
  AnalyzeSolarResource,
  AnalyzeSolarTerrain,
  AnalyzeWindResource,
  CancelRun,
} from "../../wailsjs/go/main/App"
import { energy } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { area, type Polygon } from "./area"
import { print } from "./commandLog"
import { activateDocument, openDocument } from "./documents"
import { seasonLabel, solarParams, terrainParams, windParams } from "./energyParams"
import { errorMessage } from "./errors"
import { formatLat, formatLng } from "./format"
import { polygonAreaKm2 } from "./geo"
import { terrainLayer } from "./layers"
import { site, type Site } from "./site"
import { createStore } from "./store"

export type Product = "solar" | "wind" | "terrain"

export const PRODUCT_NAMES: Record<Product, string> = {
  solar: "Solar resource",
  wind: "Wind screening",
  terrain: "Solar terrain",
}

export type Running = {
  product: Product
  /** 0 to 100, or null before the sidecar has reported one. */
  progress: number | null
  message: string
}

/**
 * Each result with the site or area it was computed at, which the current
 * site or area may no longer be.
 */
export type AnalysisState = {
  running: Running | null
  solar: { site: Site; result: energy.SolarAnalysis } | null
  wind: { site: Site; result: energy.WindAnalysis } | null
  terrain: { area: Polygon; result: energy.SolarTerrainAnalysis } | null
}

export const analysis = createStore<AnalysisState>({
  running: null,
  solar: null,
  wind: null,
  terrain: null,
})

/**
 * Relay the sidecar's progress into the running analysis. One channel is
 * enough because the Go side runs one analysis at a time and refuses a second.
 * Returns the function that stops listening.
 */
export function listenForProgress(): () => void {
  return EventsOn("sidecar:progress", (p: { progress: number; msg: string }) => {
    analysis.set((s) =>
      s.running
        ? {
            ...s,
            running: {
              ...s.running,
              progress: p.progress >= 0 ? p.progress : s.running.progress,
              message: p.msg || s.running.message,
            },
          }
        : s
    )
  })
}

// The Go runner's error text for a run stopped by CancelRun.
const CANCELLED = "the request was cancelled"

/** One run: refused while another is in flight, reported whichever way it ends. */
async function run<T>(
  product: Product,
  where: string,
  call: () => Promise<T>,
  keep: (r: T) => Partial<AnalysisState>,
  done: (r: T) => string,
  after: () => void
): Promise<void> {
  const busy = analysis.get().running
  if (busy) {
    print(`${PRODUCT_NAMES[busy.product]} is still running. CANCEL stops it.`, "error")
    return
  }
  analysis.set((s) => ({ ...s, running: { product, progress: null, message: "starting" } }))
  print(`${PRODUCT_NAMES[product]} ${where}…`)
  try {
    const result = await call()
    analysis.set((s) => ({ ...s, ...keep(result), running: null }))
    print(done(result))
    after()
  } catch (e) {
    analysis.set((s) => ({ ...s, running: null }))
    const msg = errorMessage(e)
    if (msg === CANCELLED) print(`${PRODUCT_NAMES[product]} cancelled.`)
    else print(`${PRODUCT_NAMES[product]} failed: ${msg}`, "error")
  }
}

/** The site, read once at the start so moving it mid-run does not relabel the result. */
function requireSite(): Site | null {
  const at = site.get().point
  if (!at) print("No site. Type SITE and click the map, or SITE <lat> <lon>.", "error")
  return at
}

const siteLabel = (at: Site) => `at ${formatLat(at.lat)}  ${formatLng(at.lon)}`

export async function runSolar(): Promise<void> {
  const at = requireSite()
  if (!at) return
  const p = solarParams.get()
  await run(
    "solar",
    siteLabel(at),
    () =>
      AnalyzeSolarResource({
        lon: at.lon,
        lat: at.lat,
        climatology_years: p.climatologyYears,
        hourly_years: p.hourlyYears,
        surface_azimuth: p.surfaceAzimuth,
        performance_ratio: p.performanceRatio,
      }),
    (result) => ({ solar: { site: at, result } }),
    (r) =>
      `Solar resource ready: GHI ${r.resource.ghi_annual_kwh_m2.toFixed(0)} kWh/m²/yr, ` +
      `specific yield ${r.pv.specific_yield_kwh_kwp_year.toFixed(0)} kWh/kWp/yr.`,
    () => openDocument("solar")
  )
}

export async function runWind(): Promise<void> {
  const at = requireSite()
  if (!at) return
  const p = windParams.get()
  const lo = p.roughnessLowM
  const hi = p.roughnessHighM
  if ((lo === undefined) !== (hi === undefined)) {
    print("Set both roughness lengths, or neither.", "error")
    return
  }
  await run(
    "wind",
    siteLabel(at),
    () =>
      AnalyzeWindResource({
        lon: at.lon,
        lat: at.lat,
        record_years: p.recordYears,
        hub_height_m: p.hubHeightM,
        calm_threshold_ms: p.calmThresholdMS,
        record_max_floor_ms: p.recordMaxFloorMS,
        roughness_band_m: lo !== undefined && hi !== undefined ? [lo, hi] : undefined,
      }),
    (result) => ({ wind: { site: at, result } }),
    (r) =>
      `Wind screening ready: ${r.hub.mean_speed_ms.toFixed(2)} m/s at ${r.hub_height_m.toFixed(0)} m, ` +
      `gross capacity factor ${r.hub.gross_capacity_factor_pct.toFixed(1)}% (unvalidated).`,
    () => openDocument("wind")
  )
}

export async function runTerrain(): Promise<void> {
  const polygon = area.get().polygon
  if (!polygon) {
    print("No area. Type AREA and draw one on the map.", "error")
    return
  }
  const p = terrainParams.get()
  await run(
    "terrain",
    `over ${polygonAreaKm2(polygon).toFixed(2)} km²`,
    () =>
      // createFrom, not a literal: Wails gives a request with a nested struct
      // a convertValues method, which a plain object does not have.
      AnalyzeSolarTerrain(
        energy.SolarTerrainRequest.createFrom({
          area: polygon,
          hourly_years: p.hourlyYears,
          season: p.season,
        })
      ),
    (result) => ({ terrain: { area: polygon, result } }),
    (r) =>
      `Solar terrain ready: ${seasonLabel(r.season).toLowerCase()}, mean ` +
      `${r.poa_mean.toFixed(r.scale.decimals)} ${r.unit}, spread ${r.poa_std_pct.toFixed(1)}%. ` +
      `Layer on the map; figures in the Solar terrain tab.`,
    () => {
      // The layer is the result, so the map stays in front and the figures
      // wait in their tab.
      terrainLayer.set((l) => ({ ...l, visible: true }))
      openDocument("terrain", false)
      activateDocument("map")
    }
  )
}

export async function cancelRun(): Promise<void> {
  if (!analysis.get().running) {
    print("Nothing is running.", "error")
    return
  }
  const stopped = await CancelRun()
  if (!stopped) print("Nothing is running.", "error")
}

import { AnalyzeSolarResource, AnalyzeWindResource, CancelRun } from "../../wailsjs/go/main/App"
import type { energy } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { print } from "./commandLog"
import { openDocument } from "./documents"
import { solarParams, windParams } from "./energyParams"
import { errorMessage } from "./errors"
import { formatLat, formatLng } from "./format"
import { site, type Site } from "./site"
import { createStore } from "./store"

export type Product = "solar" | "wind"

export const PRODUCT_NAMES: Record<Product, string> = {
  solar: "Solar resource",
  wind: "Wind screening",
}

export type Running = {
  product: Product
  site: Site
  /** 0 to 100, or null before the sidecar has reported one. */
  progress: number | null
  message: string
}

/** A result and the site it was computed at, which the current site may no longer be. */
export type Result<T> = { site: Site; result: T }

export type AnalysisState = {
  running: Running | null
  solar: Result<energy.SolarAnalysis> | null
  wind: Result<energy.WindAnalysis> | null
}

export const analysis = createStore<AnalysisState>({ running: null, solar: null, wind: null })

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

/**
 * Checks shared by both products, then the run itself: the site is read once,
 * at the start, so moving it while the run is in flight does not relabel the
 * result.
 */
async function run<T>(product: Product, call: (at: Site) => Promise<T>, done: (r: T) => string): Promise<void> {
  const at = site.get().point
  if (!at) {
    print("No site. Type SITE and click the map, or SITE <lat> <lon>.", "error")
    return
  }
  const busy = analysis.get().running
  if (busy) {
    print(`${PRODUCT_NAMES[busy.product]} is still running. CANCEL stops it.`, "error")
    return
  }

  analysis.set((s) => ({ ...s, running: { product, site: at, progress: null, message: "starting" } }))
  print(`${PRODUCT_NAMES[product]} at ${formatLat(at.lat)}  ${formatLng(at.lon)}…`)
  try {
    const result = await call(at)
    analysis.set((s) => ({ ...s, running: null, [product]: { site: at, result } }))
    print(done(result))
    openDocument(product)
  } catch (e) {
    analysis.set((s) => ({ ...s, running: null }))
    const msg = errorMessage(e)
    if (msg === CANCELLED) print(`${PRODUCT_NAMES[product]} cancelled.`)
    else print(`${PRODUCT_NAMES[product]} failed: ${msg}`, "error")
  }
}

export function runSolar(): Promise<void> {
  const p = solarParams.get()
  return run(
    "solar",
    (at) =>
      AnalyzeSolarResource({
        lon: at.lon,
        lat: at.lat,
        climatology_years: p.climatologyYears,
        hourly_years: p.hourlyYears,
        surface_azimuth: p.surfaceAzimuth,
        performance_ratio: p.performanceRatio,
      }),
    (r) =>
      `Solar resource ready: GHI ${r.resource.ghi_annual_kwh_m2.toFixed(0)} kWh/m²/yr, ` +
      `specific yield ${r.pv.specific_yield_kwh_kwp_year.toFixed(0)} kWh/kWp/yr.`
  )
}

export function runWind(): Promise<void> {
  const p = windParams.get()
  const lo = p.roughnessLowM
  const hi = p.roughnessHighM
  if ((lo === undefined) !== (hi === undefined)) {
    print("Set both roughness lengths, or neither.", "error")
    return Promise.resolve()
  }
  return run(
    "wind",
    (at) =>
      AnalyzeWindResource({
        lon: at.lon,
        lat: at.lat,
        record_years: p.recordYears,
        hub_height_m: p.hubHeightM,
        calm_threshold_ms: p.calmThresholdMS,
        record_max_floor_ms: p.recordMaxFloorMS,
        roughness_band_m: lo !== undefined && hi !== undefined ? [lo, hi] : undefined,
      }),
    (r) =>
      `Wind screening ready: ${r.hub.mean_speed_ms.toFixed(2)} m/s at ${r.hub_height_m.toFixed(0)} m, ` +
      `gross capacity factor ${r.hub.gross_capacity_factor_pct.toFixed(1)}% (unvalidated).`
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

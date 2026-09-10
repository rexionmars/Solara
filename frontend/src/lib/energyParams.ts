import { createStore } from "./store"

/**
 * The parameters of the two energy products, as the properties panel edits them.
 *
 * Undefined means "use the sidecar's default". No default is written here:
 * TERRA mirrored every Python constant into TypeScript with nothing linking
 * the two, so a change on one side left the interface stating a value the
 * sidecar no longer used. An unset field is omitted from the request, the
 * sidecar applies its own constant, and the result states what was used.
 */
export type SolarParams = {
  climatologyYears?: number
  hourlyYears?: number
  surfaceAzimuth?: number
  performanceRatio?: number
}

export type WindParams = {
  recordYears?: number
  hubHeightM?: number
  calmThresholdMS?: number
  recordMaxFloorMS?: number
  roughnessLowM?: number
  roughnessHighM?: number
}

export const solarParams = createStore<SolarParams>({})
export const windParams = createStore<WindParams>({})

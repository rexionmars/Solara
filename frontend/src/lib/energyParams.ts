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

export type TerrainParams = {
  hourlyYears?: number
  season?: string
}

export const solarParams = createStore<SolarParams>({})
export const windParams = createStore<WindParams>({})
export const terrainParams = createStore<TerrainParams>({})

/**
 * The windows the terrain product can be computed over, as the sidecar names
 * them (sidecar/terra_energy_engine/energy/seasons.py and actions.py). A name
 * the sidecar does not know is refused there, so a stale entry here fails
 * loudly rather than computing the wrong window.
 */
export const SEASON_OPTIONS: { id: string; label: string }[] = [
  { id: "annual", label: "Annual" },
  { id: "winter", label: "Winter" },
  { id: "summer", label: "Summer" },
  { id: "winter_crop", label: "Winter crop" },
  { id: "anisotropy", label: "Winter / summer ratio" },
  { id: "shading", label: "Horizon shading" },
]

export const seasonLabel = (id: string) => SEASON_OPTIONS.find((o) => o.id === id)?.label ?? id

import type { energy } from "../../wailsjs/go/models"
import { commit, project, type ConnectionParams, type Settings, type SolarParams, type TerrainParams, type WindParams } from "./project"

/**
 * The analysis settings as fields: label, unit, and what the sidecar accepts.
 *
 * The limits restate what the sidecar refuses (actions.py), so a value it
 * would reject is marked on the field while it is typed, rather than reported
 * after a run has been started. The sidecar still checks; this is only earlier.
 */

export type NumberField<K extends string> = {
  key: K
  label: string
  unit?: string
  integer?: boolean
  min?: number
  /** Whether `min` itself is refused. */
  exclusiveMin?: boolean
  max?: number
  step?: number
  description: string
  /** The default the sidecar reported, read from ParameterDefaults. */
  defaultOf: (d: energy.ParameterDefaults) => number | undefined
}

export const SOLAR_FIELDS: NumberField<keyof SolarParams>[] = [
  {
    key: "climatologyYears",
    label: "Climatology",
    unit: "yr",
    integer: true,
    min: 1,
    description: "Years of daily NASA POWER data the annual and monthly figures are averaged over",
    defaultOf: (d) => d.solar.climatology_years,
  },
  {
    key: "hourlyYears",
    label: "Hourly Record",
    unit: "yr",
    integer: true,
    min: 1,
    description: "Years of hourly data the plane-of-array and yield model runs on",
    defaultOf: (d) => d.solar.hourly_years,
  },
  {
    key: "surfaceAzimuth",
    label: "Surface Azimuth",
    unit: "°",
    min: 0,
    max: 360,
    description: "Direction the array faces, in degrees clockwise from north",
    defaultOf: (d) => d.solar.surface_azimuth,
  },
  {
    key: "performanceRatio",
    label: "Performance Ratio",
    min: 0,
    exclusiveMin: true,
    max: 1,
    step: 0.01,
    description: "Ratio of delivered AC energy to plane-of-array irradiation, in (0, 1]",
    defaultOf: (d) => d.solar.performance_ratio,
  },
]

export const WIND_FIELDS: NumberField<keyof WindParams>[] = [
  {
    key: "recordYears",
    label: "Record",
    unit: "yr",
    integer: true,
    min: 1,
    description: "Years of hourly MERRA-2 wind the screening reads",
    defaultOf: (d) => d.wind.record_years,
  },
  {
    key: "hubHeightM",
    label: "Hub Height",
    unit: "m",
    min: 0,
    exclusiveMin: true,
    description: "Height the speed is extrapolated to with the power law",
    defaultOf: (d) => d.wind.hub_height_m,
  },
  {
    key: "calmThresholdMS",
    label: "Calm Threshold",
    unit: "m/s",
    min: 0,
    description: "Speed below which an hour counts as calm",
    defaultOf: (d) => d.wind.calm_threshold_ms,
  },
  {
    key: "recordMaxFloorMS",
    label: "Maximum Floor",
    unit: "m/s",
    min: 0,
    description: "Lowest record maximum the data quality check accepts as plausible",
    defaultOf: (d) => d.wind.record_max_floor_ms,
  },
  {
    key: "roughnessLowM",
    label: "Roughness Low",
    unit: "m",
    min: 0,
    exclusiveMin: true,
    description: "Lower end of the roughness length assumed for the land cover",
    defaultOf: (d) => d.wind.roughness_band_m?.[0],
  },
  {
    key: "roughnessHighM",
    label: "Roughness High",
    unit: "m",
    min: 0,
    exclusiveMin: true,
    description: "Upper end of the roughness length assumed for the land cover",
    defaultOf: (d) => d.wind.roughness_band_m?.[1],
  },
]

export const TERRAIN_FIELDS: NumberField<"hourlyYears">[] = [
  {
    key: "hourlyYears",
    label: "Hourly Record",
    unit: "yr",
    integer: true,
    min: 1,
    description: "Years of hourly NASA POWER data the irradiation is computed from",
    defaultOf: (d) => d.terrain.hourly_years,
  },
]

export const CONNECTION_FIELDS: NumberField<keyof ConnectionParams>[] = [
  {
    key: "searchRadiusKm",
    label: "Search Radius",
    unit: "km",
    min: 0,
    exclusiveMin: true,
    step: 10,
    description: "How far from the area substations and lines of the transmission register are looked for",
    defaultOf: (d) => d.connection?.search_radius_km,
  },
]

/** Labels for the terrain windows. The list itself comes from the sidecar when it has answered. */
const SEASON_LABELS: Record<string, string> = {
  annual: "Annual",
  winter: "Winter",
  summer: "Summer",
  winter_crop: "Winter Crop",
  anisotropy: "Winter / Summer Ratio",
  shading: "Horizon Shading",
}

export const FALLBACK_SEASONS = Object.keys(SEASON_LABELS)

export const seasonLabel = (id: string) => SEASON_LABELS[id] ?? id

/** Why `value` is refused for `field`, or null. */
export function fieldError(field: NumberField<string>, value: number): string | null {
  if (!Number.isFinite(value)) return "Not a number"
  if (field.integer && !Number.isInteger(value)) return "Must be a whole number"
  if (field.min !== undefined) {
    if (field.exclusiveMin ? value <= field.min : value < field.min) {
      return `Must be ${field.exclusiveMin ? "greater than" : "at least"} ${field.min}`
    }
  }
  if (field.max !== undefined && value > field.max) return `Must be at most ${field.max}`
  return null
}

/** A problem between fields, which neither field shows on its own. */
export function windSettingsError(p: WindParams): string | null {
  const lo = p.roughnessLowM
  const hi = p.roughnessHighM
  if ((lo === undefined) !== (hi === undefined)) return "Set both roughness lengths, or neither"
  if (lo !== undefined && hi !== undefined && lo >= hi) return "Roughness low must be below roughness high"
  return null
}

export type Group = keyof Settings

export function setParam(group: Group, key: string, value: number | string | undefined): void {
  commit(
    "Change Setting",
    (d) => {
      const current = d.settings[group] as Record<string, unknown>
      if (current[key] === value) return d
      const next = { ...current }
      if (value === undefined) delete next[key]
      else next[key] = value
      return { ...d, settings: { ...d.settings, [group]: next } }
    },
    true
  )
}

export function resetGroup(group: Group): void {
  commit("Reset Settings", (d) =>
    Object.keys(d.settings[group]).length ? { ...d, settings: { ...d.settings, [group]: {} } } : d
  )
}

export function settings(): Settings {
  return project.get().data.settings
}

export type { ConnectionParams, SolarParams, TerrainParams, WindParams }

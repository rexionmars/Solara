import { polygonAreaKm2 } from "./geo"
import { seasonLabel } from "./params"
import { findItem, staleReason, type Product, type ProjectData, type ResultObject } from "./project"

/**
 * The comparison table: one row per result, the columns a product's results
 * are compared on. Read by the Spreadsheet editor and by the CSV export, so a
 * column exported is the column on screen.
 */
export type Column = {
  key: string
  label: string
  unit?: string
  /** A number to sort and export by, or text. */
  value: (r: ResultObject, d: ProjectData) => number | string | null
  decimals?: number
}

const common: Column[] = [
  { key: "name", label: "Result", value: (r) => r.name },
  { key: "source", label: "Source", value: (r, d) => findItem(d, r.sourceId)?.name ?? "(deleted)" },
]

const trailing: Column[] = [
  { key: "created", label: "Computed", value: (r) => r.createdAt.replace("T", " ").slice(0, 16) },
  { key: "stale", label: "Status", value: (r, d) => staleReason(d, r) ?? "current" },
]

export const COLUMNS: Record<Product, Column[]> = {
  solar: [
    ...common,
    { key: "lat", label: "Latitude", unit: "°", decimals: 5, value: (r) => (r.kind === "solar" ? r.site.lat : null) },
    { key: "lon", label: "Longitude", unit: "°", decimals: 5, value: (r) => (r.kind === "solar" ? r.site.lon : null) },
    {
      key: "ghi",
      label: "Annual GHI",
      unit: "kWh/m²",
      decimals: 0,
      value: (r) => (r.kind === "solar" ? r.data.resource.ghi_annual_kwh_m2 : null),
    },
    {
      key: "yield",
      label: "Specific Yield",
      unit: "kWh/kWp",
      decimals: 0,
      value: (r) => (r.kind === "solar" ? r.data.pv.specific_yield_kwh_kwp_year : null),
    },
    {
      key: "cf",
      label: "Capacity Factor",
      unit: "%",
      decimals: 1,
      value: (r) => (r.kind === "solar" ? r.data.pv.capacity_factor_pct : null),
    },
    {
      key: "tilt",
      label: "Optimal Tilt",
      unit: "°",
      decimals: 1,
      value: (r) => (r.kind === "solar" ? r.data.geometry.optimal_tilt_deg : null),
    },
    { key: "pr", label: "PR", decimals: 2, value: (r) => (r.kind === "solar" ? r.data.pv.performance_ratio : null) },
    ...trailing,
  ],
  wind: [
    ...common,
    { key: "lat", label: "Latitude", unit: "°", decimals: 5, value: (r) => (r.kind === "wind" ? r.site.lat : null) },
    { key: "lon", label: "Longitude", unit: "°", decimals: 5, value: (r) => (r.kind === "wind" ? r.site.lon : null) },
    { key: "hub", label: "Hub Height", unit: "m", decimals: 0, value: (r) => (r.kind === "wind" ? r.data.hub_height_m : null) },
    {
      key: "speed",
      label: "Hub Speed",
      unit: "m/s",
      decimals: 2,
      value: (r) => (r.kind === "wind" ? r.data.hub.mean_speed_ms : null),
    },
    {
      key: "gcf",
      label: "Gross CF",
      unit: "%",
      decimals: 1,
      value: (r) => (r.kind === "wind" ? r.data.hub.gross_capacity_factor_pct : null),
    },
    {
      key: "aep",
      label: "Gross AEP",
      unit: "MWh",
      decimals: 0,
      value: (r) => (r.kind === "wind" ? r.data.hub.gross_annual_energy_mwh_per_turbine : null),
    },
    {
      key: "checks",
      label: "Record Checks",
      value: (r) =>
        r.kind === "wind" ? (r.data.data_quality.all_checks_passed ? "passed" : `${r.data.data_quality.flags.length} failed`) : null,
    },
    ...trailing,
  ],
  terrain: [
    ...common,
    { key: "window", label: "Window", value: (r) => (r.kind === "terrain" ? seasonLabel(r.data.season) : null) },
    { key: "area", label: "Area", unit: "km²", decimals: 2, value: (r) => (r.kind === "terrain" ? polygonAreaKm2(r.polygon) : null) },
    { key: "mean", label: "Mean", decimals: 2, value: (r) => (r.kind === "terrain" ? r.data.poa_mean : null) },
    { key: "min", label: "Minimum", decimals: 2, value: (r) => (r.kind === "terrain" ? r.data.poa_min : null) },
    { key: "max", label: "Maximum", decimals: 2, value: (r) => (r.kind === "terrain" ? r.data.poa_max : null) },
    { key: "unit", label: "Unit", value: (r) => (r.kind === "terrain" ? r.data.unit : null) },
    { key: "spread", label: "Spread", unit: "%", decimals: 1, value: (r) => (r.kind === "terrain" ? r.data.poa_std_pct : null) },
    { key: "slope", label: "Mean Slope", unit: "°", decimals: 1, value: (r) => (r.kind === "terrain" ? r.data.slope_mean_deg : null) },
    ...trailing,
  ],
}

export function formatCell(c: Column, v: number | string | null): string {
  if (v === null) return "—"
  if (typeof v === "number") return c.decimals !== undefined ? v.toFixed(c.decimals) : String(v)
  return v
}

function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The table as CSV, numbers at full precision so a spreadsheet can recompute from them. */
export function toCsv(product: Product, d: ProjectData, rows: ResultObject[]): string {
  const cols = COLUMNS[product]
  const header = cols.map((c) => csvField(c.unit ? `${c.label} (${c.unit})` : c.label)).join(",")
  const body = rows.map((r) =>
    cols
      .map((c) => {
        const v = c.value(r, d)
        return csvField(v === null ? "" : String(v))
      })
      .join(",")
  )
  return [header, ...body].join("\n") + "\n"
}

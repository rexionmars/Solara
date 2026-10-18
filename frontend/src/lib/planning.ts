import { AnalyzeSystemPlanning, CancelRun } from "../../wailsjs/go/main/App"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { running as energyRunning, systemPlanningActive } from "./analysis"
import { errorMessage } from "./errors"
import { createStore } from "./store"

export type Bus = { id: string; v_nom_kv: number }
export type Generator = {
  id: string
  bus: string
  carrier: string
  existing_mw: number
  expandable: boolean
  max_mw: number
  annualized_cost_per_mw_year: number
  marginal_cost_per_mwh: number
  co2_tonnes_per_mwh: number
  availability: number[]
}
export type Load = { id: string; bus: string; p_mw: number[] }
export type Line = {
  id: string
  bus0: string
  bus1: string
  x_ohm: number
  existing_mva: number
  expandable: boolean
  max_mva: number
  annualized_cost_per_mva_year: number
}
export type Storage = {
  id: string
  bus: string
  existing_mw: number
  expandable: boolean
  max_mw: number
  annualized_cost_per_mw_year: number
  marginal_cost_per_mwh: number
  max_hours: number
  efficiency_store: number
  efficiency_dispatch: number
}
export type Study = {
  schema_version: 1
  name: string
  description?: string
  currency: string
  provenance: string
  mode: "dispatch" | "expansion"
  snapshots: { time: string; duration_hours: number }[]
  buses: Bus[]
  generators: Generator[]
  loads: Load[]
  lines: Line[]
  storage: Storage[]
  co2_limit_tonnes: number | null
}
export type PlanningResult = {
  study: Study
  study_sha256: string
  created_at: string
  engine: {
    name: string
    version: string
    solver: string
    solver_version: string
    status: string
    termination: string
  }
  summary: {
    hours: number
    snapshots: number
    demand_mwh: number
    generation_mwh: number
    operating_cost: number
    expansion_cost: number
    objective: number
    co2_tonnes: number
    cost_per_demand_mwh: number
    max_nodal_balance_error_mw: number
  }
  generators: {
    id: string
    bus: string
    carrier: string
    existing_mw: number
    optimized_mw: number
    added_mw: number
    generation_mwh: number
    unused_available_mwh: number
    capacity_factor: number | null
    co2_tonnes: number
  }[]
  lines: {
    id: string
    existing_mva: number
    optimized_mva: number
    added_mva: number
    peak_loading_pct: number
    hours_at_limit: number
  }[]
  storage: {
    id: string
    existing_mw: number
    optimized_mw: number
    added_mw: number
    energy_capacity_mwh: number
    charged_mwh: number
    discharged_mwh: number
    losses_mwh: number
  }[]
  timeseries: {
    time: string
    duration_hours: number
    demand_mw: number
    generation_mw: number
    charge_mw: number
    discharge_mw: number
    generation_by_unit: Record<string, number>
    demand_by_bus: Record<string, number>
    flow_by_line: Record<string, number>
    state_of_charge_mwh: Record<string, number>
  }[]
  warnings: string[]
}

export function emptyStudy(): Study {
  return {
    schema_version: 1,
    name: "New planning study",
    currency: "EUR",
    provenance: "",
    mode: "dispatch",
    snapshots: [],
    buses: [],
    generators: [],
    loads: [],
    lines: [],
    storage: [],
    co2_limit_tonnes: null,
  }
}

/** Explicitly synthetic fixture, never populated from the GeoPackage register. */
export function exampleStudy(): Study {
  const solar = Array.from({ length: 24 }, (_, h) => Math.max(0, Math.sin(((h - 6) * Math.PI) / 12)))
  return {
    schema_version: 1,
    name: "Synthetic two-bus system",
    currency: "EUR",
    provenance:
      "Synthetic demonstration only. Assumed profiles, costs and network parameters; not an Italian grid study.",
    mode: "expansion",
    snapshots: Array.from({ length: 24 }, (_, h) => ({
      time: `2026-01-01T${String(h).padStart(2, "0")}:00:00Z`,
      duration_hours: 1,
    })),
    buses: [
      { id: "North", v_nom_kv: 110 },
      { id: "South", v_nom_kv: 110 },
    ],
    generators: [
      {
        id: "Gas",
        bus: "South",
        carrier: "gas",
        existing_mw: 100,
        expandable: false,
        max_mw: 100,
        annualized_cost_per_mw_year: 0,
        marginal_cost_per_mwh: 100,
        co2_tonnes_per_mwh: 0.4,
        availability: Array(24).fill(1),
      },
      {
        id: "Solar",
        bus: "North",
        carrier: "solar",
        existing_mw: 20,
        expandable: true,
        max_mw: 200,
        annualized_cost_per_mw_year: 50000,
        marginal_cost_per_mwh: 0,
        co2_tonnes_per_mwh: 0,
        availability: solar,
      },
    ],
    loads: [
      {
        id: "Demand",
        bus: "South",
        p_mw: Array.from({ length: 24 }, (_, h) => (h >= 17 && h <= 21 ? 70 : 45)),
      },
    ],
    lines: [
      {
        id: "North-South",
        bus0: "North",
        bus1: "South",
        x_ohm: 10,
        existing_mva: 30,
        expandable: true,
        max_mva: 120,
        annualized_cost_per_mva_year: 10000,
      },
    ],
    storage: [
      {
        id: "Battery",
        bus: "South",
        existing_mw: 0,
        expandable: true,
        max_mw: 80,
        annualized_cost_per_mw_year: 60000,
        marginal_cost_per_mwh: 1,
        max_hours: 4,
        efficiency_store: 0.95,
        efficiency_dispatch: 0.95,
      },
    ],
    co2_limit_tonnes: null,
  }
}

/** Validate the editable shape before rendering untrusted imported documents.
 * Domain constraints and unsupported keys are checked by Python before solving. */
export function parseStudy(value: unknown): Study {
  if (!value || typeof value !== "object") throw new Error("Expected a study object.")
  const source = value as Record<string, unknown>
  const s = (source.study ?? source) as Record<string, unknown>
  if (!s || typeof s !== "object" || s.schema_version !== 1)
    throw new Error("Expected a version 1 planning study or run report.")
  for (const key of ["name", "currency", "provenance"])
    if (typeof s[key] !== "string") throw new Error(`Study ${key} must be text.`)
  if (s.mode !== "dispatch" && s.mode !== "expansion") throw new Error("Invalid study mode.")
  if (
    s.co2_limit_tonnes != null &&
    (typeof s.co2_limit_tonnes !== "number" || !Number.isFinite(s.co2_limit_tonnes))
  )
    throw new Error("Invalid CO₂ limit.")
  const shapes: Record<string, Record<string, string>> = {
    snapshots: { time: "string", duration_hours: "number" },
    buses: { id: "string", v_nom_kv: "number" },
    generators: {
      id: "string",
      bus: "string",
      carrier: "string",
      existing_mw: "number",
      expandable: "boolean",
      max_mw: "number",
      annualized_cost_per_mw_year: "number",
      marginal_cost_per_mwh: "number",
      co2_tonnes_per_mwh: "number",
      availability: "array",
    },
    loads: { id: "string", bus: "string", p_mw: "array" },
    lines: {
      id: "string",
      bus0: "string",
      bus1: "string",
      x_ohm: "number",
      existing_mva: "number",
      expandable: "boolean",
      max_mva: "number",
      annualized_cost_per_mva_year: "number",
    },
    storage: {
      id: "string",
      bus: "string",
      existing_mw: "number",
      expandable: "boolean",
      max_mw: "number",
      annualized_cost_per_mw_year: "number",
      marginal_cost_per_mwh: "number",
      max_hours: "number",
      efficiency_store: "number",
      efficiency_dispatch: "number",
    },
  }
  for (const [key, shape] of Object.entries(shapes)) {
    const rows = s[key]
    if (!Array.isArray(rows)) throw new Error(`Study ${key} must be a list.`)
    for (const row of rows) {
      if (!row || typeof row !== "object") throw new Error(`Invalid ${key} row.`)
      for (const [field, type] of Object.entries(shape)) {
        const v = row[field]
        const valid =
          type === "array"
            ? Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n))
            : typeof v === type && (type !== "number" || Number.isFinite(v))
        if (!valid) throw new Error(`${key}.${field}: expected ${type}.`)
      }
    }
  }
  return { ...s, co2_limit_tonnes: s.co2_limit_tonnes ?? null } as Study
}

/** Wails maps reorder object keys; compare study values independently of order. */
export function studyKey(study: Study): string {
  return JSON.stringify(study, (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  )
}

const DRAFT_KEY = "solora.system-planning.v1"
let draft = emptyStudy()
let draftError = ""
try {
  const saved = localStorage.getItem(DRAFT_KEY)
  if (saved) draft = parseStudy(JSON.parse(saved))
} catch {
  draftError = "The saved planning draft could not be restored. Import a saved study to recover it."
}

export const planning = createStore<{
  study: Study
  results: PlanningResult[]
  busy: boolean
  cancelling: boolean
  progress: number
  message: string
  error: string
  notice: string
  view: string
  selectedResult: string
  revision: number
  pendingProfiles: Record<string, boolean>
  profileDrafts: Record<string, string>
}>({
  study: draft,
  results: [],
  busy: false,
  cancelling: false,
  progress: 0,
  message: "",
  error: draftError,
  notice: "",
  view: "study",
  selectedResult: "",
  revision: 0,
  pendingProfiles: {},
  profileDrafts: {},
})
let saveTimer: ReturnType<typeof setTimeout> | undefined

export function replacePlanningStudy(study: Study) {
  if (planning.get().busy) return
  updateStudy(study)
  planning.set((s) => ({
    ...s,
    view: "study",
    pendingProfiles: {},
    profileDrafts: {},
    revision: s.revision + 1,
  }))
}

export const planningHasPendingProfiles = () => Object.values(planning.get().pendingProfiles).some(Boolean)

export function updateStudy(study: Study) {
  planning.set((s) => ({ ...s, study, error: "", notice: "" }))
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(study))
    } catch {
      planning.set((s) => ({
        ...s,
        notice: "Draft could not be saved locally. Export the study JSON to keep your changes.",
      }))
    }
  }, 300)
}

export async function runPlanning() {
  if (planning.get().busy) return
  if (planningHasPendingProfiles()) {
    planning.set((s) => ({ ...s, error: "Apply or correct the edited profiles before optimizing." }))
    return
  }
  if (energyRunning.get()) {
    planning.set((s) => ({
      ...s,
      error: "Another analysis is running. Finish or cancel it before starting planning.",
    }))
    return
  }
  const study = structuredClone(planning.get().study)
  systemPlanningActive.set(true)
  planning.set((s) => ({
    ...s,
    busy: true,
    cancelling: false,
    error: "",
    progress: 0,
    message: "Starting PyPSA…",
    view: "results",
    selectedResult: "",
    notice: "",
  }))
  const off = EventsOn("sidecar:progress", (p: { progress: number; msg: string }) =>
    planning.set((s) => ({ ...s, progress: Math.max(0, p.progress), message: p.msg })),
  )
  try {
    const result = (await AnalyzeSystemPlanning(study)) as PlanningResult
    planning.set((s) => ({
      ...s,
      results: [result, ...s.results].slice(0, 5),
      notice: "Optimization complete.",
    }))
  } catch (e) {
    const msg = errorMessage(e)
    planning.set((s) => ({
      ...s,
      error: msg === "the request was cancelled" ? "" : msg,
      notice: msg === "the request was cancelled" ? "Planning cancelled." : "",
    }))
  } finally {
    off()
    systemPlanningActive.set(false)
    planning.set((s) => ({ ...s, busy: false, cancelling: false }))
  }
}

export async function cancelPlanning() {
  if (!planning.get().busy) return
  planning.set((s) => ({ ...s, cancelling: true }))
  try {
    await CancelRun()
  } catch (e) {
    planning.set((s) => ({ ...s, error: errorMessage(e), cancelling: false }))
  }
}

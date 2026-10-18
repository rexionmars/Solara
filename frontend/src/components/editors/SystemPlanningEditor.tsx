import { useEffect, useState } from "react"
import { usePlanningFiles } from "./usePlanningFiles"
import {
  Scroll,
  Table,
  FilePlus,
  FloppyDisk,
  FolderOpen,
  Graph,
  Play,
  SlidersHorizontal,
  StopCircle,
} from "../../lib/icons"
import { StudioHeaderMenu, StudioHeaderRadio } from "../studio/HeaderControls"
import { PanelSection } from "../ui/Fields"

import { geoPackage } from "../../lib/geopackage"
import { cancelPlanning, planning, runPlanning, studyKey, updateStudy, type Study } from "../../lib/planning"
import { useStore } from "../../lib/store"
import { AreaHeader } from "../studio/StudioArea"
import { btnGhostDense, btnPrimary, fieldInput } from "../ui/buttons"
import { number, selectStyle } from "./PlanningUI"
import { ComponentTable, Field, SeriesInput } from "./PlanningInputs"
import { PlanningResults, ResultTable } from "./PlanningResults"

export function SystemPlanningEditor() {
  const state = useStore(planning)
  const gpkg = useStore(geoPackage)
  const { study, busy } = state
  // Workspace changes remount editors; retain the last view and run selection.
  const tab = ["study", "network", "series", "results"].includes(state.view) ? state.view : "study"
  const setTab = (view: string) => planning.set((s) => ({ ...s, view }))
  const selected = state.selectedResult
  const setSelected = (selectedResult: string) => planning.set((s) => ({ ...s, selectedResult }))
  const [start, setStart] = useState(study.snapshots[0]?.time ?? "2026-01-01T00:00:00Z")
  const [count, setCount] = useState(study.snapshots.length || 24)
  const [step, setStep] = useState(study.snapshots[0]?.duration_hours ?? 1)
  const [assetKind, setAssetKind] = useState("generators")
  const [scheduleError, setScheduleError] = useState("")
  const pendingProfiles = state.pendingProfiles
  const setPendingProfiles = (pendingProfiles: Record<string, boolean>) =>
    planning.set((s) => ({ ...s, pendingProfiles, profileDrafts: {} }))
  const files = usePlanningFiles()
  const result = state.results.find((r) => r.created_at === selected) ?? state.results[0]
  const set = (patch: Partial<Study>) => updateStudy({ ...study, ...patch })
  const bus = study.buses[0]?.id ?? ""
  const buses = study.buses.map((b) => b.id)
  const seriesKey = JSON.stringify(study.snapshots)
  const id = (prefix: string, rows: { id: string }[]) => {
    let n = 1
    while (rows.some((r) => r.id === `${prefix}-${n}`)) n++
    return `${prefix}-${n}`
  }
  const replace = files.replace
  const save = files.save
  useEffect(() => {
    const current = planning.get().study
    setStart(current.snapshots[0]?.time ?? "2026-01-01T00:00:00Z")
    setCount(current.snapshots.length || 24)
    setStep(current.snapshots[0]?.duration_hours ?? 1)
    setScheduleError("")
  }, [state.revision])
  const pending = Object.values(pendingProfiles).some(Boolean)
  const markPending = (key: string, value: boolean) =>
    planning.set((s) => ({ ...s, pendingProfiles: { ...s.pendingProfiles, [key]: value } }))
  const buildHorizon = () => {
    const date = new Date(start)
    if (
      !/(Z|[+-]\d{2}:\d{2})$/.test(start) ||
      !Number.isFinite(date.getTime()) ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 8784 ||
      !Number.isFinite(step) ||
      step < 1 / 60 ||
      step > 24 ||
      count * step > 8784
    ) {
      setScheduleError(
        "Use an ISO start with timezone, 1–8,784 intervals, and a total horizon up to 8,784 hours.",
      )
      return
    }
    set({
      snapshots: Array.from({ length: count }, (_, i) => ({
        time: new Date(date.getTime() + i * step * 3600000).toISOString(),
        duration_hours: step,
      })),
      loads: study.loads.map((l) => ({ ...l, p_mw: Array(count).fill(0) })),
      generators: study.generators.map((g) => ({ ...g, availability: Array(count).fill(1) })),
    })
    setScheduleError("")
    setPendingProfiles({})
  }
  return (
    <>
      <AreaHeader
        menus={
          <>
            <StudioHeaderMenu
              label="File"
              items={() => [
                {
                  type: "action",
                  label: "New study",
                  icon: FilePlus,
                  disabled: busy && "Optimization in progress",
                  run: files.newStudy,
                },
                {
                  type: "action",
                  label: "Import study…",
                  icon: FolderOpen,
                  disabled: busy && "Optimization in progress",
                  run: files.importStudy,
                },
                {
                  type: "action",
                  label: "Load synthetic example",
                  icon: Graph,
                  disabled: busy && "Optimization in progress",
                  run: files.example,
                },
                { type: "sep" },
                {
                  type: "action",
                  label: "Export study…",
                  icon: FloppyDisk,
                  disabled: pending && "Apply the edited profiles first",
                  run: () => void save(study),
                },
                {
                  type: "action",
                  label: "Export run report…",
                  icon: FloppyDisk,
                  disabled: !result && "No solved study",
                  run: () => {
                    if (result) void save(result)
                  },
                },
              ]}
            />
            <StudioHeaderRadio
              value={tab}
              onChange={setTab}
              options={[
                {
                  id: "study",
                  label: "Study",
                  icon: SlidersHorizontal,
                  disabled: pending,
                },
                { id: "network", label: "Network", icon: Graph, disabled: pending },
                { id: "series", label: "Profiles", icon: Table, disabled: false },
                { id: "results", label: "Results", icon: Scroll, disabled: pending },
              ]}
            />
          </>
        }
        options={<span className="px-2 text-meta text-muted-foreground">PyPSA · HiGHS</span>}
      />
      <div className="flex min-h-0 flex-1 flex-col text-foreground">
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-2.5 py-2"
          style={{ borderColor: "var(--hairline)" }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium" title={study.name}>
              {study.name}
            </p>
            <p className="mt-0.5 text-meta text-muted-foreground">
              {study.mode === "dispatch" ? "Economic dispatch" : "Capacity expansion"} · {study.currency}
            </p>
          </div>
          <span className="telemetry text-meta text-muted-foreground">
            {study.buses.length} buses · {study.generators.length} generators · {study.snapshots.length}{" "}
            intervals
          </span>
          {files.input}
        </div>
        <div className="panel-scroll min-h-0 flex-1 overflow-auto" role="tabpanel">
          {state.error && (
            <p role="alert" className="border-b border-line/30 px-2.5 py-2 text-meta text-destructive-quiet">
              {state.error}
            </p>
          )}
          {state.notice && (
            <p
              role="status"
              className="border-b border-line/30 px-2.5 py-1.5 text-meta text-muted-foreground"
            >
              {state.notice}
            </p>
          )}
          {tab === "study" && (
            <div className="grid grid-cols-1 items-start @3xl:grid-cols-2">
              <div>
                <PanelSection title="Study">
                  <Field label="Name">
                    <input
                      disabled={busy}
                      className={fieldInput}
                      value={study.name}
                      onChange={(e) => set({ name: e.target.value })}
                    />
                  </Field>
                  <Field label="Mode">
                    <select
                      disabled={busy}
                      className={selectStyle}
                      value={study.mode}
                      onChange={(e) => set({ mode: e.target.value as Study["mode"] })}
                    >
                      <option value="dispatch">Economic dispatch</option>
                      <option value="expansion">Capacity expansion</option>
                    </select>
                  </Field>
                  <Field label="Currency">
                    <input
                      disabled={busy}
                      className={fieldInput}
                      value={study.currency}
                      onChange={(e) => set({ currency: e.target.value })}
                    />
                  </Field>
                  <Field label="CO₂ budget · t">
                    <input
                      disabled={busy}
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Unconstrained"
                      className={fieldInput}
                      value={study.co2_limit_tonnes ?? ""}
                      onChange={(e) =>
                        set({ co2_limit_tonnes: e.target.value === "" ? null : Number(e.target.value) })
                      }
                    />
                  </Field>
                </PanelSection>
                <PanelSection title="Sources & assumptions">
                  <textarea
                    aria-label="Data sources and assumptions"
                    disabled={busy}
                    placeholder="Record the sources and assumptions used in this study."
                    className={`${fieldInput} !h-24 resize-y py-2`}
                    value={study.provenance}
                    onChange={(e) => set({ provenance: e.target.value })}
                  />
                  {gpkg.file && (
                    <button
                      disabled={busy}
                      className={`${btnGhostDense} self-start`}
                      title={gpkg.file.path}
                      onClick={() =>
                        set({
                          provenance: `${study.provenance}${study.provenance ? "\n" : ""}Geographic reference: ${gpkg.file!.path}; analytical parameters supplied separately.`,
                        })
                      }
                    >
                      Cite {gpkg.file.name}
                    </button>
                  )}
                </PanelSection>
              </div>
              <div className="border-line/30 @3xl:border-l">
                <PanelSection
                  title="Horizon"
                  aside={
                    <span className="telemetry text-meta text-muted-foreground">
                      {number(study.snapshots.reduce((n, s) => n + s.duration_hours, 0))} h
                    </span>
                  }
                >
                  <Field label="Start · ISO / timezone">
                    <input
                      disabled={busy}
                      className={fieldInput}
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </Field>
                  <Field label="Intervals">
                    <input
                      disabled={busy}
                      type="number"
                      min="1"
                      max="8784"
                      className={fieldInput}
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Interval · hours">
                    <input
                      disabled={busy}
                      type="number"
                      min={1 / 60}
                      max="24"
                      step="any"
                      className={fieldInput}
                      value={step}
                      onChange={(e) => setStep(Number(e.target.value))}
                    />
                  </Field>
                  <div className="mt-1 flex justify-end">
                    <button disabled={busy} className={btnGhostDense} onClick={buildHorizon}>
                      Build horizon
                    </button>
                  </div>
                  <p className="text-meta leading-relaxed text-muted-foreground">
                    Rebuilding resets demand to zero and generator availability to 1.
                  </p>
                  {scheduleError && (
                    <p role="alert" className="text-meta text-destructive-quiet">
                      {scheduleError}
                    </p>
                  )}
                </PanelSection>
                {!study.buses.length && (
                  <PanelSection title="Get started">
                    <p className="text-meta leading-relaxed text-muted-foreground">
                      Import a study or add components in Network.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busy} className={btnGhostDense} onClick={files.importStudy}>
                        <FolderOpen className="size-3" />
                        Import study…
                      </button>
                      <button disabled={busy} className={btnGhostDense} onClick={files.example}>
                        Synthetic example
                      </button>
                    </div>
                  </PanelSection>
                )}
              </div>
            </div>
          )}
          {tab === "network" && (
            <div className="flex flex-col">
              <div
                role="tablist"
                aria-label="Network components"
                className="flex flex-wrap gap-1 border-b border-line/30 px-2.5 py-1.5"
              >
                {(
                  [
                    ["buses", "Buses", study.buses.length],
                    ["generators", "Generators", study.generators.length],
                    ["loads", "Loads", study.loads.length],
                    ["lines", "Lines", study.lines.length],
                    ["storage", "Storage", study.storage.length],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={assetKind === key}
                    onClick={() => setAssetKind(key)}
                    className={`flex items-center gap-2 rounded-sm px-2 py-1 text-meta ${assetKind === key ? "bg-selected text-accent" : "text-muted-foreground hover:bg-hover"}`}
                  >
                    {label}
                    <span className="telemetry text-[9px] opacity-70">{count}</span>
                  </button>
                ))}
              </div>
              {assetKind === "buses" && (
                <ComponentTable
                  label="Buses"
                  disabled={busy}
                  rows={study.buses}
                  buses={buses}
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "v_nom_kv", label: "Nominal voltage · kV", type: "number" },
                  ]}
                  onChange={(buses) => set({ buses })}
                  create={() => ({ id: id("bus", study.buses), v_nom_kv: 110 })}
                />
              )}
              {assetKind === "generators" && (
                <ComponentTable
                  label="Generators"
                  disabled={busy}
                  rows={study.generators}
                  buses={buses}
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "bus", label: "Bus", type: "bus" },
                    { key: "carrier", label: "Technology" },
                    { key: "existing_mw", label: "Existing · MW", type: "number" },
                    { key: "expandable", label: "Expand", type: "boolean" },
                    { key: "max_mw", label: "Maximum · MW", type: "number" },
                    {
                      key: "annualized_cost_per_mw_year",
                      label: `${study.currency}/MW/year`,
                      type: "number",
                    },
                    { key: "marginal_cost_per_mwh", label: `${study.currency}/MWh`, type: "number" },
                    { key: "co2_tonnes_per_mwh", label: "Direct CO₂ · t/MWh output", type: "number" },
                  ]}
                  onChange={(generators) => set({ generators })}
                  create={() => ({
                    id: id("generator", study.generators),
                    bus,
                    carrier: "unspecified",
                    existing_mw: 0,
                    expandable: false,
                    max_mw: 0,
                    annualized_cost_per_mw_year: 0,
                    marginal_cost_per_mwh: 0,
                    co2_tonnes_per_mwh: 0,
                    availability: Array(study.snapshots.length).fill(1),
                  })}
                />
              )}
              {assetKind === "loads" && (
                <ComponentTable
                  label="Loads"
                  disabled={busy}
                  rows={study.loads}
                  buses={buses}
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "bus", label: "Bus", type: "bus" },
                  ]}
                  onChange={(loads) => set({ loads })}
                  create={() => ({
                    id: id("load", study.loads),
                    bus,
                    p_mw: Array(study.snapshots.length).fill(0),
                  })}
                />
              )}
              {assetKind === "lines" && (
                <ComponentTable
                  label="Lines"
                  disabled={busy}
                  rows={study.lines}
                  buses={buses}
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "bus0", label: "From bus", type: "bus" },
                    { key: "bus1", label: "To bus", type: "bus" },
                    { key: "x_ohm", label: "Reactance · Ω", type: "number" },
                    { key: "existing_mva", label: "Existing · MVA", type: "number" },
                    { key: "expandable", label: "Reinforce", type: "boolean" },
                    { key: "max_mva", label: "Maximum · MVA", type: "number" },
                    {
                      key: "annualized_cost_per_mva_year",
                      label: `${study.currency}/MVA/year`,
                      type: "number",
                    },
                  ]}
                  onChange={(lines) => set({ lines })}
                  create={() => ({
                    id: id("line", study.lines),
                    bus0: bus,
                    bus1: study.buses[1]?.id ?? "",
                    x_ohm: 0,
                    existing_mva: 0,
                    expandable: false,
                    max_mva: 0,
                    annualized_cost_per_mva_year: 0,
                  })}
                />
              )}
              {assetKind === "storage" && (
                <ComponentTable
                  label="Storage"
                  disabled={busy}
                  rows={study.storage}
                  buses={buses}
                  columns={[
                    { key: "id", label: "ID" },
                    { key: "bus", label: "Bus", type: "bus" },
                    { key: "existing_mw", label: "Existing · MW", type: "number" },
                    { key: "expandable", label: "Expand", type: "boolean" },
                    { key: "max_mw", label: "Maximum · MW", type: "number" },
                    { key: "max_hours", label: "Energy/power · h", type: "number" },
                    {
                      key: "annualized_cost_per_mw_year",
                      label: `${study.currency}/MW/year`,
                      type: "number",
                    },
                    {
                      key: "marginal_cost_per_mwh",
                      label: `${study.currency}/MWh discharged`,
                      type: "number",
                    },
                    { key: "efficiency_store", label: "Charge efficiency · 0–1", type: "number" },
                    { key: "efficiency_dispatch", label: "Discharge efficiency · 0–1", type: "number" },
                  ]}
                  onChange={(storage) => set({ storage })}
                  create={() => ({
                    id: id("storage", study.storage),
                    bus,
                    existing_mw: 0,
                    expandable: false,
                    max_mw: 0,
                    annualized_cost_per_mw_year: 0,
                    marginal_cost_per_mwh: 0,
                    max_hours: 4,
                    efficiency_store: 0.95,
                    efficiency_dispatch: 0.95,
                  })}
                />
              )}
            </div>
          )}
          {tab === "series" && (
            <div className="flex flex-col gap-3 px-2.5 py-2.5">
              <p className="text-meta text-muted-foreground">
                Interval averages: demand in MW, availability from 0 to 1. Apply each edited profile before
                running.
              </p>
              {!study.snapshots.length && <p>Build a horizon in Study before entering profiles.</p>}
              {study.loads.map((load, i) => (
                <SeriesInput
                  key={`${seriesKey}:load:${i}:${JSON.stringify(load.p_mw)}`}
                  disabled={busy}
                  label={`Demand · ${load.id} · MW`}
                  values={load.p_mw}
                  count={study.snapshots.length}
                  onPending={(p) => markPending(`load:${load.id}`, p)}
                  onChange={(p_mw) =>
                    set({ loads: study.loads.map((l, j) => (i === j ? { ...l, p_mw } : l)) })
                  }
                />
              ))}
              {study.generators.map((g, i) => (
                <SeriesInput
                  key={`${seriesKey}:gen:${i}:${JSON.stringify(g.availability)}`}
                  disabled={busy}
                  label={`Availability · ${g.id} · per unit`}
                  values={g.availability}
                  count={study.snapshots.length}
                  maximum={1}
                  onPending={(p) => markPending(`generator:${g.id}`, p)}
                  onChange={(availability) =>
                    set({
                      generators: study.generators.map((g, j) => (i === j ? { ...g, availability } : g)),
                    })
                  }
                />
              ))}
            </div>
          )}
          {tab === "results" && (
            <div className="flex flex-col gap-3 px-2.5 py-2.5">
              {result ? (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Run">
                      <select
                        className={selectStyle}
                        value={result.created_at}
                        onChange={(e) => setSelected(e.target.value)}
                      >
                        {state.results.map((r) => (
                          <option key={r.created_at} value={r.created_at}>
                            {r.study.name} · {r.study.mode} · {new Date(r.created_at).toLocaleString()}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <button
                      disabled={busy}
                      className={btnGhostDense}
                      onClick={() => replace(structuredClone(result.study))}
                    >
                      Use these inputs
                    </button>
                  </div>
                  {studyKey(result.study) !== studyKey(study) && (
                    <p role="status" className="text-meta text-accent">
                      The draft differs from this solved study. Results retain the inputs recorded at
                      execution.
                    </p>
                  )}
                  <PlanningResults key={result.created_at} result={result} />
                  {state.results.length > 1 && (
                    <section>
                      <h3 className="mb-2 text-emphasis">Scenario results</h3>
                      <p className="mb-2 text-meta text-muted-foreground">
                        Compare costs only for compatible currencies, horizons and demand. Each report
                        preserves its own assumptions.
                      </p>
                      <ResultTable
                        headers={["Study / mode", "Currency", "Hours", "Demand · MWh", "Cost", "CO₂ · t"]}
                        rows={state.results.map((r) => [
                          r.study.name + " / " + r.study.mode,
                          r.study.currency,
                          number(r.summary.hours),
                          number(r.summary.demand_mwh),
                          number(r.summary.objective),
                          number(r.summary.co2_tonnes),
                        ])}
                      />
                    </section>
                  )}
                </>
              ) : (
                <p className="text-body text-muted-foreground">
                  Run the study to view dispatch, capacities and costs.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line/30 px-2.5 py-1.5">
          <button
            className={`${btnPrimary} !h-7 !text-meta`}
            disabled={busy || pending}
            onClick={() => {
              setSelected("")
              setTab("results")
              void runPlanning()
            }}
          >
            <Play className="size-3" />
            {busy ? "Optimizing…" : "Optimize"}
          </button>
          {!busy && !pending && <span className="ml-auto text-meta text-muted-foreground">Local draft</span>}
          {pending && (
            <span role="status" className="text-meta text-accent">
              Finish or correct the edited demand/availability profile before running.
            </span>
          )}
          {busy && (
            <>
              <button
                disabled={state.cancelling}
                className={btnGhostDense}
                onClick={() => void cancelPlanning()}
              >
                <StopCircle className="size-3" />
                {state.cancelling ? "Cancelling…" : "Cancel"}
              </button>
              <progress
                aria-label="Planning progress"
                className="h-2 w-24"
                max={100}
                value={state.progress}
              />
              <span role="status" className="text-meta text-muted-foreground">
                {state.message}
              </span>
            </>
          )}
        </div>
      </div>
    </>
  )
}

import { useMemo, useState } from "react"
import { Check, Plus, Scroll, Warning } from "../../lib/icons"
import { geoPackage } from "../../lib/geopackage"
import { checkStudy, planning, type Kind, type Selection, type Study } from "../../lib/planning"
import { useStore } from "../../lib/store"
import { ask } from "../../lib/ui"
import { StudioPopover } from "../studio/Popover"
import { btnGhostDense } from "../ui/buttons"
import { PlanningDiagram } from "./PlanningDiagram"
import { ComponentTable } from "./PlanningInputs"
import { PlanningInspector, createComponent } from "./PlanningInspector"
import { NumberInput, Seg, TextInput, fixed, moment } from "./PlanningUI"

const chip =
  "flex h-7 shrink-0 items-center gap-2 rounded-[7px] border border-line/40 bg-control px-2.5 text-emphasis text-foreground transition-colors hover:bg-hover disabled:opacity-60"

/** The horizon in one line: where it starts and how it is cut. */
function horizonLabel(study: Study) {
  const n = study.snapshots.length
  if (!n) return { start: "Not built", cut: "" }
  const steps = new Set(study.snapshots.map((s) => s.duration_hours))
  const step = steps.size === 1 ? `${fixed(study.snapshots[0].duration_hours, study.snapshots[0].duration_hours % 1 ? 2 : 0)} h` : "mixed steps"
  return { start: `${moment(study.snapshots[0].time)} UTC`, cut: `${n} × ${step}` }
}

/** Where the horizon starts, how many intervals and how long each, rebuilt in one press. */
function HorizonControl({ study, busy, set }: { study: Study; busy: boolean; set: (p: Partial<Study>) => void }) {
  const [open, setOpen] = useState(false)
  const first = study.snapshots[0]
  const startIso = first ? new Date(first.time).toISOString() : "2026-01-01T00:00:00.000Z"
  const [date, setDate] = useState(startIso.slice(0, 10))
  const [time, setTime] = useState(startIso.slice(11, 16))
  const [count, setCount] = useState<number | null>(study.snapshots.length || 24)
  const [step, setStep] = useState<number | null>(first?.duration_hours ?? 1)
  const [error, setError] = useState("")
  const label = horizonLabel(study)

  const build = async () => {
    const start = new Date(`${date}T${time}:00Z`)
    if (Number.isNaN(start.getTime()) || count == null || step == null || !Number.isInteger(count) || count < 1 || count > 8784 || step < 1 / 60 || step > 24 || count * step > 8784) {
      setError("Use 1 to 8,784 intervals of 1 minute to 24 hours, at most 8,784 hours in all.")
      return
    }
    const shaped = study.loads.some((l) => l.p_mw.some((v) => v !== 0)) || study.generators.some((g) => g.availability.some((v) => v !== 1))
    if (shaped) {
      const answer = await ask("Rebuild the horizon?", "Every demand is set to 0 and every availability to 1, since the old profiles have the old intervals.", [
        { label: "Cancel", value: "cancel" },
        { label: "Rebuild", value: "rebuild", danger: true, primary: true },
      ])
      if (answer !== "rebuild") return
    }
    set({
      snapshots: Array.from({ length: count }, (_, i) => ({ time: new Date(start.getTime() + i * step * 3600000).toISOString(), duration_hours: step })),
      loads: study.loads.map((l) => ({ ...l, p_mw: Array(count).fill(0) })),
      generators: study.generators.map((g) => ({ ...g, availability: Array(count).fill(1) })),
    })
    planning.set((s) => ({ ...s, pendingProfiles: {}, profileDrafts: {} }))
    setError("")
    setOpen(false)
  }

  return (
    <StudioPopover
      open={open}
      onOpenChange={setOpen}
      role="dialog"
      widthRem={19}
      portal="viewport"
      trigger={(p) => (
        <button
          type="button"
          ref={p.ref as React.Ref<HTMLButtonElement>}
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-haspopup="dialog"
          disabled={busy}
          className={chip}
        >
          <span className="text-muted-foreground">Horizon</span>
          <span>{label.start}</span>
          {label.cut && <span className="text-muted-foreground">{label.cut}</span>}
        </button>
      )}
    >
      <div className="flex flex-col gap-2.5 p-3 text-emphasis">
        <p className="font-medium text-foreground">Horizon</p>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)] gap-2">
          <label className="flex flex-col gap-1 text-body text-muted-foreground">
            Start date, UTC
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-7 rounded-[6px] border border-line/40 bg-field px-2 text-emphasis text-foreground outline-none focus:border-accent/60 [color-scheme:dark]" />
          </label>
          <label className="flex flex-col gap-1 text-body text-muted-foreground">
            Time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-7 rounded-[6px] border border-line/40 bg-field px-2 text-emphasis text-foreground outline-none focus:border-accent/60 [color-scheme:dark]" />
          </label>
          <div className="flex flex-col gap-1 text-body text-muted-foreground">
            Intervals
            <NumberInput label="Intervals" value={count} onChange={setCount} />
          </div>
          <div className="flex flex-col gap-1 text-body text-muted-foreground">
            Each
            <NumberInput label="Interval length" unit="h" value={step} onChange={setStep} />
          </div>
        </div>
        <p className="text-body text-muted-foreground">
          {count && step ? `${fixed(count * step, (count * step) % 1 ? 1 : 0)} hours in all. ` : ""}Rebuilding sets every demand to 0 and every availability to 1.
        </p>
        {error && (
          <p role="alert" className="text-body text-destructive-quiet">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-1.5">
          <button type="button" className={btnGhostDense} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className={`${btnGhostDense} !border-accent/50 !text-foreground`} onClick={() => void build()}>
            Build horizon
          </button>
        </div>
      </div>
    </StudioPopover>
  )
}

/** The study's sources and assumptions, which the engine requires and every report carries. */
function SourcesControl({ study, busy, set }: { study: Study; busy: boolean; set: (p: Partial<Study>) => void }) {
  const [open, setOpen] = useState(false)
  const gpkg = useStore(geoPackage)
  const lines = study.provenance.trim() ? study.provenance.trim().split(/\n+/).length : 0
  return (
    <StudioPopover
      open={open}
      onOpenChange={setOpen}
      role="dialog"
      widthRem={24}
      portal="viewport"
      trigger={(p) => (
        <button
          type="button"
          ref={p.ref as React.Ref<HTMLButtonElement>}
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-haspopup="dialog"
          className={`${chip} ${lines ? "" : "!border-warning/50"}`}
        >
          <Scroll className="size-3.5 text-muted-foreground" />
          <span>Sources and assumptions</span>
          {!lines && <span className="text-warning">missing</span>}
        </button>
      )}
    >
      <div className="flex flex-col gap-2 p-3 text-emphasis">
        <label htmlFor="planning-sources" className="font-medium text-foreground">
          Sources and assumptions
        </label>
        <textarea
          id="planning-sources"
          rows={6}
          disabled={busy}
          placeholder="Where each profile, cost and network parameter came from, and what was assumed."
          value={study.provenance}
          onChange={(e) => set({ provenance: e.target.value })}
          className="resize-y rounded-[6px] border border-line/40 bg-field px-2 py-1.5 text-emphasis text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/60"
        />
        <p className="text-body text-muted-foreground">Required to optimize. Every run report keeps it.</p>
        {gpkg.file && (
          <button
            type="button"
            disabled={busy}
            className={`${btnGhostDense} self-start`}
            title={gpkg.file.path}
            onClick={() =>
              set({
                provenance: `${study.provenance}${study.provenance ? "\n" : ""}Geographic reference: ${gpkg.file!.name}; analytical parameters supplied separately.`,
              })
            }
          >
            Cite {gpkg.file.name}
          </button>
        )}
      </div>
    </StudioPopover>
  )
}

const TABLES: { kind: Kind; label: string }[] = [
  { kind: "buses", label: "Buses" },
  { kind: "generators", label: "Generators" },
  { kind: "loads", label: "Loads" },
  { kind: "lines", label: "Lines" },
  { kind: "storage", label: "Storage" },
]

/** Every kind as a spreadsheet, one kind at a time. */
function NetworkTables({
  study,
  busy,
  set,
  selection,
  onSelect,
}: {
  study: Study
  busy: boolean
  set: (p: Partial<Study>) => void
  selection: Selection | null
  onSelect: (s: Selection) => void
}) {
  const [kind, setKind] = useState<Kind>(selection?.kind ?? "generators")
  const buses = study.buses.map((b) => b.id)
  const bus = buses[0] ?? ""
  const cur = study.currency || "currency"
  const common = { disabled: busy, buses, selected: selection?.kind === kind ? selection.index : null, onSelect: (index: number) => onSelect({ kind, index }) }
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-panel">
      <div className="flex flex-wrap gap-1 border-b border-line/25 px-4 py-2">
        <Seg
          label="Component kind"
          size="sm"
          value={kind}
          onChange={setKind}
          options={TABLES.map((t) => ({ value: t.kind, label: `${t.label} ${study[t.kind].length}` }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {kind === "buses" && (
          <ComponentTable
            {...common}
            label="Buses"
            rows={study.buses}
            columns={[
              { key: "id", label: "ID" },
              { key: "v_nom_kv", label: "Nominal voltage, kV", type: "number" },
            ]}
            onChange={(buses) => set({ buses })}
            create={() => createComponent("buses", study, bus) as Study["buses"][number]}
          />
        )}
        {kind === "generators" && (
          <ComponentTable
            {...common}
            label="Generators"
            rows={study.generators}
            columns={[
              { key: "id", label: "ID" },
              { key: "bus", label: "Bus", type: "bus" },
              { key: "carrier", label: "Technology" },
              { key: "existing_mw", label: "Existing, MW", type: "number" },
              { key: "expandable", label: "Expandable", type: "boolean" },
              { key: "max_mw", label: "Upper bound, MW", type: "number" },
              { key: "annualized_cost_per_mw_year", label: `Capacity cost, ${cur}/MW·yr`, type: "number" },
              { key: "marginal_cost_per_mwh", label: `Marginal cost, ${cur}/MWh`, type: "number" },
              { key: "co2_tonnes_per_mwh", label: "Direct CO₂, t/MWh", type: "number" },
            ]}
            onChange={(generators) => set({ generators })}
            create={() => createComponent("generators", study, bus) as Study["generators"][number]}
          />
        )}
        {kind === "loads" && (
          <ComponentTable
            {...common}
            label="Loads"
            rows={study.loads}
            columns={[
              { key: "id", label: "ID" },
              { key: "bus", label: "Bus", type: "bus" },
            ]}
            onChange={(loads) => set({ loads })}
            create={() => createComponent("loads", study, bus) as Study["loads"][number]}
          />
        )}
        {kind === "lines" && (
          <ComponentTable
            {...common}
            label="Lines"
            rows={study.lines}
            columns={[
              { key: "id", label: "ID" },
              { key: "bus0", label: "From bus", type: "bus" },
              { key: "bus1", label: "To bus", type: "bus" },
              { key: "x_ohm", label: "Reactance, Ω", type: "number" },
              { key: "existing_mva", label: "Existing, MVA", type: "number" },
              { key: "expandable", label: "Reinforce", type: "boolean" },
              { key: "max_mva", label: "Upper bound, MVA", type: "number" },
              { key: "annualized_cost_per_mva_year", label: `Capacity cost, ${cur}/MVA·yr`, type: "number" },
            ]}
            onChange={(lines) => set({ lines })}
            create={() => createComponent("lines", study, bus) as Study["lines"][number]}
          />
        )}
        {kind === "storage" && (
          <ComponentTable
            {...common}
            label="Storage"
            rows={study.storage}
            columns={[
              { key: "id", label: "ID" },
              { key: "bus", label: "Bus", type: "bus" },
              { key: "existing_mw", label: "Existing, MW", type: "number" },
              { key: "expandable", label: "Expandable", type: "boolean" },
              { key: "max_mw", label: "Upper bound, MW", type: "number" },
              { key: "max_hours", label: "Hours at full power", type: "number" },
              { key: "annualized_cost_per_mw_year", label: `Capacity cost, ${cur}/MW·yr`, type: "number" },
              { key: "marginal_cost_per_mwh", label: `Marginal cost, ${cur}/MWh out`, type: "number" },
              { key: "efficiency_store", label: "Charge efficiency", type: "number" },
              { key: "efficiency_dispatch", label: "Discharge efficiency", type: "number" },
            ]}
            onChange={(storage) => set({ storage })}
            create={() => createComponent("storage", study, bus) as Study["storage"][number]}
          />
        )}
      </div>
      {!study.snapshots.length && (
        <p className="border-t border-line/25 px-4 py-2 text-body text-muted-foreground">Profiles are edited in the inspector, once the horizon is built.</p>
      )}
    </div>
  )
}

const ADD: { kind: Kind; label: string }[] = [
  { kind: "buses", label: "Bus" },
  { kind: "generators", label: "Generator" },
  { kind: "loads", label: "Load" },
  { kind: "lines", label: "Line" },
  { kind: "storage", label: "Storage" },
]

/**
 * Where a study is made: the study's settings in one bar, the network drawn
 * in the middle, the component in hand on the right.
 */
export function PlanningBuild({
  study,
  set,
  onExample,
  onImport,
}: {
  study: Study
  set: (p: Partial<Study>) => void
  onExample: () => void
  onImport: () => void
}) {
  const state = useStore(planning)
  const { busy, selection } = state
  const [view, setView] = useState<"diagram" | "table">(study.buses.length > 60 ? "table" : "diagram")
  const issues = useMemo(() => checkStudy(study), [study])
  const faults = useMemo(() => new Set(issues.filter((i) => i.at).map((i) => `${i.at!.kind}:${i.at!.index}`)), [issues])
  const select = (s: Selection | null) => planning.set((p) => ({ ...p, selection: s }))
  const selectedBus =
    selection?.kind === "buses"
      ? study.buses[selection.index]?.id
      : selection && selection.kind !== "lines"
        ? (study[selection.kind][selection.index] as { bus?: string } | undefined)?.bus
        : undefined
  const add = (kind: Kind) => {
    if (kind !== "buses" && !study.buses.length) return
    const bus = selectedBus && study.buses.some((b) => b.id === selectedBus) ? selectedBus : study.buses[0]?.id ?? ""
    const row = createComponent(kind, study, bus)
    set({ [kind]: [...(study[kind] as object[]), row] } as Partial<Study>)
    select({ kind, index: study[kind].length })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-line/25 bg-panel px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-emphasis text-muted-foreground">Mode</span>
          <Seg
            label="Mode"
            size="sm"
            value={study.mode}
            disabled={busy}
            onChange={(mode) => set({ mode })}
            options={[
              { value: "dispatch", label: "Dispatch" },
              { value: "expansion", label: "Expansion" },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-emphasis text-muted-foreground">Currency</span>
          <TextInput label="Currency" disabled={busy} value={study.currency} onChange={(currency) => set({ currency })} className="!w-16" />
        </div>
        <div className="flex items-center gap-2" title="Total direct emissions allowed over the horizon. Empty means no cap.">
          <span className="text-emphasis text-muted-foreground">CO₂ cap</span>
          <NumberInput
            label="CO₂ cap"
            allowEmpty
            placeholder="None"
            unit="t"
            disabled={busy}
            value={study.co2_limit_tonnes}
            onChange={(co2_limit_tonnes) => set({ co2_limit_tonnes })}
            className="!w-28"
          />
        </div>
        <HorizonControl key={state.revision} study={study} busy={busy} set={set} />
        <SourcesControl study={study} busy={busy} set={set} />
        <div className="flex-1" />
        {Object.values(state.pendingProfiles).some(Boolean) ? (
          <span className="flex items-center gap-1.5 text-emphasis text-warning">
            <Warning className="size-3.5" />A profile edit is not applied yet
          </span>
        ) : issues.length ? (
          <button type="button" className="flex items-center gap-1.5 text-emphasis text-warning hover:underline" onClick={() => select(null)}>
            <Warning className="size-3.5" />
            {issues.length} {issues.length === 1 ? "thing" : "things"} to fix before optimizing
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-emphasis">
            <Check className="size-3.5 text-olive-light" weight="bold" />
            Ready to optimize
            <span className="text-muted-foreground">
              {study.buses.length} {study.buses.length === 1 ? "bus" : "buses"} · {study.generators.length} gen. · {study.loads.length}{" "}
              {study.loads.length === 1 ? "load" : "loads"} · {study.lines.length} {study.lines.length === 1 ? "line" : "lines"} · {study.storage.length} storage
            </span>
          </span>
        )}
      </div>

      {/* One row, never wrapped: a wrapped line takes the height of its tallest item, and the inspector's list would stretch the diagram past the window. */}
      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Network"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          style={{
            backgroundColor: "var(--s-board)",
            backgroundImage: "radial-gradient(circle, rgb(var(--p-line) / 0.32) 1px, transparent 1.2px)",
            backgroundSize: "22px 22px",
          }}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 py-3">
            <span className="mr-0.5 text-emphasis text-muted-foreground">Add</span>
            {ADD.map((a) => (
              <button
                key={a.kind}
                type="button"
                disabled={busy || (a.kind !== "buses" && !study.buses.length)}
                title={a.kind !== "buses" && !study.buses.length ? "Add a bus first: every component connects to one" : undefined}
                className={`${btnGhostDense} !bg-panel !text-emphasis !text-foreground`}
                onClick={() => add(a.kind)}
              >
                <Plus className="size-3" />
                {a.label}
              </button>
            ))}
            <div className="flex-1" />
            <Seg
              label="Network view"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "diagram", label: "Diagram" },
                { value: "table", label: "Table" },
              ]}
            />
          </div>
          {view === "diagram" ? (
            study.buses.length || study.generators.length || study.loads.length || study.storage.length ? (
              <PlanningDiagram study={study} selection={selection} onSelect={select} faults={faults} />
            ) : (
              <div className="grid flex-1 place-items-center px-6 text-center">
                <div className="flex max-w-[26rem] flex-col items-center gap-2">
                  <p className="text-heading text-foreground">No network yet</p>
                  <p className="text-emphasis text-muted-foreground">Add a bus, then the generators, loads, lines and storage connected to it, or start from the example in the inspector.</p>
                </div>
              </div>
            )
          ) : (
            <NetworkTables study={study} busy={busy} set={set} selection={selection} onSelect={select} />
          )}
          {view === "diagram" && (
            <p className="shrink-0 px-4 pb-3 text-body text-muted-foreground">
              A drawing of the study, not a map: each component connects through the bus it names, and its place here means nothing. Drag the
              ground to move it; pinch, or scroll with Cmd held, to zoom.
            </p>
          )}
        </section>
        <aside aria-label="Inspector" className="flex min-h-0 w-[clamp(300px,28vw,400px)] shrink-0 flex-col overflow-y-auto border-l border-line/25 bg-panel">
          <PlanningInspector
            study={study}
            selection={selection}
            issues={issues}
            busy={busy}
            set={set}
            onSelect={select}
            onExample={onExample}
            onImport={onImport}
          />
        </aside>
      </div>
    </div>
  )
}

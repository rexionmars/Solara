import type { ReactNode } from "react"
import { FolderOpen, Graph, Trash, Warning } from "../../lib/icons"
import { type Kind, type Selection, type Study, type StudyIssue } from "../../lib/planning"
import { ask } from "../../lib/ui"
import { btnGhost, btnIcon } from "../ui/buttons"
import { ProfileEditor } from "./PlanningInputs"
import { NumberInput, Row, STORAGE_COLOR, Section, SelectInput, TextInput, Toggle, carrierColor, fixed } from "./PlanningUI"

/** A new component of each kind, connected to `bus` and sized for the horizon there is. */
export function createComponent(kind: Kind, study: Study, bus: string) {
  const n = study.snapshots.length
  const id = (prefix: string, rows: { id: string }[]) => {
    let i = 1
    while (rows.some((r) => r.id === `${prefix}-${i}`)) i++
    return `${prefix}-${i}`
  }
  switch (kind) {
    case "buses":
      return { id: id("bus", study.buses), v_nom_kv: study.buses[0]?.v_nom_kv ?? 110 }
    case "generators":
      return {
        id: id("generator", study.generators),
        bus,
        carrier: "unspecified",
        existing_mw: 0,
        expandable: false,
        max_mw: 0,
        annualized_cost_per_mw_year: 0,
        marginal_cost_per_mwh: 0,
        co2_tonnes_per_mwh: 0,
        availability: Array(n).fill(1),
      }
    case "loads":
      return { id: id("load", study.loads), bus, p_mw: Array(n).fill(0) }
    case "lines":
      return {
        id: id("line", study.lines),
        bus0: bus,
        bus1: study.buses.find((b) => b.id !== bus)?.id ?? "",
        x_ohm: 1,
        existing_mva: 1,
        expandable: false,
        max_mva: 1,
        annualized_cost_per_mva_year: 0,
      }
    case "storage":
      return {
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
      }
  }
}

/** What a component is called in a list: its ID and the one figure that says most about it. */
export function caption(study: Study, kind: Kind, index: number): string {
  switch (kind) {
    case "buses":
      return `${fixed(study.buses[index].v_nom_kv, study.buses[index].v_nom_kv % 1 ? 1 : 0)} kV`
    case "generators": {
      const g = study.generators[index]
      return `${g.carrier} · ${fixed(g.existing_mw, 0)} MW${g.expandable ? `, to ${fixed(g.max_mw, 0)}` : ""}`
    }
    case "loads": {
      const p = study.loads[index].p_mw
      return p.length ? `peak ${fixed(Math.max(...p), 0)} MW` : "no profile"
    }
    case "lines": {
      const l = study.lines[index]
      return `${l.bus0 || "?"} to ${l.bus1 || "?"} · ${fixed(l.existing_mva, 0)} MVA`
    }
    case "storage": {
      const s = study.storage[index]
      return `${fixed(s.existing_mw, 0)} MW${s.expandable ? `, to ${fixed(s.max_mw, 0)}` : ""} · ${fixed(s.max_hours, 0)} h`
    }
  }
}

const KINDS: Kind[] = ["buses", "generators", "loads", "lines", "storage"]
const PLURAL: Record<Kind, string> = { buses: "Buses", generators: "Generators", loads: "Loads", lines: "Lines", storage: "Storage" }

function Issues({ issues, onSelect }: { issues: StudyIssue[]; onSelect?: (s: Selection) => void }) {
  if (!issues.length) return null
  return (
    <ul className="flex flex-col gap-1.5" aria-label="What to fix before optimizing">
      {issues.map((i, k) => (
        <li key={k} className="flex items-start gap-2 text-emphasis text-warning">
          <Warning className="mt-0.5 size-3.5 shrink-0" />
          {i.at && onSelect ? (
            <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onSelect(i.at!)}>
              {i.message}
            </button>
          ) : (
            <span>{i.message}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** The inspector with nothing in hand: every component by kind, and what is left to fix. */
function Overview({
  study,
  issues,
  onSelect,
  onExample,
  onImport,
  busy,
}: {
  study: Study
  issues: StudyIssue[]
  onSelect: (s: Selection) => void
  onExample: () => void
  onImport: () => void
  busy: boolean
}) {
  const empty = KINDS.every((k) => !study[k].length)
  return (
    <>
      <header className="border-b border-line/25 px-4 pb-3 pt-4">
        <p className="text-body text-muted-foreground">Study</p>
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">{empty ? "An empty study" : "Components"}</h2>
        <p className="mt-0.5 text-emphasis text-muted-foreground">
          {empty ? "Start from the example, import a study, or add a bus." : "Select one on the diagram or in this list to edit it."}
        </p>
      </header>
      {empty && (
        <Section title="Start">
          <div className="flex flex-col gap-2">
            <button type="button" disabled={busy} className={`${btnGhost} justify-start`} onClick={onExample}>
              <Graph className="size-3.5" />
              Load the synthetic example
            </button>
            <button type="button" disabled={busy} className={`${btnGhost} justify-start`} onClick={onImport}>
              <FolderOpen className="size-3.5" />
              Import a study…
            </button>
          </div>
          <p className="text-body text-muted-foreground">The example is fictional: two buses, gas, solar, a line and a battery over 24 hours.</p>
        </Section>
      )}
      {!!issues.length && (
        <Section title="Before optimizing" aside={<span className="text-body text-warning">{issues.length}</span>}>
          <Issues issues={issues} onSelect={onSelect} />
        </Section>
      )}
      {KINDS.filter((k) => study[k].length).map((kind) => (
        <Section key={kind} title={PLURAL[kind]} aside={<span className="tabular-nums text-body text-muted-foreground">{study[kind].length}</span>}>
          <ul className="-mx-2 flex flex-col">
            {(study[kind] as { id: string }[]).map((row, index) => (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind, index })}
                  className="flex w-full items-baseline justify-between gap-3 rounded-[6px] px-2 py-1 text-left hover:bg-hover"
                >
                  <span className="truncate text-emphasis text-foreground">{row.id || `(no ID)`}</span>
                  <span className="shrink-0 text-body text-muted-foreground">{caption(study, kind, index)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </>
  )
}

function Head({ kind, name, sub, onRemove, busy }: { kind: string; name: string; sub: ReactNode; onRemove: () => void; busy: boolean }) {
  return (
    <header className="flex items-start gap-3 border-b border-line/25 px-4 pb-3 pt-4">
      <div className="min-w-0 flex-1">
        <p className="text-body text-muted-foreground">{kind}</p>
        <h2 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-foreground">{name || "(no ID)"}</h2>
        <p className="mt-0.5 text-emphasis text-muted-foreground">{sub}</p>
      </div>
      <button type="button" disabled={busy} className={btnIcon} aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={onRemove}>
        <Trash className="size-3.5" />
      </button>
    </header>
  )
}

/**
 * The component in hand, every field of it, in the units the engine reads.
 *
 * Renaming a bus renames it wherever a component names it, since a component
 * is connected only by the bus ID it holds.
 */
export function PlanningInspector({
  study,
  selection,
  issues,
  busy,
  set,
  onSelect,
  onExample,
  onImport,
}: {
  study: Study
  selection: Selection | null
  issues: StudyIssue[]
  busy: boolean
  set: (patch: Partial<Study>) => void
  onSelect: (s: Selection | null) => void
  onExample: () => void
  onImport: () => void
}) {
  const buses = study.buses.map((b) => b.id)
  const times = study.snapshots.map((s) => s.time)
  const cur = study.currency || "currency"
  const mine = selection ? issues.filter((i) => i.at && i.at.kind === selection.kind && i.at.index === selection.index) : []
  const row = selection ? (study[selection.kind] as unknown[])[selection.index] : null

  if (!selection || !row) {
    return <Overview study={study} issues={issues} onSelect={onSelect} onExample={onExample} onImport={onImport} busy={busy} />
  }

  const { kind, index } = selection
  function patch<K extends Kind>(k: K, value: Partial<Study[K][number]>) {
    set({ [k]: (study[k] as object[]).map((r, j) => (j === index ? { ...r, ...value } : r)) } as Partial<Study>)
  }
  const remove = async () => {
    if (kind === "buses") {
      const id = study.buses[index].id
      const attached =
        study.generators.filter((g) => g.bus === id).length +
        study.loads.filter((l) => l.bus === id).length +
        study.storage.filter((s) => s.bus === id).length +
        study.lines.filter((l) => l.bus0 === id || l.bus1 === id).length
      if (attached) {
        const answer = await ask(`Remove bus ${id}?`, `${attached} component${attached > 1 ? "s" : ""} name it and will be left without a bus.`, [
          { label: "Cancel", value: "cancel" },
          { label: "Remove", value: "remove", danger: true, primary: true },
        ])
        if (answer !== "remove") return
      }
    }
    set({ [kind]: (study[kind] as object[]).filter((_, j) => j !== index) } as Partial<Study>)
    onSelect(null)
  }
  const faults = !!mine.length && (
    <div className="border-b border-line/25 bg-warning/[0.06] px-4 py-2.5">
      <Issues issues={mine} />
    </div>
  )

  if (kind === "buses") {
    const b = study.buses[index]
    const attached = [
      ...study.generators.filter((g) => g.bus === b.id).map((g) => g.id),
      ...study.loads.filter((l) => l.bus === b.id).map((l) => l.id),
      ...study.storage.filter((s) => s.bus === b.id).map((s) => s.id),
      ...study.lines.filter((l) => l.bus0 === b.id || l.bus1 === b.id).map((l) => l.id),
    ]
    const rename = (id: string) => {
      const old = b.id
      const swap = (v: string) => (v === old ? id : v)
      set({
        buses: study.buses.map((r, j) => (j === index ? { ...r, id } : r)),
        generators: study.generators.map((g) => ({ ...g, bus: swap(g.bus) })),
        loads: study.loads.map((l) => ({ ...l, bus: swap(l.bus) })),
        storage: study.storage.map((s) => ({ ...s, bus: swap(s.bus) })),
        lines: study.lines.map((l) => ({ ...l, bus0: swap(l.bus0), bus1: swap(l.bus1) })),
      })
    }
    return (
      <>
        <Head kind="Bus" name={b.id} sub={attached.length ? `Connects ${attached.join(", ")}` : "Nothing connects to it yet"} onRemove={remove} busy={busy} />
        {faults}
        <Section title="Bus">
          <Row label="ID">
            <TextInput label="Bus ID" disabled={busy} value={b.id} onChange={rename} />
          </Row>
          <Row label="Nominal voltage" hint="Both ends of a line must share it: the model has no transformers.">
            <NumberInput label="Nominal voltage" disabled={busy} unit="kV" value={b.v_nom_kv} onChange={(v) => patch("buses", { v_nom_kv: v ?? 0 })} />
          </Row>
        </Section>
      </>
    )
  }

  if (kind === "generators") {
    const g = study.generators[index]
    return (
      <>
        <Head kind="Generator" name={g.id} sub={`At bus ${g.bus || "none"} · ${g.carrier}`} onRemove={remove} busy={busy} />
        {faults}
        <Section title="Connection">
          <Row label="ID">
            <TextInput label="Generator ID" disabled={busy} value={g.id} onChange={(id) => patch("generators", { id })} />
          </Row>
          <Row label="Bus">
            <SelectInput label="Bus" disabled={busy} value={g.bus} options={buses} placeholder="Choose a bus" onChange={(bus) => patch("generators", { bus })} />
          </Row>
          <Row label="Technology" hint="Free text. Solar, wind and gas are recognised and keep their colour on every chart.">
            <TextInput label="Technology" disabled={busy} value={g.carrier} onChange={(carrier) => patch("generators", { carrier })} />
          </Row>
        </Section>
        <Section title="Capacity">
          <Row label="Existing">
            <NumberInput label="Existing capacity" disabled={busy} unit="MW" value={g.existing_mw} onChange={(v) => patch("generators", { existing_mw: v ?? 0 })} />
          </Row>
          <Row label="Expandable" hint="Expansion studies may add capacity up to the upper bound, at the capacity cost.">
            <Toggle label="Expandable" disabled={busy} checked={g.expandable} onChange={(expandable) => patch("generators", { expandable })} />
          </Row>
          <Row label="Upper bound">
            <NumberInput label="Upper bound" disabled={busy} unit="MW" value={g.max_mw} onChange={(v) => patch("generators", { max_mw: v ?? 0 })} />
          </Row>
        </Section>
        <Section title="Costs and emissions">
          <Row label="Capacity cost" hint="Annualized investment plus fixed cost per MW added, per year. Not overnight CAPEX.">
            <NumberInput label="Capacity cost" disabled={busy} unit={`${cur}/MW·yr`} value={g.annualized_cost_per_mw_year} onChange={(v) => patch("generators", { annualized_cost_per_mw_year: v ?? 0 })} />
          </Row>
          <Row label="Marginal cost">
            <NumberInput label="Marginal cost" disabled={busy} unit={`${cur}/MWh`} value={g.marginal_cost_per_mwh} onChange={(v) => patch("generators", { marginal_cost_per_mwh: v ?? 0 })} />
          </Row>
          <Row label="Direct CO₂" hint="Tonnes per MWh of electrical output, at the stack. No lifecycle emissions.">
            <NumberInput label="Direct CO₂" disabled={busy} unit="t/MWh" value={g.co2_tonnes_per_mwh} onChange={(v) => patch("generators", { co2_tonnes_per_mwh: v ?? 0 })} />
          </Row>
        </Section>
        <div className="px-4 py-3.5">
          <ProfileEditor
            key={`generators:${index}:${study.snapshots.length}`}
            draftKey={`generators:${index}`}
            title="Availability"
            unit="per unit"
            values={g.availability}
            times={times}
            maximum={1}
            color={carrierColor(g.carrier)}
            disabled={busy}
            onChange={(availability) => patch("generators", { availability })}
          />
        </div>
      </>
    )
  }

  if (kind === "loads") {
    const l = study.loads[index]
    return (
      <>
        <Head kind="Load" name={l.id} sub={`At bus ${l.bus || "none"}`} onRemove={remove} busy={busy} />
        {faults}
        <Section title="Connection">
          <Row label="ID">
            <TextInput label="Load ID" disabled={busy} value={l.id} onChange={(id) => patch("loads", { id })} />
          </Row>
          <Row label="Bus">
            <SelectInput label="Bus" disabled={busy} value={l.bus} options={buses} placeholder="Choose a bus" onChange={(bus) => patch("loads", { bus })} />
          </Row>
        </Section>
        <div className="px-4 py-3.5">
          <ProfileEditor
            key={`loads:${index}:${study.snapshots.length}`}
            draftKey={`loads:${index}`}
            title="Demand"
            unit="MW"
            values={l.p_mw}
            times={times}
            color="#bdbdbd"
            disabled={busy}
            onChange={(p_mw) => patch("loads", { p_mw })}
          />
          <p className="mt-2 text-body text-muted-foreground">Demand is always served: the model adds no load shedding.</p>
        </div>
      </>
    )
  }

  if (kind === "lines") {
    const l = study.lines[index]
    return (
      <>
        <Head kind="Line" name={l.id} sub={`From ${l.bus0 || "?"} to ${l.bus1 || "?"}`} onRemove={remove} busy={busy} />
        {faults}
        <Section title="Connection">
          <Row label="ID">
            <TextInput label="Line ID" disabled={busy} value={l.id} onChange={(id) => patch("lines", { id })} />
          </Row>
          <Row label="From bus">
            <SelectInput label="From bus" disabled={busy} value={l.bus0} options={buses} placeholder="Choose a bus" onChange={(bus0) => patch("lines", { bus0 })} />
          </Row>
          <Row label="To bus">
            <SelectInput label="To bus" disabled={busy} value={l.bus1} options={buses} placeholder="Choose a bus" onChange={(bus1) => patch("lines", { bus1 })} />
          </Row>
        </Section>
        <Section title="Rating">
          <Row label="Existing" hint="Applied as a limit on active power in the lossless linear model.">
            <NumberInput label="Existing rating" disabled={busy} unit="MVA" value={l.existing_mva} onChange={(v) => patch("lines", { existing_mva: v ?? 0 })} />
          </Row>
          <Row label="Reinforce" hint="Expansion may raise the thermal rating; the reactance and the topology stay as they are.">
            <Toggle label="Reinforce" disabled={busy} checked={l.expandable} onChange={(expandable) => patch("lines", { expandable })} />
          </Row>
          <Row label="Upper bound">
            <NumberInput label="Upper bound" disabled={busy} unit="MVA" value={l.max_mva} onChange={(v) => patch("lines", { max_mva: v ?? 0 })} />
          </Row>
        </Section>
        <Section title="Electrical and cost">
          <Row label="Reactance">
            <NumberInput label="Reactance" disabled={busy} unit="Ω" value={l.x_ohm} onChange={(v) => patch("lines", { x_ohm: v ?? 0 })} />
          </Row>
          <Row label="Capacity cost" hint="Annualized cost per MVA of rating added, per year.">
            <NumberInput label="Capacity cost" disabled={busy} unit={`${cur}/MVA·yr`} value={l.annualized_cost_per_mva_year} onChange={(v) => patch("lines", { annualized_cost_per_mva_year: v ?? 0 })} />
          </Row>
        </Section>
      </>
    )
  }

  const s = study.storage[index]
  return (
    <>
      <Head kind="Storage" name={s.id} sub={`At bus ${s.bus || "none"}`} onRemove={remove} busy={busy} />
      {faults}
      <Section title="Connection">
        <Row label="ID">
          <TextInput label="Storage ID" disabled={busy} value={s.id} onChange={(id) => patch("storage", { id })} />
        </Row>
        <Row label="Bus">
          <SelectInput label="Bus" disabled={busy} value={s.bus} options={buses} placeholder="Choose a bus" onChange={(bus) => patch("storage", { bus })} />
        </Row>
      </Section>
      <Section title="Power" aside={<span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: STORAGE_COLOR }} />}>
        <Row label="Existing">
          <NumberInput label="Existing power" disabled={busy} unit="MW" value={s.existing_mw} onChange={(v) => patch("storage", { existing_mw: v ?? 0 })} />
        </Row>
        <Row label="Expandable">
          <Toggle label="Expandable" disabled={busy} checked={s.expandable} onChange={(expandable) => patch("storage", { expandable })} />
        </Row>
        <Row label="Upper bound">
          <NumberInput label="Upper bound" disabled={busy} unit="MW" value={s.max_mw} onChange={(v) => patch("storage", { max_mw: v ?? 0 })} />
        </Row>
      </Section>
      <Section title="Energy">
        <Row label="Hours at full power" hint="Energy capacity is this many hours of the optimized power.">
          <NumberInput label="Hours at full power" disabled={busy} unit="h" value={s.max_hours} onChange={(v) => patch("storage", { max_hours: v ?? 0 })} />
        </Row>
        <Row label="Charge efficiency">
          <NumberInput label="Charge efficiency" disabled={busy} unit="0 to 1" value={s.efficiency_store} onChange={(v) => patch("storage", { efficiency_store: v ?? 0 })} />
        </Row>
        <Row label="Discharge efficiency">
          <NumberInput label="Discharge efficiency" disabled={busy} unit="0 to 1" value={s.efficiency_dispatch} onChange={(v) => patch("storage", { efficiency_dispatch: v ?? 0 })} />
        </Row>
      </Section>
      <Section title="Costs">
        <Row label="Capacity cost" hint="Annualized cost per MW added, per year.">
          <NumberInput label="Capacity cost" disabled={busy} unit={`${cur}/MW·yr`} value={s.annualized_cost_per_mw_year} onChange={(v) => patch("storage", { annualized_cost_per_mw_year: v ?? 0 })} />
        </Row>
        <Row label="Marginal cost">
          <NumberInput label="Marginal cost" disabled={busy} unit={`${cur}/MWh out`} value={s.marginal_cost_per_mwh} onChange={(v) => patch("storage", { marginal_cost_per_mwh: v ?? 0 })} />
        </Row>
      </Section>
    </>
  )
}


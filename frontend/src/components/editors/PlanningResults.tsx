import { useMemo, useState, type ReactNode } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line as ChartLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { PlanningResult } from "../../lib/planning"
import { btnGhostDense } from "../ui/buttons"
import { Metric, number, tdStyle, thStyle } from "./PlanningUI"

export function ResultTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-meta">
        <thead className="sticky top-0 z-10" style={{ background: "var(--s-panel-head)" }}>
          <tr>
            {headers.map((h, i) => (
              <th className={`${thStyle} ${i ? "text-right" : ""}`} key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-hover/50">
              {r.map((v, j) => (
                <td key={j} className={`${tdStyle} whitespace-nowrap ${j ? "telemetry text-right" : ""}`}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PlanningResults({ result: r }: { result: PlanningResult }) {
  const [page, setPage] = useState(0)
  const currency = r.study.currency
  const colors = ["#80bfff", "#e8c66a", "#c49bff", "#e9977e", "#69c9c3", "#b4cd7a", "#d792b1", "#b9b9cf"]
  const chart = useMemo(() => {
    const totals = new Map<string, number>()
    for (const g of r.generators) totals.set(g.carrier, (totals.get(g.carrier) ?? 0) + g.generation_mwh)
    const ordered = [...totals].sort((a, b) => b[1] - a[1]).map(([carrier]) => carrier)
    const carriers = ordered.length > 8 ? [...ordered.slice(0, 7), "Other technologies"] : ordered
    const rows = r.timeseries.map((t) => {
      const row: Record<string, string | number> = {
        time: t.time,
        demand_mw: t.demand_mw,
        charge_mw: t.charge_mw,
        discharge_mw: t.discharge_mw,
      }
      carriers.forEach((_, i) => {
        row[`s${i}`] = 0
      })
      for (const g of r.generators) {
        const index = carriers.indexOf(g.carrier)
        const key = `s${index < 0 ? carriers.length - 1 : index}`
        row[key] = Number(row[key] ?? 0) + (t.generation_by_unit[g.id] ?? 0)
      }
      return row
    })
    return { carriers, rows }
  }, [r])
  return (
    <>
      <p className="text-meta text-muted-foreground">
        <span className="text-accent">{r.engine.termination}</span> ·{" "}
        {new Date(r.created_at).toLocaleString()} · {number(r.summary.hours)} h
      </p>
      <div className="grid grid-cols-2 gap-x-6 @xl:grid-cols-3">
        <Metric label={`Modelled cost · ${currency}`}>{number(r.summary.objective)}</Metric>
        <Metric label={`Operating cost · ${currency}`}>{number(r.summary.operating_cost)}</Metric>
        <Metric label={`Added capacity cost · ${currency}`}>{number(r.summary.expansion_cost)}</Metric>
        <Metric label="Demand served · MWh">{number(r.summary.demand_mwh)}</Metric>
        <Metric label="Direct CO₂ · tonnes">{number(r.summary.co2_tonnes)}</Metric>
        <Metric label={`Cost / demand · ${currency}/MWh`}>{number(r.summary.cost_per_demand_mwh)}</Metric>
      </div>
      <section className="border-t border-line/30 pt-3">
        <h3 className="eyebrow mb-2 !text-foreground">Dispatch by technology · MW</h3>
        <div className="h-56 w-full @3xl:h-64">
          <ResponsiveContainer>
            <ComposedChart data={chart.rows}>
              <CartesianGrid vertical={false} stroke="var(--hairline)" />
              <XAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                dataKey="time"
                tickFormatter={(v) => String(v).slice(5, 16).replace("T", " ")}
                minTickGap={50}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={45}
              />
              <Tooltip
                labelFormatter={(v) => String(v)}
                contentStyle={{
                  background: "var(--s-float)",
                  border: "1px solid var(--hairline)",
                  borderRadius: 3,
                  fontSize: 11,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              {chart.carriers.map((carrier, i) => (
                <Area
                  key={carrier}
                  dataKey={`s${i}`}
                  name={carrier}
                  stackId="generation"
                  stroke={colors[i % colors.length]}
                  fill={colors[i % colors.length]}
                  fillOpacity={0.35}
                  isAnimationActive={false}
                />
              ))}
              <Area
                dataKey="discharge_mw"
                name="Storage discharge"
                stackId="generation"
                stroke="#7ed9a4"
                fill="#7ed9a4"
                fillOpacity={0.35}
                isAnimationActive={false}
              />
              <ChartLine
                dataKey="demand_mw"
                name="Demand"
                stroke="#f5e6a7"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <ChartLine
                dataKey="charge_mw"
                name="Storage charge"
                stroke="#e9a6f5"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="border-t border-line/30 pt-3">
        <h3 className="eyebrow mb-2 !text-foreground">Generation and capacity</h3>
        <ResultTable
          headers={[
            "Unit / technology",
            "Existing · MW",
            "Optimized · MW",
            "Added · MW",
            "Generation · MWh",
            "Unused availability · MWh",
            "Capacity factor · %",
          ]}
          rows={r.generators.map((g) => [
            `${g.id} / ${g.carrier}`,
            number(g.existing_mw),
            number(g.optimized_mw),
            number(g.added_mw),
            number(g.generation_mwh),
            number(g.unused_available_mwh),
            number(g.capacity_factor == null ? null : g.capacity_factor * 100),
          ])}
        />
        <p className="mt-2 text-meta text-muted-foreground">
          Unused availability is available output minus dispatch. For dispatchable units, it represents unused
          headroom rather than renewable curtailment.
        </p>
      </section>
      {!!r.lines.length && (
        <section className="border-t border-line/30 pt-3">
          <h3 className="eyebrow mb-2 !text-foreground">Transmission utilization</h3>
          <ResultTable
            headers={[
              "Line",
              "Existing · MVA",
              "Optimized · MVA",
              "Added · MVA",
              "Peak loading · %",
              "Hours at limit",
            ]}
            rows={r.lines.map((l) => [
              l.id,
              number(l.existing_mva),
              number(l.optimized_mva),
              number(l.added_mva),
              number(l.peak_loading_pct),
              number(l.hours_at_limit),
            ])}
          />
        </section>
      )}
      {!!r.storage.length && (
        <section className="border-t border-line/30 pt-3">
          <h3 className="eyebrow mb-2 !text-foreground">Storage balance</h3>
          <ResultTable
            headers={[
              "Unit",
              "Existing · MW",
              "Optimized · MW",
              "Added · MW",
              "Energy · MWh",
              "Charge · MWh",
              "Discharge · MWh",
              "Losses · MWh",
            ]}
            rows={r.storage.map((s) => [
              s.id,
              number(s.existing_mw),
              number(s.optimized_mw),
              number(s.added_mw),
              number(s.energy_capacity_mwh),
              number(s.charged_mwh),
              number(s.discharged_mwh),
              number(s.losses_mwh),
            ])}
          />
        </section>
      )}
      <section className="border-t border-line/30 pt-3">
        <h3 className="eyebrow mb-2 !text-foreground">Interval results</h3>
        <ResultTable
          headers={[
            "Interval start",
            "Duration · h",
            "Demand · MW",
            "Generation · MW",
            "Charge · MW",
            "Discharge · MW",
          ]}
          rows={r.timeseries
            .slice(page * 100, (page + 1) * 100)
            .map((t) => [
              t.time,
              number(t.duration_hours),
              number(t.demand_mw),
              number(t.generation_mw),
              number(t.charge_mw),
              number(t.discharge_mw),
            ])}
        />
        <div className="mt-2 flex items-center gap-2 text-meta">
          <button className={btnGhostDense} disabled={!page} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            {page + 1} / {Math.ceil(r.timeseries.length / 100)}
          </span>
          <button
            className={btnGhostDense}
            disabled={(page + 1) * 100 >= r.timeseries.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
        <p className="mt-2 text-meta text-muted-foreground">
          The exported report includes dispatch by generator, demand by bus, signed line flows, and storage
          charge, discharge and state of charge.
        </p>
      </section>
      <details className="border-t border-line/30 pt-2 text-meta text-muted-foreground">
        <summary className="cursor-pointer py-1 hover:text-foreground">Run details</summary>
        <p className="py-2">
          {r.engine.name} {r.engine.version} · {r.engine.solver} {r.engine.solver_version}
        </p>
        <ul className="list-disc space-y-2 pl-5 text-meta text-muted-foreground">
          {r.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <p className="mt-3 text-meta">
          Maximum nodal balance residual: {r.summary.max_nodal_balance_error_mw.toExponential(2)} MW.
        </p>
        <p className="mt-2 break-all font-mono text-meta text-muted-foreground">
          Input SHA-256: {r.study_sha256}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-meta text-muted-foreground">
          Sources: {r.study.provenance}
        </p>
      </details>
    </>
  )
}

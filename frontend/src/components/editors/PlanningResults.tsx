import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { PlanningResult } from "../../lib/planning"
import { DetailRow, IndicatorCard, IndicatorRow, ReadingPanel, ReadingSource, Segmented } from "../energy/primitives"
import { OTHER_COLOR, STORAGE_COLOR, carrierColors, clock, fixed, moment, whole } from "./PlanningUI"

/**
 * A run of the planning study, read the way every product's result is read:
 * a head, four indicators, one panel whose title states what it found, and
 * the run's provenance at the foot.
 *
 * EVERY FIGURE IS THE REPORT'S. Nothing is recomputed from the inputs except
 * shares and sums of what the report holds, and a number appears once.
 */

/** The width a chart has to draw in, followed as its panel resizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** A round step for about four ticks up to `v`. */
function niceStep(v: number, ticks = 4) {
  if (!(v > 0)) return 1
  const raw = v / ticks
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= raw)!
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`)
const pct = (v: number) => `${Math.round(v)} %`

/** Ticks every 1, 2, 3, 4, 6, 8 or 12 columns (hours, on an hourly study), about six across. */
function xTickIndexes(cols: number) {
  const every = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168, 336, 720].find((k) => k >= cols / 7) ?? Math.ceil(cols / 6)
  const out: number[] = []
  for (let i = 0; i < cols; i += every) out.push(i)
  return out
}

/** Up to this many columns; a longer horizon is drawn as the mean of each run of intervals. */
const MAX_COLUMNS = 168

type Series = { key: string; label: string; color: string; values: number[]; ink: string }

/** Generation by technology, the storage in and out, and demand, interval by interval. */
function useDispatch(r: PlanningResult) {
  return useMemo(() => {
    const totals = new Map<string, number>()
    for (const g of r.generators) totals.set(g.carrier, (totals.get(g.carrier) ?? 0) + g.generation_mwh)
    const ranked = [...totals].sort((a, b) => b[1] - a[1]).map(([c]) => c)
    const colors = carrierColors(ranked)
    const shown = ranked.filter((c) => colors.has(c))
    const folded = ranked.filter((c) => !colors.has(c))
    const groups: Series[] = shown.map((c) => ({
      key: c,
      label: c.charAt(0).toUpperCase() + c.slice(1),
      color: colors.get(c)!,
      ink: colors.get(c) === "#c98500" ? "#0b0b0b" : "#ffffff",
      values: [],
    }))
    if (folded.length) groups.push({ key: "\u0000other", label: "Other technologies", color: OTHER_COLOR, ink: "#0b0b0b", values: [] })
    const carrierOf = new Map(r.generators.map((g) => [g.id, g.carrier]))
    for (const t of r.timeseries) {
      const row = new Map<string, number>()
      for (const [id, mw] of Object.entries(t.generation_by_unit)) {
        const c = carrierOf.get(id) ?? ""
        const key = colors.has(c) ? c : "\u0000other"
        row.set(key, (row.get(key) ?? 0) + mw)
      }
      for (const g of groups) g.values.push(row.get(g.key) ?? 0)
    }
    const total = ranked.reduce((s, c) => s + (totals.get(c) ?? 0), 0)
    return {
      groups,
      shares: ranked.map((c) => ({ label: c, share: total > 0 ? ((totals.get(c) ?? 0) / total) * 100 : 0 })),
      discharge: r.timeseries.map((t) => t.discharge_mw),
      charge: r.timeseries.map((t) => t.charge_mw),
      demand: r.timeseries.map((t) => t.demand_mw),
      times: r.timeseries.map((t) => t.time),
    }
  }, [r])
}

function bin(values: number[], per: number) {
  if (per <= 1) return values
  const out: number[] = []
  for (let i = 0; i < values.length; i += per) {
    const run = values.slice(i, i + per)
    out.push(run.reduce((a, b) => a + b, 0) / run.length)
  }
  return out
}

/** An interval as its start and end: "11:00 to 12:00", with the day on a long horizon. */
function span(start: string, hours: number, long: boolean) {
  const end = new Date(new Date(start).getTime() + hours * 3600_000).toISOString()
  return long ? `${moment(start)} to ${clock(end)} UTC` : `${clock(start)} to ${clock(end)} UTC`
}

/** Hour of day for a short horizon, the day for a long one. */
function tickLabel(iso: string, long: boolean) {
  const d = new Date(iso)
  return long ? `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}` : clock(iso)
}

function DispatchChart({ r }: { r: PlanningResult }) {
  const d = useDispatch(r)
  const [box, width] = useWidth()
  const [hover, setHover] = useState(-1)
  const n = d.times.length
  const per = Math.ceil(n / MAX_COLUMNS)
  const cols = Math.ceil(n / per)
  const groups = d.groups.map((g) => ({ ...g, values: bin(g.values, per) }))
  const discharge = bin(d.discharge, per)
  const charge = bin(d.charge, per)
  const demand = bin(d.demand, per)
  const hasStorage = r.storage.length > 0

  const H = 300
  const L = 44
  const R = 12
  const T = 10
  const B = 24
  const plotW = Math.max(100, width - L - R)
  const cw = plotW / cols
  const gap = cw > 8 ? 2 : cw > 4 ? 1 : 0
  const posMax = Math.max(1, ...Array.from({ length: cols }, (_, i) => groups.reduce((s, g) => s + g.values[i], 0) + discharge[i]), ...demand)
  const negMax = hasStorage ? Math.max(0, ...charge) : 0
  const step = niceStep(posMax, 5)
  const top = Math.ceil(posMax / step) * step
  // Below zero only as deep as the charging needs: half a step when that is enough.
  const bottom = negMax > 0 ? (negMax <= step / 2 ? step / 2 : Math.ceil(negMax / step) * step) : 0
  const y = (v: number) => T + ((top - v) / (top + bottom)) * (H - T - B)
  const ticks: number[] = []
  for (let v = top; v >= -bottom - 1e-9; v -= step) ticks.push(Number(v.toFixed(6)))
  if (bottom > 0 && !ticks.includes(-bottom)) ticks.push(-bottom)
  const long = new Date(d.times[n - 1]).getTime() - new Date(d.times[0]).getTime() > 36 * 3600_000
  const xTicks = xTickIndexes(cols)

  // Direct labels: each series named once, inside its tallest segment, where there is room.
  const labels: { x: number; y: number; text: string; ink: string }[] = []
  groups.forEach((g, gi) => {
    let best = -1
    let h = 0
    g.values.forEach((v, i) => {
      if (v > h) {
        h = v
        best = i
      }
    })
    if (best < 0) return
    const base = groups.slice(0, gi).reduce((s, o) => s + o.values[best], 0)
    if (y(base) - y(base + h) >= 18) labels.push({ x: L + (best + 0.5) * cw, y: y(base + h) + Math.min(16, (y(base) - y(base + h)) / 2), text: g.label, ink: g.ink })
  })
  if (hasStorage) {
    const di = discharge.indexOf(Math.max(...discharge))
    const base = groups.reduce((s, g) => s + g.values[di], 0)
    if (di >= 0 && y(base) - y(base + discharge[di]) >= 18)
      labels.push({ x: L + (di + 0.5) * cw, y: y(base + discharge[di]) + Math.min(16, (y(base) - y(base + discharge[di])) / 2), text: "Storage", ink: "#ffffff" })
    const ci = charge.indexOf(Math.max(...charge))
    if (ci >= 0 && y(-charge[ci]) - y(0) >= 18) labels.push({ x: L + (ci + 0.5) * cw, y: (y(0) + y(-charge[ci])) / 2, text: "Charging", ink: "#ffffff" })
  }
  const demandPath = demand.map((v, i) => `${i ? "L" : "M"}${L + i * cw},${y(v)} L${L + (i + 1) * cw},${y(v)}`).join(" ")
  const hi = hover >= 0 ? hover * per : -1
  const tip =
    hover >= 0
      ? {
          left: L + (hover + 0.5) * cw,
          title: per === 1 ? span(d.times[hi], r.timeseries[hi].duration_hours, long) : `${per} intervals from ${moment(d.times[hi])}`,
          rows: [
            { label: "Demand", value: demand[hover], color: "var(--s-text)" },
            ...groups.map((g) => ({ label: g.label, value: g.values[hover], color: g.color })),
            ...(hasStorage ? [{ label: charge[hover] > discharge[hover] ? "Storage, charging" : "Storage", value: discharge[hover] - charge[hover], color: STORAGE_COLOR }] : []),
          ],
          lines:
            per === 1
              ? r.lines.slice(0, 3).map((l) => ({ label: l.id, value: r.timeseries[hi].flow_by_line[l.id] ?? 0, rating: l.optimized_mva }))
              : [],
        }
      : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--s-text-muted)]">
        {groups.map((g) => (
          <span key={g.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: g.color }} />
            {g.label}
          </span>
        ))}
        {hasStorage && (
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: STORAGE_COLOR }} />
            Storage, discharging above zero and charging below
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ background: "var(--s-text)" }} />
          Demand
        </span>
      </div>
      <div ref={box} className="relative" onMouseLeave={() => setHover(-1)}>
        <svg width={width} height={H} className="reading-chart block" role="img" aria-label={`Dispatch by technology over ${n} intervals, MW${hasStorage ? ", with storage charging below zero" : ""}, and demand as a line`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={L + plotW} y1={y(v)} y2={y(v)} stroke={v === 0 ? "rgb(var(--p-line-strong) / 0.6)" : "var(--s-line-soft)"} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end">
                {v < 0 ? `−${fixed(-v, step % 1 ? 1 : 0)}` : fixed(v, step % 1 ? 1 : 0)}
              </text>
            </g>
          ))}
          {hover >= 0 && <rect x={L + hover * cw} y={T} width={cw} height={H - T - B} fill="rgb(255 255 255 / 0.05)" />}
          {Array.from({ length: cols }, (_, i) => {
            let base = 0
            const x = L + i * cw + gap / 2
            const w = Math.max(0.5, cw - gap)
            return (
              <g key={i}>
                {groups.map((g) => {
                  const v = g.values[i]
                  const rect = v > 0 ? <rect key={g.key} x={x} y={y(base + v)} width={w} height={y(base) - y(base + v)} fill={g.color} /> : null
                  base += v
                  return rect
                })}
                {hasStorage && discharge[i] > 0 && <rect x={x} y={y(base + discharge[i])} width={w} height={y(base) - y(base + discharge[i])} fill={STORAGE_COLOR} />}
                {hasStorage && charge[i] > 0 && <rect x={x} y={y(0)} width={w} height={y(-charge[i]) - y(0)} fill={STORAGE_COLOR} />}
              </g>
            )
          })}
          <path d={demandPath} fill="none" stroke="var(--s-card)" strokeWidth={5} strokeLinejoin="round" />
          <path d={demandPath} fill="none" stroke="var(--s-text)" strokeWidth={2} strokeLinejoin="round" />
          {labels.map((l) => (
            <text key={l.text} x={l.x} y={l.y + 4} textAnchor="middle" style={{ fill: l.ink, fontWeight: 500 }}>
              {l.text}
            </text>
          ))}
          <text x={L + plotW} y={y(demand[cols - 1]) - 8} textAnchor="end" className="strong">
            Demand
          </text>
          {xTicks.map((i) => (
            <text key={i} x={L + (i + 0.5) * cw} y={H - 6} textAnchor="middle">
              {tickLabel(d.times[i * per], long)}
            </text>
          ))}
          {Array.from({ length: cols }, (_, i) => (
            <rect key={i} x={L + i * cw} y={T} width={cw} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[200px] rounded-[8px] border border-[var(--s-line)] px-2.5 py-2 text-[12px] shadow-lg"
            style={{
              background: "rgb(var(--p-surface-raised))",
              left: Math.min(Math.max(tip.left, 110), width - 110),
              transform: "translateX(-50%)",
            }}
          >
            <p className="mb-1.5 font-medium text-[var(--s-text)]">{tip.title}</p>
            {tip.rows.map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: row.color }} />
                <span className="flex-1 text-[var(--s-text-muted)]">{row.label}</span>
                <span className="tabular-nums">{fixed(row.value, 1)} MW</span>
              </div>
            ))}
            {tip.lines.map((l) => (
              <div key={l.label} className="mt-0.5 flex items-center gap-2">
                <span className="size-2 shrink-0" />
                <span className="flex-1 text-[var(--s-text-muted)]">{l.label} flow</span>
                <span className="tabular-nums">
                  {fixed(l.value, 1)} MW{l.rating > 0 ? ` · ${pct((Math.abs(l.value) / l.rating) * 100)}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="pl-[44px] text-[11.5px] text-[var(--s-text-faint)]">
        {per === 1 ? "Mean power over each interval, MW." : `Mean power over each run of ${per} intervals, MW.`} Point at an interval for every
        technology{r.lines.length ? " and the line flows" : ""}.
      </p>
    </div>
  )
}

const PAGE = 200

function DispatchTable({ r }: { r: PlanningResult }) {
  const d = useDispatch(r)
  const [page, setPage] = useState(0)
  const pages = Math.ceil(d.times.length / PAGE)
  const lines = r.lines.slice(0, 4)
  const thBase = "sticky top-0 whitespace-nowrap bg-[var(--s-card)] px-3 py-2 font-medium text-[var(--s-text-muted)]"
  const th = `${thBase} text-right`
  const tdBase = "whitespace-nowrap px-3 py-1.5 tabular-nums"
  const td = `${tdBase} text-right`
  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[360px] overflow-auto rounded-[8px] border border-[var(--s-line-soft)]">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className={`${thBase} text-left`}>Interval start, UTC</th>
              <th className={th}>Demand, MW</th>
              {d.groups.map((g) => (
                <th key={g.key} className={th}>
                  {g.label}, MW
                </th>
              ))}
              {r.storage.length > 0 && <th className={th}>Storage, MW</th>}
              {lines.map((l) => (
                <th key={l.id} className={th}>
                  {l.id}, MW
                </th>
              ))}
              {r.storage.length > 0 && <th className={th}>Stored, MWh</th>}
            </tr>
          </thead>
          <tbody>
            {r.timeseries.slice(page * PAGE, (page + 1) * PAGE).map((t, k) => {
              const i = page * PAGE + k
              return (
                <tr key={t.time} className="border-t border-[var(--s-line-soft)]">
                  <td className={`${tdBase} text-left`}>{moment(t.time)}</td>
                  <td className={td}>{fixed(t.demand_mw, 1)}</td>
                  {d.groups.map((g) => (
                    <td key={g.key} className={td}>
                      {fixed(g.values[i], 1)}
                    </td>
                  ))}
                  {r.storage.length > 0 && <td className={td}>{fixed(t.discharge_mw - t.charge_mw, 1)}</td>}
                  {lines.map((l) => (
                    <td key={l.id} className={td}>
                      {fixed(t.flow_by_line[l.id] ?? 0, 1)}
                    </td>
                  ))}
                  {r.storage.length > 0 && <td className={td}>{fixed(Object.values(t.state_of_charge_mwh).reduce((a, b) => a + b, 0), 1)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-[var(--s-text-faint)]">
        Storage is positive while discharging. A line's flow is positive from its first bus to its second. The exported report has every unit
        and every line.
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-2 text-[12px]">
          <button type="button" className="rounded-[6px] border border-[var(--s-line)] px-2 py-0.5 disabled:opacity-40" disabled={!page} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="tabular-nums text-[var(--s-text-muted)]">
            {page + 1} of {pages}
          </span>
          <button type="button" className="rounded-[6px] border border-[var(--s-line)] px-2 py-0.5 disabled:opacity-40" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}

type CapRow = { name: string; kind: string; existing: number; optimized: number; added: number; bound: number | null; note: string }

/** Existing and added capacity of every asset on one scale, with each upper bound marked. */
function CapacityBars({ rows, unitLabel }: { rows: CapRow[]; unitLabel: string }) {
  const top = (() => {
    const m = Math.max(1, ...rows.map((r) => Math.max(r.optimized, r.bound ?? 0)))
    const s = niceStep(m)
    return Math.ceil(m / s) * s
  })()
  const at = (v: number) => `${(v / top) * 100}%`
  const step = niceStep(top)
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--s-text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-[#6f6f6f]" />
          Existing
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-[#d9d9d9]" />
          Added by the optimizer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 border-l-2 border-dashed border-[var(--s-text-muted)]" />
          Upper bound
        </span>
      </div>
      {rows.map((row) => (
        <div key={row.name + row.kind} className="grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_minmax(6rem,10rem)] items-center gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-[11.5px] text-[var(--s-text-faint)]">{row.kind}</p>
          </div>
          <div className="relative h-6" role="img" aria-label={`${row.name}: ${fixed(row.existing, 1)} existing, ${fixed(row.added, 1)} added${row.bound != null ? `, upper bound ${fixed(row.bound, 1)}` : ""}`}>
            <div className="absolute inset-y-0 left-0 rounded-l-[3px] bg-[#6f6f6f]" style={{ width: at(row.existing) }} />
            {row.added > 0 && <div className="absolute inset-y-0 rounded-r-[3px] bg-[#d9d9d9]" style={{ left: at(row.existing), width: at(row.added), boxShadow: "-2px 0 0 var(--s-card)" }} />}
            {row.bound != null && <div aria-hidden className="absolute -inset-y-1 border-l-2 border-dashed border-[var(--s-text-muted)]" style={{ left: at(row.bound) }} />}
            {/* After the bound marker when it sits just past the bar, so the dashes never cross the figure. */}
            <span
              className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-2.5 text-[12.5px] tabular-nums"
              style={{ left: at(row.bound != null && row.bound > row.optimized && (row.bound - row.optimized) / top < 0.2 ? row.bound : Math.max(row.optimized, 0)) }}
            >
              {fixed(row.optimized, 1)}
              {row.added > 1e-6 ? ` (+${fixed(row.added, 1)})` : ""}
              {row.bound != null && row.added > 1e-6 && row.optimized >= row.bound - 1e-6 ? ", at bound" : ""}
            </span>
          </div>
          <p className="text-right text-[12px] text-[var(--s-text-muted)]">{row.note}</p>
        </div>
      ))}
      <div className="grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_minmax(6rem,10rem)] gap-3">
        <span />
        <div className="relative h-4 border-t border-[rgb(var(--p-line-strong)/0.5)] text-[11px] tabular-nums text-[var(--s-text-faint)]">
          {ticks.map((v, i) => (
            <span key={v} className="absolute top-1 whitespace-nowrap" style={{ left: at(v), transform: i === 0 ? "none" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>
              {fixed(v, step % 1 ? 1 : 0)}
              {i === ticks.length - 1 ? ` ${unitLabel}` : ""}
            </span>
          ))}
        </div>
        <span />
      </div>
    </div>
  )
}

function StorageChart({ r }: { r: PlanningResult }) {
  const [box, width] = useWidth()
  const n = r.timeseries.length
  const per = Math.ceil(n / MAX_COLUMNS)
  const stored = bin(r.timeseries.map((t) => Object.values(t.state_of_charge_mwh).reduce((a, b) => a + b, 0)), per)
  const cols = stored.length
  const H = 220
  const L = 44
  const R = 12
  const T = 10
  const B = 24
  const plotW = Math.max(100, width - L - R)
  const cw = plotW / cols
  const gap = cw > 8 ? 2 : cw > 4 ? 1 : 0
  const cap = r.storage.reduce((s, u) => s + u.energy_capacity_mwh, 0)
  const step = niceStep(Math.max(cap, ...stored, 1))
  const top = Math.ceil(Math.max(cap, ...stored, 1) / step) * step
  const y = (v: number) => T + ((top - v) / top) * (H - T - B)
  const ticks: number[] = []
  for (let v = top; v >= -1e-9; v -= step) ticks.push(Number(v.toFixed(6)))
  const long = new Date(r.timeseries[n - 1].time).getTime() - new Date(r.timeseries[0].time).getTime() > 36 * 3600_000
  const xTicks = xTickIndexes(cols)
  return (
    <div ref={box}>
      <svg width={width} height={H} className="reading-chart block" role="img" aria-label="Energy held in storage at the end of each interval, MWh">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={L + plotW} y1={y(v)} y2={y(v)} stroke={v === 0 ? "rgb(var(--p-line-strong) / 0.6)" : "var(--s-line-soft)"} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end">
              {fixed(v, step % 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        {cap > 0 && (
          <>
            <line x1={L} x2={L + plotW} y1={y(cap)} y2={y(cap)} stroke="var(--s-text-muted)" strokeDasharray="4 3" />
            <text x={L + plotW} y={y(cap) - 6} textAnchor="end">
              Energy capacity
            </text>
          </>
        )}
        {stored.map((v, i) => (
          <rect key={i} x={L + i * cw + gap / 2} y={y(v)} width={Math.max(0.5, cw - gap)} height={y(0) - y(v)} fill={STORAGE_COLOR}>
            <title>{`${per === 1 ? `At ${moment(new Date(new Date(r.timeseries[i].time).getTime() + r.timeseries[i].duration_hours * 3600_000).toISOString())}` : `${per} intervals from ${moment(r.timeseries[i * per].time)}`} · ${fixed(v, 1)} MWh`}</title>
          </rect>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={L + (i + 0.5) * cw} y={H - 6} textAnchor="middle">
            {tickLabel(r.timeseries[i * per].time, long)}
          </text>
        ))}
      </svg>
    </div>
  )
}

type Tab = "dispatch" | "capacity" | "lines" | "storage"

export function PlanningResults({ result: r, head }: { result: PlanningResult; head: ReactNode }) {
  const [tab, setTab] = useState<Tab>("dispatch")
  const [form, setForm] = useState<"chart" | "table">("chart")
  const cur = r.study.currency
  const s = r.summary
  const d = useDispatch(r)
  const expansion = r.study.mode === "expansion"
  const tabs: { value: Tab; label: string }[] = [
    { value: "dispatch", label: "Dispatch" },
    ...(expansion ? [{ value: "capacity" as Tab, label: "Capacity" }] : []),
    ...(r.lines.length ? [{ value: "lines" as Tab, label: "Lines" }] : []),
    ...(r.storage.length ? [{ value: "storage" as Tab, label: "Storage" }] : []),
  ]
  const active = tabs.some((t) => t.value === tab) ? tab : "dispatch"

  // The indicators.
  const emitters = r.generators.filter((g) => g.co2_tonnes > 1e-9).sort((a, b) => b.co2_tonnes - a.co2_tonnes)
  const co2Line = !emitters.length
    ? "No generator emits."
    : emitters.length === 1
      ? `All from ${emitters[0].id}.`
      : `${emitters[0].id} emits ${pct((emitters[0].co2_tonnes / s.co2_tonnes) * 100)} of it.`
  const binding = r.lines.filter((l) => l.hours_at_limit > 0)
  const worst = [...r.lines].sort((a, b) => b.hours_at_limit - a.hours_at_limit)[0]
  const peakDemand = Math.max(...d.demand)

  // The capacity rows, from the run's own inputs for the bounds.
  const byId = <T extends { id: string }>(rows: T[], id: string) => rows.find((x) => x.id === id)
  const capRows: CapRow[] = [
    ...r.generators.map((g) => {
      const input = byId(r.study.generators, g.id)
      return {
        name: g.id,
        kind: `Generator, ${g.carrier}, MW`,
        existing: g.existing_mw,
        optimized: g.optimized_mw,
        added: g.added_mw,
        bound: input?.expandable ? input.max_mw : null,
        note: input?.expandable ? (g.added_mw > 1e-6 && g.expansion_cost != null ? `${whole(g.expansion_cost)} ${cur} in ${whole(s.hours)} h` : "not grown") : "fixed",
      }
    }),
    ...r.storage.map((u) => {
      const input = byId(r.study.storage, u.id)
      return {
        name: u.id,
        kind: `Storage, MW`,
        existing: u.existing_mw,
        optimized: u.optimized_mw,
        added: u.added_mw,
        bound: input?.expandable ? input.max_mw : null,
        note: input?.expandable ? (u.added_mw > 1e-6 && u.expansion_cost != null ? `${whole(u.expansion_cost)} ${cur} in ${whole(s.hours)} h` : "not grown") : "fixed",
      }
    }),
    ...r.lines.map((l) => {
      const input = byId(r.study.lines, l.id)
      return {
        name: l.id,
        kind: "Line, MVA",
        existing: l.existing_mva,
        optimized: l.optimized_mva,
        added: l.added_mva,
        bound: input?.expandable ? input.max_mva : null,
        note: input?.expandable ? (l.added_mva > 1e-6 && l.expansion_cost != null ? `${whole(l.expansion_cost)} ${cur} in ${whole(s.hours)} h` : "not reinforced") : "fixed",
      }
    }),
  ].sort((a, b) => Number(b.bound != null) - Number(a.bound != null))
  const grown = capRows.filter((c) => c.added > 1e-6)
  const atBound = grown.filter((c) => c.bound != null && c.optimized >= c.bound - 1e-6)

  const storedMax = (() => {
    const totals = r.timeseries.map((t) => Object.values(t.state_of_charge_mwh).reduce((a, b) => a + b, 0))
    const max = Math.max(0, ...totals)
    return { max, at: r.timeseries[totals.indexOf(max)]?.time ?? "" }
  })()
  const energyCap = r.storage.reduce((a, u) => a + u.energy_capacity_mwh, 0)
  const charged = r.storage.reduce((a, u) => a + u.charged_mwh, 0)
  const discharged = r.storage.reduce((a, u) => a + u.discharged_mwh, 0)
  const lost = r.storage.reduce((a, u) => a + u.losses_mwh, 0)

  const shares = d.shares.filter((x) => x.share >= 0.5)
  const panels: Record<Tab, { title: string; sub: string }> = {
    dispatch: {
      title: shares.length
        ? `${shares[0].label.charAt(0).toUpperCase() + shares[0].label.slice(1)} supplies ${pct(shares[0].share)} of generation${shares[1] ? `, ${shares[1].label} ${pct(shares[1].share)}` : ""}`
        : "Nothing was generated",
      sub: `Dispatch by technology, interval by interval${r.storage.length ? "; charging storage is drawn below zero" : ""}.`,
    },
    capacity: {
      title: grown.length
        ? `The optimizer grew ${list(grown.map((g) => g.name))}${atBound.length ? `; ${list(atBound.map((g) => g.name))} stopped at ${atBound.length > 1 ? "their" : "its"} upper bound` : ""}`
        : "The optimizer added no capacity",
      sub: "Capacity before and after the optimization. One scale for MW and MVA: the model treats a line's rating as a limit on active power.",
    },
    lines: {
      title: binding.length ? `${list(binding.map((l) => l.id))} ${binding.length > 1 ? "reach their ratings" : "reaches its rating"}` : "No line reaches its rating",
      sub: "The highest flow on each line, as a share of its rating after the optimization.",
    },
    storage: {
      title:
        energyCap > 0 && storedMax.max >= energyCap - 1e-6
          ? `Storage is full by ${clock(storedMax.at)}`
          : `Stored energy peaks at ${fixed(storedMax.max, 1)} MWh at ${clock(storedMax.at)}`,
      sub: "Energy held at the end of each interval. The state of charge is cyclic: the horizon ends where it began.",
    },
  }

  const exp = s.max_nodal_balance_error_mw.toExponential(1).split("e")
  const imbalance = Number(exp[0]) === 0 ? "0 MW" : `${exp[0]} × 10${String(Number(exp[1])).replace("-", "⁻").replace(/\d/g, (c) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(c)])} MW`

  return (
    <>
      {head}
      <IndicatorRow>
        <IndicatorCard title="Horizon cost" sub={expansion ? "Operation and added capacity" : "Operation over the horizon"} value={whole(s.objective)} unit={cur}>
          {expansion ? `Operation ${whole(s.operating_cost)} · added capacity ${whole(s.expansion_cost)}.` : "Dispatch adds no capacity."}
        </IndicatorCard>
        <IndicatorCard title="Cost per MWh served" sub="Horizon cost over demand" value={fixed(s.cost_per_demand_mwh, 1)} unit={`${cur}/MWh`}>
          {`Over ${whole(s.demand_mwh)} MWh in ${whole(s.hours)} h. Not a project LCOE.`}
        </IndicatorCard>
        <IndicatorCard
          title="Direct CO₂"
          sub="Stack emissions over the horizon"
          value={s.co2_tonnes >= 10 ? whole(s.co2_tonnes) : fixed(s.co2_tonnes, 1)}
          unit="t"
          chip={r.study.co2_limit_tonnes == null ? "no cap" : `cap ${whole(r.study.co2_limit_tonnes)} t`}
        >
          {co2Line}
        </IndicatorCard>
        {r.lines.length ? (
          <IndicatorCard title="Hours at a line limit" sub="Binding thermal ratings" value={whole(worst.hours_at_limit)} unit="h" chip={worst.hours_at_limit > 0 ? worst.id : undefined}>
            {`${binding.length} of ${r.lines.length} ${r.lines.length === 1 ? "line reaches its" : "lines reach their"} rating.`}
          </IndicatorCard>
        ) : (
          <IndicatorCard title="Peak demand" sub="Highest interval" value={fixed(peakDemand, 1)} unit="MW">
            The study has no lines: every bus stands alone.
          </IndicatorCard>
        )}
      </IndicatorRow>

      <ReadingPanel
        title={panels[active].title}
        sub={panels[active].sub}
        controls={
          <>
            {tabs.length > 1 && <Segmented label="What to read" value={active} options={tabs} onChange={setTab} />}
            {active === "dispatch" && (
              <Segmented
                label="Form"
                value={form}
                options={[
                  { value: "chart", label: "Chart" },
                  { value: "table", label: "Table" },
                ]}
                onChange={setForm}
              />
            )}
          </>
        }
        note={
          r.warnings.length ? (
            <ul className="flex list-disc flex-col gap-1.5 pl-4">
              {r.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : undefined
        }
        details={
          <>
            <DetailRow label="Engine" value={`${r.engine.name} ${r.engine.version} · ${r.engine.solver} ${r.engine.solver_version}`} />
            <DetailRow label="Termination" value={r.engine.termination} />
            <DetailRow label="Largest bus imbalance" value={imbalance} />
            <DetailRow label="Run" value={moment(r.created_at)} />
            <DetailRow label="Input digest" value={`SHA-256 ${r.study_sha256.slice(0, 8)}…${r.study_sha256.slice(-6)}`} />
            <DetailRow label="Formulation" value="Linear, lossless, perfect foresight" />
            {expansion && <DetailRow label="Added capacity cost" value={`Prorated by ${whole(s.hours)} / 8 760 h`} />}
          </>
        }
      >
        {active === "dispatch" && (form === "chart" ? <DispatchChart r={r} /> : <DispatchTable r={r} />)}
        {active === "capacity" && <CapacityBars rows={capRows} unitLabel={r.lines.length ? "MW or MVA" : "MW"} />}
        {active === "lines" && (
          <div className="flex flex-col gap-3">
            {r.lines.map((l) => (
              <div key={l.id} className="grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.id}</p>
                  <p className="truncate text-[11.5px] text-[var(--s-text-faint)]">
                    {fixed(l.optimized_mva, 1)} MVA{l.added_mva > 1e-6 ? ", reinforced" : ""}
                  </p>
                </div>
                <div className="relative h-6" role="img" aria-label={`${l.id}: peak loading ${pct(l.peak_loading_pct)}`}>
                  <div className="absolute inset-0 rounded-[3px] bg-[var(--s-line-soft)]" />
                  <div className="absolute inset-y-0 left-0 rounded-[3px] bg-[#d9d9d9]" style={{ width: `${Math.min(100, l.peak_loading_pct)}%` }} />
                  <span
                    className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[12.5px] tabular-nums ${l.peak_loading_pct > 85 ? "right-2 text-[#0b0b0b]" : "pl-2.5"}`}
                    style={l.peak_loading_pct > 85 ? undefined : { left: `${l.peak_loading_pct}%` }}
                  >
                    {pct(l.peak_loading_pct)}
                    {l.hours_at_limit > 0 ? " · binding" : ""}
                  </span>
                </div>
              </div>
            ))}
            <p className="text-[11.5px] text-[var(--s-text-faint)]">A binding line is a thermal limit the solve met, not a security or congestion assessment.</p>
          </div>
        )}
        {active === "storage" && (
          <div className="flex flex-col gap-3">
            <StorageChart r={r} />
            <div className="flex flex-wrap gap-x-7 gap-y-1 pl-[44px] text-[12.5px]">
              <span>
                <span className="text-[var(--s-text-muted)]">Charged</span> {fixed(charged, 1)} MWh
              </span>
              <span>
                <span className="text-[var(--s-text-muted)]">Discharged</span> {fixed(discharged, 1)} MWh
              </span>
              <span>
                <span className="text-[var(--s-text-muted)]">Lost in conversion</span> {fixed(lost, 1)} MWh
              </span>
              {charged > 0 && (
                <span>
                  <span className="text-[var(--s-text-muted)]">Round trip</span> {pct((discharged / charged) * 100)}
                </span>
              )}
            </div>
          </div>
        )}
      </ReadingPanel>

      <ReadingSource>
        {r.study.provenance} · {r.engine.name} {r.engine.version}, {r.engine.solver} {r.engine.solver_version}
      </ReadingSource>
    </>
  )
}

import { useMemo, useState, type ReactNode } from "react"
import type { energy } from "../../../wailsjs/go/models"

/**
 * The pieces a result document is built from: a figure, a stat row, a chip,
 * a section, the header. Ported from TERRA's analysisPrimitives, restyled to
 * this application's tokens.
 *
 * Grids here follow the CONTAINER, not the window (the document declares
 * `@container`), because TERRA found that viewport breakpoints give a narrow
 * panel on a wide screen the layout of a wide one.
 */

export const EYEBROW = "text-[11px] uppercase tracking-[0.1em] text-muted-foreground"

/** A label, the figure it names, and the assumption the figure was read under. */
export function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className={EYEBROW}>{label}</div>
      <div className="selectable mt-0.5 truncate font-mono text-lg tabular-nums text-foreground" title={value}>
        {value}
      </div>
      {sub && (
        <div className="truncate font-mono text-[11px] tabular-nums text-muted-foreground" title={sub}>
          {sub}
        </div>
      )}
    </div>
  )
}

/** A label and its value on one baseline, for a dense run of parameters. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    // The label has a floor and the value wraps below it rather than beside
    // it: in a narrow column a truncated label beside a kept number leaves an
    // unlabelled figure, which is worse than a wrapped one.
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 py-0.5">
      <span className="min-w-[8rem] flex-1 text-xs text-muted-foreground">{label}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">{value}</span>
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-8 @2xl:grid-cols-2">{children}</div>
}

export function FigureGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-4">{children}</div>
}

/**
 * A result's standing, such as "gross" or "unvalidated". Drawn in the warning
 * colour: a qualifier that changes how every figure below it reads must not be
 * the least visible text on the page.
 */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[3px] bg-warning/15 px-1.5 py-px text-[11px] font-medium uppercase tracking-wide text-warning">
      {children}
    </span>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-5">
      <h3 className="mb-3 text-[13px] font-medium text-foreground">{title}</h3>
      {children}
    </section>
  )
}

/** The product, where it was computed, on what record, and its standing. */
export function DocumentHeader({
  product,
  title,
  meta,
  chips,
}: {
  product: string
  /** Where: the site's coordinates, or the area and its window. */
  title: string
  meta: string
  chips?: string[]
}) {
  return (
    <header className="pb-5">
      <div className="flex items-center gap-2">
        <p className={EYEBROW}>{product}</p>
        {chips?.map((c) => <Chip key={c}>{c}</Chip>)}
      </div>
      <h2 className="selectable mt-1 whitespace-pre font-mono text-xl tabular-nums text-foreground">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
    </header>
  )
}

/**
 * Which NASA POWER series the figures were read from, and when. POWER
 * reprocesses historical data and the cache never expires, so a cached run
 * and a fetched one must be distinguishable on screen.
 */
export function ProvenanceNote({ provenance }: { provenance?: energy.PowerProvenance }) {
  if (!provenance) return null
  const series = [
    ["Daily", provenance.daily],
    ["Hourly", provenance.hourly],
  ] as const
  const present = series.filter(([, s]) => !!s)
  if (!present.length) return null
  return (
    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
      {present.map(([label, s], i) => (
        <span key={label}>
          {i > 0 ? " " : ""}
          {label} series{" "}
          {s!.source === "cache"
            ? `read from cache${s!.fetched_utc ? `, fetched ${s!.fetched_utc}` : ", fetch date not recorded"}`
            : "fetched during this run"}
          .
        </span>
      ))}
    </p>
  )
}

// =====================================================================
// The panel layer: what turns a reading from a document into a surface.
//
// A section stacked under a section is a page, and a page is read once,
// top to bottom. A panel is bounded, carries its own head and its own
// scroll, and sits BESIDE its neighbours where the container allows it,
// so the reader chooses an order instead of receiving one. Everything
// below exists to make that possible in a column that is sometimes six
// hundred pixels wide and sometimes sixteen hundred.
// =====================================================================

/**
 * One bounded piece of a reading: a head that names it, a right-hand slot for
 * the control that scopes it, and a body that scrolls on its own.
 *
 * The body's height is capped rather than left to grow, because the panel's
 * job is to stay findable while the reader works somewhere else on the screen.
 */
export function Panel({
  title,
  right,
  children,
  bodyClass = "",
  /** Rows that are worth spreading across the full width -- a wide table, a map. */
  span,
}: {
  title: string
  right?: ReactNode
  children: ReactNode
  bodyClass?: string
  span?: boolean
}) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-[5px] border border-border bg-sunk ${span ? "@xl:col-span-2" : ""}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-1.5">
        <h3 className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
        {right}
      </header>
      <div className={`min-w-0 px-3 py-2.5 ${bodyClass}`}>{children}</div>
    </section>
  )
}

/**
 * The panels, side by side where there is room for it.
 *
 * The breakpoints are the CONTAINER's, never the window's: this grid lives in
 * a column the reader drags, and a wide screen holding a narrow reading panel
 * must lay out as narrow.
 */
export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-2.5 @xl:grid-cols-2">{children}</div>
}

/**
 * One row of controls, above everything they scope.
 *
 * Never inside a panel and never one per panel: two panels reading different
 * slices of the same area is how a screen starts disagreeing with itself.
 */
export function ControlBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-[5px] border border-border bg-sunk px-2 py-1.5">
      {children}
    </div>
  )
}

/** A segmented choice: the levels of a register, the products of a run. */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</span>}
      <div className="flex rounded-[4px] bg-control p-px">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-[3px] px-2 py-0.5 text-[11px] transition-colors disabled:opacity-35 ${
              o.value === value ? "bg-selected text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Depth folded away rather than stacked. What a reading assumed matters, and
 * is still wrong at the top of the screen above the figures it qualifies.
 */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-[5px] border border-border bg-sunk">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground"
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        {title}
      </button>
      {open && <div className="border-t border-hairline px-3 py-2.5">{children}</div>}
    </div>
  )
}

/**
 * A headline figure and what it is bigger or smaller THAN.
 *
 * A number with nothing beside it cannot be judged, and a reading full of them
 * invites a sentence to come and judge it -- which is how prose gets into a
 * panel. The comparison belongs on the figure, named, so no sentence is needed.
 *
 * The value takes the font's proportional figures rather than tabular ones:
 * equal-width digits are for columns that must align, and at this size they
 * make a short number look loose.
 */
export function KpiCard({
  label,
  value,
  unit,
  delta,
  note,
  spark,
}: {
  label: string
  value: string
  unit?: string
  /** Signed, against a named comparison. `goodWhen` decides the colour, never the sign alone. */
  delta?: { pct: number; against: string; goodWhen?: "up" | "down" }
  /**
   * What the figure is a share OF, where the comparison is a part-to-whole
   * rather than a change. Not every reading has a previous period to be
   * bigger than, and inventing one to fill the slot is worse than an empty
   * slot -- a delta against nothing is the prose problem in numeric form.
   */
  note?: string
  /** Twelve points at most, the run this figure is the end of. */
  spark?: number[]
}) {
  const good = delta?.goodWhen ? (delta.pct >= 0) === (delta.goodWhen === "up") : null
  const tone = good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive-quiet"
  return (
    <div className="min-w-0 rounded-[5px] border border-border bg-sunk px-3 py-2">
      <div className={EYEBROW}>{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="selectable truncate font-mono text-lg text-foreground" title={value}>
          {value}
        </span>
        {unit && <span className="shrink-0 text-[11px] text-muted-foreground">{unit}</span>}
      </div>
      {delta && (
        <div className={`truncate text-[11px] ${tone}`} title={`${delta.pct >= 0 ? "+" : ""}${delta.pct}% ${delta.against}`}>
          {delta.pct >= 0 ? "+" : ""}
          {delta.pct}% <span className="text-muted-foreground">{delta.against}</span>
        </div>
      )}
      {!delta && note && (
        <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={note}>
          {note}
        </div>
      )}
      {spark && spark.length > 1 && <Spark values={spark} />}
    </div>
  )
}

/**
 * One figure, for a board card that has no header.
 *
 * NOT `KpiCard` WITH A DIFFERENT SIZE. That one is a card: it draws its own
 * border and its own ground, because it sits in a document beside other
 * bordered things. This one draws neither, because the board's card already
 * did -- and its label is sentence case at reading size, since on a board the
 * label is a name and not a column heading.
 */
export function Metric({
  label,
  value,
  unit,
  note,
  spark,
}: {
  label: string
  value: string
  unit?: string
  note?: string
  spark?: number[]
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted-foreground" title={label}>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="selectable truncate text-[22px] font-medium leading-none tracking-tight text-foreground tabular-nums" title={value}>
          {value}
        </span>
        {unit && <span className="shrink-0 text-[11px] text-muted-foreground">{unit}</span>}
      </div>
      {note && (
        <div className="mt-1.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground" title={note}>
          {note}
        </div>
      )}
      {spark && spark.length > 1 && <Spark values={spark} />}
    </div>
  )
}

/** The shape of the run behind a figure. No axis, no label: shape only. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values) || 1
  const min = Math.min(...values)
  const span = max - min || 1
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${(i / (values.length - 1)) * 60},${14 - ((v - min) / span) * 12}`)
    .join(" ")
  return (
    <svg width={60} height={16} className="mt-1 block overflow-visible">
      <path d={d} fill="none" stroke="rgb(var(--p-line-strong))" strokeWidth={1.5} strokeLinejoin="round" />
      <circle
        cx={60}
        cy={14 - ((values[values.length - 1] - min) / span) * 12}
        r={2}
        fill="var(--color-accent)"
      />
    </svg>
  )
}

export type Column<R> = {
  key: string
  label: string
  /** How the cell is drawn. `bar` puts the magnitude in the row itself. */
  kind?: "text" | "num" | "bar"
  value: (row: R) => number | string
  format?: (row: R) => string
}

/**
 * Named rows with several figures each, ordered by whichever the reader asks
 * for.
 *
 * A LIST OF LABEL-AND-VALUE IS NOT THIS. The difference is that the reader
 * chooses the order and can see one column against another; a fixed list can
 * only be read in the order it was written, which is what makes a long one
 * feel like a document.
 *
 * A `bar` column carries its own magnitude, so the table is also the chart and
 * nothing has to be hovered to be compared.
 */
export function DataTable<R>({
  rows,
  columns,
  sortBy,
  maxHeight = 220,
  rowKey,
}: {
  rows: R[]
  columns: Column<R>[]
  /** The column the table opens on, descending. */
  sortBy?: string
  maxHeight?: number
  rowKey: (row: R) => string
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: sortBy ?? columns[0].key, desc: true })
  const col = columns.find((c) => c.key === sort.key) ?? columns[0]
  const sorted = useMemo(() => {
    const out = [...rows].sort((a, b) => {
      const va = col.value(a)
      const vb = col.value(b)
      if (typeof va === "number" && typeof vb === "number") return vb - va
      return String(va).localeCompare(String(vb))
    })
    return sort.desc ? out : out.reverse()
  }, [rows, col, sort.desc])

  const barMax = useMemo(() => {
    const bar = columns.find((c) => c.kind === "bar")
    return bar ? Math.max(1, ...rows.map((r) => Number(bar.value(r)) || 0)) : 1
  }, [rows, columns])

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-[1] bg-sunk">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`border-b border-border pb-1 text-[10px] font-normal uppercase tracking-[0.08em] ${
                  c.kind === "text" || !c.kind ? "text-left" : "text-right"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
                  className={`hover:text-foreground ${sort.key === c.key ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-hover">
              {columns.map((c) => {
                const raw = c.value(r)
                const text = c.format ? c.format(r) : typeof raw === "number" ? raw.toLocaleString() : String(raw)
                if (c.kind === "bar") {
                  return (
                    <td key={c.key} className="w-[34%] py-1 pl-2">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 min-w-0 flex-1 rounded-[2px] bg-hover">
                          <div
                            className="h-full rounded-r-[3px] bg-accent"
                            style={{ width: `${Math.max(1.5, ((Number(raw) || 0) / barMax) * 100)}%` }}
                          />
                        </div>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground">{text}</span>
                      </div>
                    </td>
                  )
                }
                return (
                  <td
                    key={c.key}
                    className={`py-1 text-xs ${
                      c.kind === "num"
                        ? "text-right font-mono tabular-nums text-foreground"
                        : "truncate text-muted-foreground"
                    }`}
                  >
                    {text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

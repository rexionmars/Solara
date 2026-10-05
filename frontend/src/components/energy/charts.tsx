import { useEffect, useId, useMemo, useRef, useState } from "react"

/**
 * The chart marks a reading is drawn with, as inline SVG.
 *
 * WHY BY HAND. Every mark here is a line, a rectangle or a circle placed from
 * a scale, and a library's default axis, tooltip and legend would have to be
 * overridden into this application's tokens anyway. Drawing them keeps the
 * grid hairline, the bar cap and the hover target under the same control as
 * the rest of the panel.
 *
 * WHAT A CHART OWES THE READER. Three things, and they are not optional:
 * a value is reachable without hovering (a direct label on the extreme, or the
 * table twin behind the toggle); two or more series always carry a legend, so
 * identity never rests on colour alone; and the hit target is larger than the
 * mark, because nobody lands on a two-pixel line.
 *
 * SIZE. A chart measures its own container rather than taking a viewBox and
 * stretching, so the text is drawn at its real size instead of being scaled
 * with the geometry. The declared height is the PLOT plus the axis band, so a
 * card never opens a nested scrollbar to show its own labels.
 */

// ---------------------------------------------------------------- the palette
//
// Checked, not judged by eye: `validate_palette.js` against this panel's
// surface (#1e1e1e, the value of --s-sunk) reports ALL CHECKS PASS for both
// sets below -- the ordinal ramp for monotone lightness and a single hue, the
// pair for the dark lightness band, the chroma floor, CVD separation (worst
// adjacent dE 25.6 protan) and contrast. Changing a value here means running
// that script again; the numbers are not eyeball-able.

/** The surface the marks sit on. Gaps and rings are drawn IN it, never as a stroke. */
const SURFACE = "var(--s-sunk)"

/**
 * Ordered tiers -- low, medium, high voltage -- as one hue stepping in
 * lightness. Voltage levels have a natural order, so they take a ramp; giving
 * them three unrelated hues would claim they are three unrelated things.
 */
export const ORDINAL = ["#9cc4f5", "#5b92d6", "#35618f"] as const

/**
 * Two quantities that read as opposite. Warm against cool, because the pair
 * has to say "these go in different directions" before it says anything else.
 */
export const SERIES = { drawn: "#3d86e0", returned: "#b8862f" } as const

/**
 * Reserved for state. A row that cannot be true is not "series four": these
 * never stand in for identity, and they always ship with a word beside them.
 */
export const STATUS = {
  ok: "var(--color-success)",
  warn: "var(--color-warning)",
  bad: "var(--color-destructive-quiet)",
} as const

const GRID = "rgb(var(--p-line) / 0.30)"
const AXIS_TEXT = "text-[10px] tabular-nums fill-[var(--muted-foreground)]"

// ------------------------------------------------------------------ the tools

/**
 * The container's width in real pixels. A chart cannot be laid out from a
 * percentage: the axis gutter, the label that must fit and the number of
 * ticks that will not collide are all decided in pixels.
 */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * Ticks a reader can hold in their head: 0, 20, 40 rather than 0, 17.3, 34.6.
 * The axis carries every value that was not directly labelled, so the numbers
 * on it have to be round or they are read twice.
 */
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0]
  const rough = max / count
  const mag = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag
  const out: number[] = []
  // Up to and PAST the maximum. A run that stops at the last tick below the
  // data puts the top of the series outside the plot, where it is drawn over
  // the panel's own head -- the chart then understates its own peak.
  for (let v = 0; v < max - step * 1e-9; v += step) out.push(Number(v.toFixed(10)))
  out.push(Number((out.length * step).toFixed(10)))
  return out
}

const compact = (v: number) =>
  Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B`
  : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
  : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}k`
  : Math.abs(v) >= 10 ? Math.round(v).toString()
  : v.toFixed(1)

/** What a tooltip and a table cell print. The caller's formatter wins. */
type Format = (v: number) => string

// ---------------------------------------------------------------- the tooltip

type TipRow = { label: string; value: string; color?: string }

/**
 * The readout, positioned beside the pointer and flipped away from the edge it
 * would otherwise leave. The VALUE is the strong element and the series name
 * follows it: the reader already knows which series they are pointing at, and
 * came for the number. Series are keyed by a short stroke rather than a filled
 * box, because at this size a box is ink doing a label's work.
 */
function Tooltip({
  x,
  y,
  width,
  title,
  rows,
}: {
  x: number
  y: number
  width: number
  title: string
  rows: TipRow[]
}) {
  const flip = x > width * 0.6
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[7rem] rounded-[4px] border border-border bg-float px-2 py-1.5 shadow-lg"
      style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y - 8) }}
    >
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="mt-1 flex items-baseline gap-1.5">
          {r.color ? <span className="h-[2px] w-3 shrink-0 rounded-full" style={{ background: r.color }} /> : null}
          <span className="font-mono text-xs tabular-nums text-foreground">{r.value}</span>
          <span className="truncate text-[10px] text-muted-foreground">{r.label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Identity, spelled out. Present whenever a chart carries two series or more,
 * never for one -- with a single colour the title has already said what is
 * drawn, and a box with one swatch only restates it.
 */
function Legend({ items }: { items: { label: string; color: string; kind?: "line" | "rect" }[] }) {
  if (items.length < 2) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span
            className={i.kind === "rect" ? "h-2 w-2 rounded-[1px]" : "h-[2px] w-3 rounded-full"}
            style={{ background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/**
 * The toggle that turns any chart into its table. A tooltip enhances a chart
 * and must never be the only way to reach a value, so every mark drawn here
 * has a twin the reader can read straight, copy and hand to someone else.
 */
function TableToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[3px] px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-hover hover:text-foreground"
    >
      {on ? "Chart" : "Table"}
    </button>
  )
}

function TwinTable({
  head,
  rows,
}: {
  head: string[]
  rows: (string | number)[][]
}) {
  return (
    <div className="max-h-[220px] overflow-auto">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 bg-sunk">
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                className={`border-b border-border py-1 text-[10px] font-normal uppercase tracking-[0.08em] text-muted-foreground ${i ? "text-right" : ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-hover">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={`py-0.5 text-xs ${j ? "text-right font-mono tabular-nums text-foreground" : "text-muted-foreground"}`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------- the area chart

export type Series = {
  key: string
  label: string
  color: string
  values: number[]
  /** A wash under the line, at a tenth of the hue. One series may carry it; several should not. */
  fill?: boolean
  /** No direct label on this series: where two extremes fall on one month their labels collide, and the value is still in the readout and the table. */
  unlabelled?: boolean
}

/**
 * A quantity across an ordered run of categories -- twelve months, a set of
 * hours -- as a two-pixel line over an optional wash.
 *
 * The crosshair finds the X and the readout lists EVERY series at it, so the
 * pointer never has to land on a particular line to get its value. The extreme
 * carries a direct label, which is what makes the chart readable with no
 * pointer at all.
 */
export function AreaChart({
  categories,
  series,
  unit,
  format = compact,
  height = 132,
  label = "extreme",
}: {
  categories: string[]
  series: Series[]
  unit?: string
  format?: Format
  /** The plot's height. The axis band is added to it, never taken out of it. */
  height?: number
  /** Which point gets a number beside it. Never every point -- that goes unread. */
  label?: "extreme" | "end" | "none"
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [at, setAt] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const gid = useId()

  const flat = series.flatMap((s) => s.values)
  const max = Math.max(0, ...flat)
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1

  const gutter = 34
  const axisBand = 16
  // The label on the extreme sits above its point, so the plot keeps a band
  // for it. Without one the number is drawn at a negative y, outside the svg.
  const padTop = 14
  const plotW = Math.max(0, width - gutter - 8)
  const stepX = categories.length > 1 ? plotW / (categories.length - 1) : 0
  const px = (i: number) => gutter + i * stepX
  const py = (v: number) => padTop + (height - padTop) * (1 - v / top)

  if (table) {
    return (
      <div>
        <TwinTable
          head={["", ...series.map((s) => s.label)]}
          rows={categories.map((c, i) => [c, ...series.map((s) => format(s.values[i] ?? 0))])}
        />
        <div className="mt-1 flex justify-end">
          <TableToggle on onClick={() => setTable(false)} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div ref={ref} className="relative w-full">
        {width > 0 && (
          <svg width={width} height={height + axisBand} className="block overflow-visible">
            {/* Recessive chrome: hairline, solid, one step off the surface. A dashed
                grid reads as a threshold, which is a claim the grid is not making. */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={gutter} x2={width - 8} y1={py(t)} y2={py(t)} stroke={GRID} strokeWidth={1} />
                <text x={gutter - 6} y={py(t) + 3} textAnchor="end" className={AXIS_TEXT}>
                  {compact(t)}
                </text>
              </g>
            ))}

            {series.map((s) => {
              const line = s.values.map((v, i) => `${i ? "L" : "M"}${px(i)},${py(v)}`).join(" ")
              return (
                <g key={s.key}>
                  {s.fill && (
                    <path
                      d={`${line} L${px(s.values.length - 1)},${height} L${px(0)},${height} Z`}
                      fill={s.color}
                      opacity={0.1}
                    />
                  )}
                  <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              )
            })}

            {/* The one number that is readable without a pointer. */}
            {label !== "none" &&
              series.map((s) => {
                const i = label === "end" ? s.values.length - 1 : s.values.indexOf(Math.max(...s.values))
                if (i < 0 || s.unlabelled) return null
                const anchor = px(i) > width - 60 ? "end" : "start"
                return (
                  <g key={`${s.key}-lab`}>
                    <circle cx={px(i)} cy={py(s.values[i])} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
                    <text
                      x={px(i) + (anchor === "end" ? -8 : 8)}
                      y={py(s.values[i]) - 6}
                      textAnchor={anchor}
                      className="text-[10px] tabular-nums fill-[var(--foreground)]"
                    >
                      {format(s.values[i])}
                    </text>
                  </g>
                )
              })}

            {at !== null && (
              <line x1={px(at)} x2={px(at)} y1={0} y2={height} stroke="rgb(var(--p-line-strong) / 0.5)" strokeWidth={1} />
            )}

            {categories.map((c, i) => (
              <text key={`${gid}-${c}-${i}`} x={px(i)} y={height + 12} textAnchor="middle" className={AXIS_TEXT}>
                {stepX >= 26 ? c : c.slice(0, 1)}
              </text>
            ))}

            {/* The hit target: a band per category, the full height of the plot.
                The reader aims at a month, never at the line drawn over it. */}
            {categories.map((_, i) => (
              <rect
                key={`${gid}-hit-${i}`}
                x={px(i) - stepX / 2}
                y={0}
                width={Math.max(stepX, 24)}
                height={height + axisBand}
                fill="transparent"
                onPointerEnter={() => setAt(i)}
                onPointerLeave={() => setAt(null)}
                tabIndex={0}
                onFocus={() => setAt(i)}
                onBlur={() => setAt(null)}
              />
            ))}
          </svg>
        )}
        {at !== null && (
          <Tooltip
            x={px(at)}
            y={Math.min(...series.map((s) => py(s.values[at] ?? 0)))}
            width={width}
            title={`${categories[at]}${unit ? ` · ${unit}` : ""}`}
            rows={series.map((s) => ({ label: s.label, value: format(s.values[at] ?? 0), color: s.color }))}
          />
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
        <TableToggle on={false} onClick={() => setTable(true)} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------ the ranked bars

export type Bar = {
  key: string
  label: string
  value: number
  /** A second line under the label -- a count, a code -- never a sentence. */
  sub?: string
  /** State, not identity: a row that is being flagged rather than coloured by rank. */
  flag?: keyof typeof STATUS
}

/**
 * Magnitude across named things, longest first.
 *
 * ONE COLOUR FOR EVERY BAR unless a row is being flagged for its STATE. Tariff
 * classes and municipalities have no order of their own, so shading each bar
 * darker-where-bigger would encode the length twice and spend the only free
 * channel on something the bar already says.
 *
 * The form is its own table: the label is set beside the bar and the value at
 * its tip, so nothing here is reachable only by hovering.
 */
export function RankedBars({
  bars,
  format = compact,
  unit,
  limit = 8,
  labelWidth = 128,
}: {
  bars: Bar[]
  format?: Format
  unit?: string
  limit?: number
  labelWidth?: number
}) {
  const shown = useMemo(() => [...bars].sort((a, b) => b.value - a.value).slice(0, limit), [bars, limit])
  const rest = bars.length - shown.length
  const max = Math.max(0, ...shown.map((b) => b.value)) || 1
  const [hover, setHover] = useState<string | null>(null)

  return (
    <div>
      <div className="flex flex-col">
        {shown.map((b) => (
          <div
            key={b.key}
            // The row is the hit target, not the painted bar: a short bar is a
            // few pixels wide and would otherwise be unhoverable.
            className="group flex min-h-[26px] items-center gap-2 rounded-[3px] px-1 hover:bg-hover"
            onPointerEnter={() => setHover(b.key)}
            onPointerLeave={() => setHover(null)}
            tabIndex={0}
            onFocus={() => setHover(b.key)}
            onBlur={() => setHover(null)}
          >
            <div className="shrink-0 truncate" style={{ width: labelWidth }} title={b.label}>
              <div className="truncate text-xs text-foreground">{b.label}</div>
              {b.sub && <div className="truncate text-[10px] text-muted-foreground">{b.sub}</div>}
            </div>
            <div className="relative h-3 min-w-0 flex-1">
              <div
                // Thin, capped at the data end and square at the baseline, so the
                // bar reads as growing from the axis rather than floating.
                className="absolute inset-y-0 left-0 rounded-r-[4px]"
                style={{
                  width: `${Math.max(1.5, (b.value / max) * 100)}%`,
                  background: b.flag ? STATUS[b.flag] : SERIES.drawn,
                  opacity: hover && hover !== b.key ? 0.55 : 1,
                }}
              />
            </div>
            <div className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">
              {format(b.value)}
            </div>
          </div>
        ))}
      </div>
      {(rest > 0 || unit) && (
        <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
          {unit}
          {unit && rest > 0 ? " · " : ""}
          {rest > 0 ? `${rest.toLocaleString()} more not drawn` : ""}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the scatter

export type Point = { x: number; y: number; label: string }

/**
 * Two quantities against each other, with the line that separates what can be
 * true from what cannot.
 *
 * WHY THIS AND NOT A COUNT. A register says 6,824 of 23,453 rows are
 * impossible. As a count that is a fact to be taken on trust; as a cloud with
 * a line through it, the reader sees HOW impossible, and whether the bad rows
 * are the small ones or the large ones -- which is the question a count cannot
 * answer.
 *
 * Both scales can be logarithmic, because a register that runs from one
 * kilowatt to several thousand puts every row in the first pixel otherwise.
 */
export function Scatter({
  points,
  xLabel,
  yLabel,
  slope,
  slopeLabel,
  height = 176,
  scale = "log",
  format = compact,
}: {
  points: Point[]
  xLabel: string
  yLabel: string
  /** The ceiling, as y = slope · x. Points above it are drawn in the warning state. */
  slope?: number
  slopeLabel?: string
  height?: number
  scale?: "linear" | "log"
  format?: Format
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [near, setNear] = useState<number | null>(null)

  const gutter = 38
  const axisBand = 26
  const plotW = Math.max(0, width - gutter - 10)

  // A log axis has no place for a zero, and putting one on the floor would
  // draw a row that declared nothing as the area's smallest producer. The
  // register holds both kinds: a generator with no energy, and -- stranger --
  // one declaring a thousandth of a kilowatt while reporting megawatt-hours,
  // which is past every ceiling by construction. Neither can be placed, so
  // both leave the plot and are counted under it.
  const plotted = scale === "log" ? points.filter((p) => p.x > 0 && p.y > 0) : points
  const silent = points.length - plotted.length
  const xs = plotted.map((p) => p.x)
  const ys = plotted.map((p) => p.y)
  const xMax = Math.max(1, ...xs)
  const yMax = Math.max(1, ...ys)
  const xMin = scale === "log" ? Math.max(0.1, Math.min(...xs)) : 0
  const yMin = scale === "log" ? Math.max(0.1, Math.min(...ys)) : 0

  const sx = (v: number) =>
    scale === "log"
      ? gutter + (Math.log10(Math.max(v, xMin)) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin) || 1) * plotW
      : gutter + (v / xMax) * plotW
  const sy = (v: number) =>
    scale === "log"
      ? height - (Math.log10(Math.max(v, yMin)) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin) || 1) * height
      : height - (v / yMax) * height

  const above = slope ? plotted.filter((p) => p.y > slope * p.x).length : 0

  /** On a log axis the only honest tick is a decade: 1, 10, 100, 1,000. */
  const decades = (lo: number, hi: number) => {
    const out: number[] = []
    for (let e = Math.ceil(Math.log10(lo)); 10 ** e <= hi; e++) out.push(10 ** e)
    return out
  }
  const yTicks = scale === "log" ? decades(yMin, yMax) : niceTicks(yMax, 3)
  const xTicks = scale === "log" ? decades(xMin, xMax) : niceTicks(xMax, 3)

  // The ceiling, SAMPLED rather than drawn as a two-point line. Under a log
  // scale the straight line between the ends is not the curve y = slope·x,
  // and a threshold drawn in the wrong place is worse than none: it would put
  // rows on the safe side of a rule they actually break.
  const rule =
    slope && xMax > xMin
      ? Array.from({ length: 41 }, (_, i) => {
          const t = i / 40
          const x = scale === "log" ? 10 ** (Math.log10(xMin) + t * (Math.log10(xMax) - Math.log10(xMin))) : xMin + t * (xMax - xMin)
          return `${i ? "L" : "M"}${sx(x)},${sy(slope * x)}`
        }).join(" ")
      : null

  return (
    <div>
      <div ref={ref} className="relative w-full">
        {width > 0 && (
          <svg
            width={width}
            height={height + axisBand}
            className="block overflow-visible"
            onPointerLeave={() => setNear(null)}
            onPointerMove={(e) => {
              // Nearest point, not a direct hit. A four-pixel dot in a cloud of
              // twenty thousand is a pinpoint nobody lands on; the pointer only
              // has to be CLOSEST.
              const r = e.currentTarget.getBoundingClientRect()
              const mx = e.clientX - r.left
              const my = e.clientY - r.top
              let best = -1
              let bestD = 24 * 24
              plotted.forEach((p, i) => {
                const d = (sx(p.x) - mx) ** 2 + (sy(p.y) - my) ** 2
                if (d < bestD) {
                  bestD = d
                  best = i
                }
              })
              setNear(best >= 0 ? best : null)
            }}
          >
            {yTicks.map((t) => (
              <g key={`y${t}`}>
                <line x1={gutter} x2={width - 10} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
                <text x={gutter - 6} y={sy(t) + 3} textAnchor="end" className={AXIS_TEXT}>
                  {compact(t)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={`x${t}`} x={sx(t)} y={height + 12} textAnchor="middle" className={AXIS_TEXT}>
                {compact(t)}
              </text>
            ))}
            <line x1={gutter} x2={width - 10} y1={height} y2={height} stroke={GRID} strokeWidth={1} />

            {plotted.map((p, i) => {
              const over = slope ? p.y > slope * p.x : false
              return (
                <circle
                  key={`${p.label}-${i}`}
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={near === i ? 5 : 2.5}
                  fill={over ? STATUS.warn : SERIES.drawn}
                  fillOpacity={near === i ? 1 : 0.55}
                  stroke={near === i ? SURFACE : "none"}
                  strokeWidth={2}
                />
              )
            })}

            {/* The ceiling itself, drawn. Solid, because here the line IS a
                threshold -- the one place a rule on a plot means something. */}
            {rule && <path d={rule} stroke={STATUS.warn} strokeWidth={1.5} fill="none" />}
          </svg>
        )}
        {near !== null && plotted[near] && (
          <Tooltip
            x={sx(plotted[near].x)}
            y={sy(plotted[near].y)}
            width={width}
            title={plotted[near].label}
            rows={[
              { label: xLabel, value: format(plotted[near].x) },
              { label: yLabel, value: format(plotted[near].y) },
            ]}
          />
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        across {xLabel} · up {yLabel}
        {slopeLabel ? ` · ${slopeLabel}` : ""}
        {silent > 0 ? ` · ${silent.toLocaleString()} declared no power or no energy and cannot be placed` : ""}
      </p>
      <Legend
        items={[
          { label: "Within what the site can make", color: SERIES.drawn, kind: "rect" },
          ...(above
            ? [
                {
                  label: `Above it · ${above.toLocaleString()} of the ${plotted.length.toLocaleString()} drawn`,
                  color: STATUS.warn,
                  kind: "rect" as const,
                },
              ]
            : []),
        ]}
      />
    </div>
  )
}

// ------------------------------------------------------------- the rule curve

/**
 * A share against a threshold the reader typed: what the answer would have
 * been had the rule been set elsewhere, with the rule that was applied marked
 * on it.
 *
 * NOT `AreaChart`, which spaces its categories evenly. The thresholds here are
 * numbers and not evenly spaced, so they are placed on a true axis: drawn as
 * categories, the step from 20 to 30 would be as wide as the step from 1 to 2
 * and the curve would bend where the ground does not.
 *
 * The share axis starts at zero and ends at a hundred, since it is a share of
 * one fixed ground and the height of the line is the claim. The applied rule
 * carries the one direct label; every other point is in the table twin.
 */
export function RuleCurve({
  points,
  at,
  xUnit,
  xLabel,
  yLabel,
  color = SERIES.drawn,
  height = 132,
}: {
  points: { x: number; y: number }[]
  /** The threshold that was applied. */
  at: number
  xUnit: string
  xLabel: string
  yLabel: string
  color?: string
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const sorted = useMemo(() => [...points].sort((a, b) => a.x - b.x), [points])
  const fmt = (v: number) => `${v.toFixed(1)}%`
  // A degree sign is set against its number; every other unit takes a space.
  const xv = (v: number) => `${Number(v.toFixed(2))}${xUnit === "°" ? "" : " "}${xUnit}`

  if (table) {
    return (
      <div>
        <TwinTable head={[xLabel, yLabel]} rows={sorted.map((p) => [xv(p.x), fmt(p.y)])} />
        <div className="mt-1 flex justify-end">
          <TableToggle on onClick={() => setTable(false)} />
        </div>
      </div>
    )
  }

  const gutter = 34
  const axisBand = 30
  const padTop = 14
  const xMax = Math.max(...sorted.map((p) => p.x), at) || 1
  const xTicks = niceTicks(xMax, 5).filter((t) => t <= xMax + 1e-9)
  const yTicks = [0, 25, 50, 75, 100]
  const plotW = Math.max(0, width - gutter - 12)
  const px = (v: number) => gutter + (v / xMax) * plotW
  const py = (v: number) => padTop + (height - padTop) * (1 - v / 100)
  const line = sorted.map((p, i) => `${i ? "L" : "M"}${px(p.x)},${py(p.y)}`).join(" ")
  const applied = sorted.find((p) => p.x === at)
  // Where the curve climbs to the right the label goes under the point, clear of the line.
  const next = applied ? sorted[sorted.indexOf(applied) + 1] : undefined
  const below = !!applied && !!next && next.y > applied.y
  const shown = hover !== null ? sorted[hover] : null

  return (
    <div>
      <div ref={ref} className="relative w-full">
        {width > 0 && (
          <svg width={width} height={height + axisBand} className="block overflow-visible" role="img" aria-label={`${yLabel} against ${xLabel}`}>
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={gutter} x2={gutter + plotW} y1={py(t)} y2={py(t)} stroke={GRID} strokeWidth={1} />
                <text x={gutter - 6} y={py(t) + 3} textAnchor="end" className={AXIS_TEXT}>
                  {t}
                </text>
              </g>
            ))}
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {sorted.map((p) => (
              <circle key={p.x} cx={px(p.x)} cy={py(p.y)} r={2} fill={color} />
            ))}

            {/* The rule that was applied: a dashed rule, because here a threshold is exactly the claim. */}
            <line x1={px(at)} x2={px(at)} y1={padTop - 4} y2={height} stroke="var(--foreground)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            {applied && (
              <g>
                <circle cx={px(at)} cy={py(applied.y)} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />
                <text
                  x={px(at) + (px(at) > width - 110 ? -8 : 8)}
                  y={below ? py(applied.y) + 16 : Math.max(10, py(applied.y) - 8)}
                  textAnchor={px(at) > width - 110 ? "end" : "start"}
                  className="text-[10px] tabular-nums fill-[var(--foreground)]"
                >
                  {fmt(applied.y)} at {xv(at)}
                </text>
              </g>
            )}

            {xTicks.map((t) => (
              <text key={t} x={px(t)} y={height + 12} textAnchor="middle" className={AXIS_TEXT}>
                {t}
              </text>
            ))}
            <text x={gutter + plotW / 2} y={height + 26} textAnchor="middle" className={AXIS_TEXT}>
              {xLabel} ({xUnit})
            </text>
            <text x={gutter - 6} y={8} textAnchor="end" className={AXIS_TEXT}>
              %
            </text>

            {sorted.map((p, i) => {
              const left = i ? (px(sorted[i - 1].x) + px(p.x)) / 2 : gutter
              const right = i < sorted.length - 1 ? (px(p.x) + px(sorted[i + 1].x)) / 2 : gutter + plotW
              return (
                <rect
                  key={`hit-${p.x}`}
                  x={left}
                  y={0}
                  width={Math.max(1, right - left)}
                  height={height}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  tabIndex={0}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              )
            })}
          </svg>
        )}
        {shown && <Tooltip x={px(shown.x)} y={py(shown.y)} width={width} title={`${xLabel} ${xv(shown.x)}`} rows={[{ label: yLabel, value: fmt(shown.y), color }]} />}
      </div>
      <div className="flex justify-end">
        <TableToggle on={false} onClick={() => setTable(true)} />
      </div>
    </div>
  )
}

// ------------------------------------------------------- the spread of a layer

/** Round values a reader can hold, inside [lo, hi]: 1700, 1800, 1900 rather than the layer's own ends. */
function ticksWithin(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo
  if (!(span > 0)) return []
  const rough = span / count
  const mag = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= rough) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)))
  return out
}

/**
 * How the cells of a layer are spread between its minimum and its maximum.
 *
 * THE ANSWER A LAYER'S READING GIVES. A mean, a minimum and a maximum say
 * where a layer ends and where it balances; whether the ground is one
 * population or two, and how much of it sits near either end, is only in the
 * shape.
 *
 * THE BARS ARE ONE TONE AND THE LAYER'S RAMP IS A RULER UNDER THE AXIS, on the
 * axis's own scale. Bars in the ramp's colours made the dark end of a dark
 * ramp vanish into the page; the ruler says the same thing -- the ground at
 * this value is this colour on the map -- without the bars paying for it.
 *
 * A LONG LOW TAIL IS ONE BAR, SET APART. The engine counts the stretch below
 * the second percentile once (`overflow`) so the intervals show the shape of
 * where the area is; here it is a bar of its own to the left of the axis, a
 * gap away, named "below N" and said in words -- how much of the area, and
 * that it runs down to the lowest cell. The ruler has a piece under it too,
 * so the whole of the layer's ramp is still on the page.
 *
 * No figure is repeated from the cards above: the mean is a named line and
 * the ruler's ends are named, not numbered.
 */
export function Histogram({
  edges,
  counts,
  areaKm2,
  mean,
  unit,
  decimals = 0,
  overflow,
  stops,
  domain,
  mode = "share",
  height = 170,
}: {
  /** One more than `counts`: the first and last are the layer's minimum and maximum. */
  edges: number[]
  counts: number[]
  /** The ground in each interval, where a cell's area is known. */
  areaKm2?: number[] | null
  mean: number
  unit: string
  decimals?: number
  /** The cells below the first interval, counted once, and the layer's lowest value. */
  overflow?: { below: number; cells: number; areaKm2?: number | null; lowest: number } | null
  /** The layer's ramp, low to high, and the domain it was drawn over. */
  stops: readonly string[]
  domain: [number, number]
  /** What the height of a bar is: its share of the area, or the ground itself. */
  mode?: "share" | "area"
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const total = counts.reduce((n, c) => n + c, 0) + (overflow?.cells ?? 0) || 1
  const share = counts.map((c) => (100 * c) / total)
  const byArea = mode === "area" && !!areaKm2
  const tall = byArea ? areaKm2! : share
  const tailShare = overflow ? (100 * overflow.cells) / total : 0
  const tailTall = overflow ? (byArea ? (overflow.areaKm2 ?? 0) : tailShare) : 0
  const fx = (v: number) => v.toFixed(decimals)
  const km2 = (v: number) => `${v.toFixed(v < 10 ? 2 : 1)} km²`

  const left = 44
  const right = 12
  const top = 30
  const base = top + height
  const lo = edges[0]
  const hi = edges[edges.length - 1]
  const span = hi - lo || 1
  const yTicks = niceTicks(Math.max(...tall, tailTall), 4)
  const yMax = yTicks[yTicks.length - 1] || 1
  // The overflow's bar and the gap that sets it apart take their room from the left of the plot.
  const tailW = overflow ? 30 : 0
  const tailGap = overflow ? 16 : 0
  const axisX = left + tailW + tailGap
  const plotW = Math.max(0, width - axisX - right)
  const px = (v: number) => axisX + ((v - lo) / span) * plotW
  const py = (v: number) => base - (v / yMax) * height
  const xTicks = ticksWithin(lo, hi).filter((t) => px(t) > axisX + 24 && px(t) < axisX + plotW - 24)
  const meanX = px(mean)

  // The ruler: the ramp over its own domain, cut to the stretch of the axis the layer covers.
  const [d0, d1] = domain
  const rampX0 = px(Math.max(lo, d0))
  const rampX1 = px(Math.min(hi, d1))
  const stopAt = (v: number) => (d1 > d0 ? (v - d0) / (d1 - d0) : 0)
  const t0 = stopAt(Math.max(lo, d0))
  const t1 = stopAt(Math.min(hi, d1))
  const tailT0 = overflow ? stopAt(Math.max(overflow.lowest, d0)) : 0
  const ramp = (from: number, to: number) =>
    stops.map((c, i) => {
      const t = stops.length > 1 ? i / (stops.length - 1) : 0
      return to > from ? <stop key={i} offset={Math.min(1, Math.max(0, (t - from) / (to - from)))} stopColor={c} /> : null
    })
  const tailH = tailTall > 0 ? Math.max(1, base - py(tailTall)) : 0
  // The words over the tail sit clear of it and of the low bars beside it.
  const lowBars = Math.max(tailH, ...tall.slice(0, Math.ceil(tall.length / 3)).map((v) => base - py(v)))

  return (
    <div ref={ref} className="reading-chart relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={base + 62}
          className="block overflow-visible"
          role="img"
          aria-label={`${byArea ? "Area" : "Share of the area"} by ${unit}, from ${fx(lo)} to ${fx(hi)}`}
        >
          <defs>
            <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
              {ramp(t0, t1)}
            </linearGradient>
            <linearGradient id={`${id}-tail`} x1="0" x2="1" y1="0" y2="0">
              {ramp(tailT0, t0)}
            </linearGradient>
          </defs>
          <text x={left} y={14}>
            {byArea ? "Area (km²)" : "Share of the area (%)"}
          </text>
          <text x={axisX + plotW} y={14} textAnchor="end">
            {unit}
          </text>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={left} x2={axisX + plotW} y1={py(t)} y2={py(t)} stroke="var(--s-line-soft)" strokeWidth={1} />
              <text x={left - 8} y={py(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {counts.map((_, i) => {
            const x0 = px(edges[i])
            const w = Math.max(1, px(edges[i + 1]) - x0 - 2)
            const h = tall[i] > 0 ? Math.max(1, base - py(tall[i])) : 0
            return (
              <rect
                key={i}
                x={x0 + 1}
                y={base - h}
                width={w}
                height={h}
                rx={h > 4 ? 2 : 0}
                fill="#d9d9d9"
                opacity={hover === null || hover === i ? 1 : 0.5}
              />
            )
          })}
          <line x1={axisX} x2={axisX + plotW} y1={base} y2={base} stroke="var(--s-line)" strokeWidth={1} />
          {overflow && (
            <g>
              <rect x={left + 1} y={base - tailH} width={tailW - 2} height={tailH} rx={tailH > 4 ? 2 : 0} fill="#d9d9d9" opacity={hover === null || hover === -1 ? 1 : 0.5} />
              <line x1={left} x2={left + tailW} y1={base} y2={base} stroke="var(--s-line)" strokeWidth={1} />
              <text x={left} y={base + 17}>
                below {fx(overflow.below)}
              </text>
              <text x={left} y={base - lowBars - 10}>
                {tailShare.toFixed(tailShare < 10 ? 1 : 0)}% of the area lies below {fx(overflow.below)}, down to the lowest cell
              </text>
            </g>
          )}
          {xTicks.map((t) => (
            <g key={t}>
              <line x1={px(t)} x2={px(t)} y1={base} y2={base + 4} stroke="var(--s-line)" strokeWidth={1} />
              <text x={px(t)} y={base + 17} textAnchor="middle">
                {fx(t)}
              </text>
            </g>
          ))}
          <line x1={meanX} x2={meanX} y1={top - 8} y2={base} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={meanX + (meanX < axisX + 60 ? 8 : -8)} y={top - 2} textAnchor={meanX < axisX + 60 ? "start" : "end"} className="strong">
            Mean
          </text>
          {/* The layer's colour ramp, on the axis's own scale. */}
          <rect x={rampX0} y={base + 28} width={Math.max(0, rampX1 - rampX0)} height={7} rx={3.5} fill={`url(#${CSS.escape(id)})`} stroke="var(--s-line)" strokeWidth={1} />
          {overflow && <rect x={left} y={base + 28} width={tailW} height={7} rx={3.5} fill={`url(#${CSS.escape(`${id}-tail`)})`} stroke="var(--s-line)" strokeWidth={1} />}
          <text x={left} y={base + 52}>
            lowest cell
          </text>
          <text x={axisX + plotW} y={base + 52} textAnchor="end">
            colour on the map · highest cell
          </text>
          {overflow && (
            <rect
              x={left}
              y={top}
              width={tailW}
              height={height}
              fill="transparent"
              onPointerEnter={() => setHover(-1)}
              onPointerLeave={() => setHover(null)}
              tabIndex={0}
              onFocus={() => setHover(-1)}
              onBlur={() => setHover(null)}
            />
          )}
          {counts.map((_, i) => (
            <rect
              key={`hit-${i}`}
              x={px(edges[i])}
              y={top}
              width={Math.max(1, px(edges[i + 1]) - px(edges[i]))}
              height={height}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              tabIndex={0}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>
      )}
      {hover !== null && hover >= 0 && (
        <Tooltip
          x={px((edges[hover] + edges[hover + 1]) / 2)}
          y={py(tall[hover])}
          width={width}
          title={`${fx(edges[hover])} – ${fx(edges[hover + 1])}`}
          rows={[
            { label: "Share of the area", value: `${share[hover].toFixed(share[hover] < 1 ? 2 : 1)}%` },
            areaKm2 ? { label: "Ground", value: km2(areaKm2[hover]) } : { label: "Cells", value: counts[hover].toLocaleString() },
          ]}
        />
      )}
      {hover === -1 && overflow && (
        <Tooltip
          x={left + tailW / 2}
          y={py(tailTall)}
          width={width}
          title={`${fx(overflow.lowest)} – ${fx(overflow.below)}`}
          rows={[
            { label: "Share of the area", value: `${tailShare.toFixed(tailShare < 1 ? 2 : 1)}%` },
            overflow.areaKm2 != null ? { label: "Ground", value: km2(overflow.areaKm2) } : { label: "Cells", value: overflow.cells.toLocaleString() },
          ]}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------- the share of a whole

/**
 * One ground split into named parts: a single bar a hundred percent long, and
 * a row per part under it that is the bar's legend and its table at once.
 *
 * The colours are the caller's, because here they are the map's: the part
 * that is orange in this bar is the ground that is orange on the layer. Every
 * part is named on its row, so the hue is never the only thing telling two
 * apart.
 *
 * A ROW CARRIES THE PART'S SIZE AND NOT ITS SHARE. The share is the length of
 * its stretch of the bar, and the shares a reading leads with are its
 * indicators'; written again on every row they were the same numbers twice.
 * The share is still in each stretch's tooltip, for the reader who wants one.
 */
export function ShareBar({
  parts,
  unit,
}: {
  parts: { key: string; label: string; color: string; value: number; pct: number }[]
  unit: string
}) {
  return (
    <div className="flex flex-col gap-3 pt-2">
      {/* A gap between two parts, never a stroke over them. */}
      <div className="flex h-3.5 w-full gap-[2px]" role="img" aria-label={parts.map((p) => `${p.label} ${p.pct.toFixed(1)}%`).join(", ")}>
        {parts
          .filter((p) => p.pct > 0)
          .map((p) => (
            <span key={p.key} className="h-full min-w-[2px] rounded-[3px]" style={{ width: `${p.pct}%`, background: p.color }} title={`${p.label}: ${p.pct.toFixed(1)}% of the area`} />
          ))}
      </div>
      <div className="reading-two" style={{ rowGap: 0 }}>
        {parts.map((p) => (
          <div key={p.key} className="flex items-baseline justify-between gap-3 border-t py-[5px] text-[12px]" style={{ borderColor: "var(--s-line-soft)" }}>
            <span className="flex min-w-0 items-baseline gap-2" style={{ color: "var(--s-text-muted)" }}>
              <span className="size-2.5 shrink-0 translate-y-px rounded-[2px]" style={{ background: p.color }} aria-hidden />
              {p.label}
            </span>
            <span className="selectable shrink-0 tabular-nums">
              {p.value.toFixed(1)} {unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

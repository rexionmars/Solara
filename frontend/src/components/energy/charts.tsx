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
                if (i < 0) return null
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

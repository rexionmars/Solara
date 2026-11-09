import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { PlanGlyph } from "../../lib/icons"
import type { Kind, Selection, Study } from "../../lib/planning"
import { STORAGE_COLOR, carrierColor, fixed } from "./PlanningUI"

/**
 * The study drawn as a single-line diagram: each bus a bar, its generators
 * above it, its loads and storage below it, the lines between the bars.
 *
 * A DRAWING, NOT A MAP. The study carries no coordinates and no position here
 * means anything: buses are laid out in the order the lines reach them, left
 * to right, and wrap into rows at the width there is. What a component is
 * connected to is the bus it names, and that is all the diagram shows.
 *
 * Everything is placed by arithmetic, so the same study draws the same way
 * every time; nothing is dragged or remembered.
 */

const SLOT = 128 // width given to one component above or below a bar
const LEAD = 112 // room at a bar's left end, under the bus's name
const TAIL = 24
const GAP = 156 // between two bars in a row, where a line between them is labelled
const ROW = 300 // a row without lanes
const LANE = 24 // one routed line below a row
const PAD = 28
const BAR = 160 // the bar's top, from the row's top

type Cell = {
  bus: string
  label: string
  kv: string
  busIndex: number | null
  order: number
  row: number
  x: number
  w: number
  above: number[]
  below: { kind: "loads" | "storage"; index: number }[]
  ports: number
}

type Wire = {
  index: number
  d: string
  label: { x: number; y: number }
  straight: boolean
}

export type DiagramLayout = {
  width: number
  height: number
  cells: (Cell & { y: number })[]
  wires: Wire[]
  drawn: boolean
}

/** Where every part of the study goes, for a given width. Pure: the same study and width, the same drawing. */
export function layoutStudy(study: Study, available: number): DiagramLayout {
  const known = new Set(study.buses.map((b) => b.id))
  const adjacency = new Map<string, string[]>()
  for (const l of study.lines) {
    if (!known.has(l.bus0) || !known.has(l.bus1) || l.bus0 === l.bus1) continue
    adjacency.set(l.bus0, [...(adjacency.get(l.bus0) ?? []), l.bus1])
    adjacency.set(l.bus1, [...(adjacency.get(l.bus1) ?? []), l.bus0])
  }
  // A walk along the lines, so that consecutive buses are joined by one and its run is straight:
  // from the bus with the fewest lines, always on to the neighbour with the fewest still unvisited,
  // and when a walk ends, on from an unvisited bus next to the most recent ones.
  const order: string[] = []
  const seen = new Set<string>()
  const ids = study.buses.map((b) => b.id)
  const open = (id: string) => (adjacency.get(id) ?? []).filter((n) => !seen.has(n)).length
  const byOpen = (a: string, b: string) => open(a) - open(b) || ids.indexOf(a) - ids.indexOf(b)
  while (order.length < ids.length) {
    let cur: string | undefined
    for (let k = order.length - 1; k >= 0 && !cur; k--) cur = (adjacency.get(order[k]) ?? []).filter((n) => !seen.has(n)).sort(byOpen)[0]
    cur ??= ids.filter((id) => !seen.has(id)).sort((a, b) => Number(open(a) === 0) - Number(open(b) === 0) || byOpen(a, b))[0]
    while (cur) {
      order.push(cur)
      seen.add(cur)
      cur = (adjacency.get(cur) ?? []).filter((n) => !seen.has(n)).sort(byOpen)[0]
    }
  }

  const above = new Map<string, number[]>()
  const below = new Map<string, Cell["below"]>()
  const orphanKey = "\u0000orphans"
  const put = (bus: string) => (known.has(bus) ? bus : orphanKey)
  study.generators.forEach((g, i) => above.set(put(g.bus), [...(above.get(put(g.bus)) ?? []), i]))
  study.loads.forEach((l, i) => below.set(put(l.bus), [...(below.get(put(l.bus)) ?? []), { kind: "loads", index: i }]))
  study.storage.forEach((s, i) => below.set(put(s.bus), [...(below.get(put(s.bus)) ?? []), { kind: "storage", index: i }]))
  if (above.has(orphanKey) || below.has(orphanKey)) order.push(orphanKey)

  const width = Math.max(available, 640)
  const cells: Cell[] = []
  let x = PAD
  let row = 0
  order.forEach((bus, i) => {
    const slots = Math.max(above.get(bus)?.length ?? 0, below.get(bus)?.length ?? 0, 1)
    const w = Math.max(240, LEAD + slots * SLOT + TAIL)
    if (cells.length && x + w > width - PAD) {
      row++
      x = PAD
    }
    const busIndex = known.has(bus) ? ids.indexOf(bus) : null
    const b = busIndex == null ? null : study.buses[busIndex]
    cells.push({
      bus,
      label: b ? b.id : "No bus",
      kv: b ? `${fixed(b.v_nom_kv, b.v_nom_kv % 1 ? 1 : 0)} kV` : "choose one",
      busIndex,
      order: i,
      row,
      x,
      w,
      above: above.get(bus) ?? [],
      below: below.get(bus) ?? [],
      ports: 0,
    })
    x += w + GAP
  })
  const cellOf = new Map(cells.map((c) => [c.bus, c]))

  // Lines: a straight run between neighbours in a row, a routed one below the row otherwise.
  type Plan = { index: number; a: Cell; b: Cell; lane: number | null; parallel: number }
  const plans: Plan[] = []
  const lanes = new Map<number, number>()
  const pairs = new Map<string, number>()
  study.lines.forEach((l, index) => {
    const p = cellOf.get(l.bus0)
    const q = cellOf.get(l.bus1)
    if (!p || !q || p === q) return
    const [a, b] = p.order < q.order ? [p, q] : [q, p]
    if (a.row === b.row && b.order === a.order + 1) {
      const key = `${a.bus}\u0000${b.bus}`
      const parallel = pairs.get(key) ?? 0
      pairs.set(key, parallel + 1)
      plans.push({ index, a, b, lane: null, parallel })
    } else {
      const lane = lanes.get(a.row) ?? 0
      lanes.set(a.row, lane + 1)
      plans.push({ index, a, b, lane, parallel: 0 })
    }
  })
  const rows = cells.length ? cells[cells.length - 1].row + 1 : 0
  const tops: number[] = []
  let y = PAD
  for (let r = 0; r < rows; r++) {
    tops.push(y)
    y += ROW + (lanes.get(r) ?? 0) * LANE + 28
  }
  const placed = cells.map((c) => ({ ...c, y: tops[c.row] }))
  const at = new Map(placed.map((c) => [c.bus, c]))

  const wires: Wire[] = plans.map(({ index, a, b, lane, parallel }) => {
    const A = at.get(a.bus)!
    const B = at.get(b.bus)!
    if (lane == null) {
      const yy = A.y + BAR + 3 + parallel * 10
      const x0 = A.x + A.w
      const x1 = B.x
      // The label stands clear above the run: two lines of 16px and a gap, never across the wire.
      return { index, d: `M${x0},${yy} H${x1}`, label: { x: (x0 + x1) / 2, y: A.y + BAR - 46 - parallel * 38 }, straight: true }
    }
    const laneY = A.y + ROW + lane * LANE
    const ax = A.x + 18 + 12 * a.ports++
    if (A.row === B.row) {
      const bx = B.x + 18 + 12 * b.ports++
      return { index, d: `M${ax},${A.y + BAR + 6} V${laneY} H${bx} V${B.y + BAR + 6}`, label: { x: (ax + bx) / 2, y: laneY }, straight: false }
    }
    const bx = Math.max(6, B.x - 30 - 8 * b.ports++)
    return {
      index,
      d: `M${ax},${A.y + BAR + 6} V${laneY} H${bx} V${B.y + BAR + 3} H${B.x}`,
      label: { x: (ax + bx) / 2, y: laneY },
      straight: false,
    }
  })
  // As wide as the drawing, not the box, so a small network sits in the middle of it.
  const contentWidth = Math.max(PAD * 2, ...placed.map((c) => c.x + c.w + PAD))
  return { width: contentWidth, height: y + PAD, cells: placed, wires, drawn: true }
}

const same = (s: Selection | null, kind: Kind, index: number) => !!s && s.kind === kind && s.index === index
const ring = (on: boolean) => (on ? "border-accent" : "border-transparent hover:border-line/50")

function GeneratorGlyph({ carrier }: { carrier: string }) {
  const color = carrierColor(carrier)
  const G = /solar|pv|photovolt/i.test(carrier)
    ? PlanGlyph.Sun
    : /wind/i.test(carrier)
      ? PlanGlyph.Wind
      : /gas|ccgt|ocgt|fossil|diesel|oil|coal|lignite|thermal/i.test(carrier)
        ? PlanGlyph.Flame
        : null
  return (
    <span className="grid size-10 place-items-center rounded-full border-[1.5px] bg-panel" style={{ borderColor: color }}>
      {G ? <G className="size-[18px]" style={{ color }} /> : <span className="text-heading" style={{ color }}>~</span>}
    </span>
  )
}

/** The range of a profile, as a component's caption gives it. */
function span(values: number[], unit: string) {
  if (!values.length) return "no profile"
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  return lo === hi ? `${fixed(hi, hi % 1 ? 1 : 0)} ${unit}` : `${fixed(lo, lo % 1 ? 1 : 0)} to ${fixed(hi, hi % 1 ? 1 : 0)} ${unit}`
}

const capCaption = (existing: number, expandable: boolean, max: number, unit: string) =>
  expandable ? `${fixed(existing, existing % 1 ? 1 : 0)} ${unit}, to ${fixed(max, max % 1 ? 1 : 0)}` : `${fixed(existing, existing % 1 ? 1 : 0)} ${unit}, fixed`

export function PlanningDiagram({
  study,
  selection,
  onSelect,
  faults,
}: {
  study: Study
  selection: Selection | null
  onSelect: (s: Selection | null) => void
  /** Components with a fault, drawn with a warning mark. */
  faults: Set<string>
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const layout = useMemo(() => layoutStudy(study, width), [study, width])
  const fault = (kind: Kind, index: number) => faults.has(`${kind}:${index}`)

  return (
    // A flex box whose child has auto margins: centred while it fits, scrolled from its edge once it does not.
    <div
      ref={box}
      className="flex min-h-0 flex-1 overflow-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.ground) onSelect(null)
      }}
    >
      <div data-ground className="relative m-auto shrink-0" style={{ width: layout.width, height: layout.height }}>
        <svg data-ground width={layout.width} height={layout.height} className="absolute inset-0" aria-hidden>
          {layout.cells.map((c) => (
            <g key={c.bus}>
              <rect
                x={c.x}
                y={c.y + BAR}
                width={c.w}
                height={6}
                rx={3}
                fill={c.busIndex == null ? "none" : same(selection, "buses", c.busIndex) ? "var(--accent)" : "#cfcfcf"}
                stroke={c.busIndex == null ? "#8a8a8a" : "none"}
                strokeDasharray={c.busIndex == null ? "5 4" : undefined}
              />
              {c.above.map((g, k) => {
                const cx = c.x + LEAD + SLOT * (k + 0.5)
                return <line key={g} x1={cx} x2={cx} y1={c.y + 86} y2={c.y + BAR} stroke="#6b6b6b" strokeWidth={2} />
              })}
              {c.below.map((s, k) => {
                const cx = c.x + LEAD + SLOT * (k + 0.5)
                return <line key={`${s.kind}${s.index}`} x1={cx} x2={cx} y1={c.y + BAR + 6} y2={c.y + 210} stroke="#6b6b6b" strokeWidth={2} />
              })}
            </g>
          ))}
          {layout.wires.map((w) => {
            const on = same(selection, "lines", w.index)
            return (
              <g key={w.index}>
                <path d={w.d} fill="none" stroke={on ? "var(--accent)" : "#9a9a9a"} strokeWidth={2} strokeLinejoin="round" />
                <path
                  d={w.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  onClick={() => onSelect({ kind: "lines", index: w.index })}
                />
              </g>
            )
          })}
        </svg>

        {layout.cells.map((c) => (
          <div key={c.bus}>
            {c.busIndex == null ? (
              <span className="absolute flex items-baseline gap-2 px-2 py-0.5 text-emphasis text-warning" style={{ left: c.x, top: c.y + BAR - 30 }}>
                No bus <span className="text-body text-muted-foreground">choose one in the inspector</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onSelect({ kind: "buses", index: c.busIndex! })}
                aria-label={`Bus ${c.label}`}
                aria-pressed={same(selection, "buses", c.busIndex)}
                className={`absolute flex max-w-[104px] items-baseline gap-1.5 rounded-[7px] border px-1.5 py-0.5 text-left ${ring(same(selection, "buses", c.busIndex))}`}
                style={{ left: c.x - 2, top: c.y + BAR - 30 }}
              >
                <span className="truncate text-emphasis font-medium text-foreground">{c.label}</span>
                <span className="shrink-0 text-body text-muted-foreground">{c.kv}</span>
                {fault("buses", c.busIndex) && <span aria-label="has a fault" className="size-1.5 shrink-0 self-center rounded-full bg-warning" />}
              </button>
            )}

            {c.above.map((gi, k) => {
              const g = study.generators[gi]
              const cx = c.x + LEAD + SLOT * (k + 0.5)
              const on = same(selection, "generators", gi)
              return (
                <button
                  key={gi}
                  type="button"
                  onClick={() => onSelect({ kind: "generators", index: gi })}
                  aria-label={`Generator ${g.id}, ${g.carrier}`}
                  aria-pressed={on}
                  className={`absolute flex w-[120px] flex-col items-center gap-1 rounded-[10px] border p-1 ${ring(on)}`}
                  style={{ left: cx - 60, top: c.y + 6 }}
                >
                  <span className="flex h-8 w-full flex-col items-center justify-end leading-4">
                    <span className="flex max-w-full items-center gap-1 truncate text-emphasis font-medium text-foreground">
                      <span className="truncate">{g.id}</span>
                      {fault("generators", gi) && <span aria-label="has a fault" className="size-1.5 shrink-0 rounded-full bg-warning" />}
                    </span>
                    <span className="max-w-full truncate text-body text-muted-foreground">{capCaption(g.existing_mw, g.expandable, g.max_mw, "MW")}</span>
                  </span>
                  <GeneratorGlyph carrier={g.carrier} />
                </button>
              )
            })}

            {c.below.map((s, k) => {
              const cx = c.x + LEAD + SLOT * (k + 0.5)
              const on = same(selection, s.kind, s.index)
              const load = s.kind === "loads" ? study.loads[s.index] : null
              const store = s.kind === "storage" ? study.storage[s.index] : null
              const name = load?.id ?? store?.id ?? ""
              return (
                <button
                  key={`${s.kind}${s.index}`}
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-label={`${load ? "Load" : "Storage"} ${name}`}
                  aria-pressed={on}
                  className={`absolute flex w-[120px] flex-col items-center gap-1 rounded-[10px] border p-1 ${ring(on)}`}
                  style={{ left: cx - 60, top: c.y + 206 }}
                >
                  {load ? (
                    <span className="grid size-10 place-items-center rounded-full border-[1.5px] border-line-strong bg-panel">
                      <PlanGlyph.ArrowDown className="size-[18px] text-foreground" />
                    </span>
                  ) : (
                    <span className="grid size-10 place-items-center rounded-[9px] border-[1.5px] bg-panel" style={{ borderColor: STORAGE_COLOR }}>
                      <PlanGlyph.BatteryHigh className="size-[18px]" style={{ color: STORAGE_COLOR }} />
                    </span>
                  )}
                  <span className="flex h-8 w-full flex-col items-center leading-4">
                    <span className="flex max-w-full items-center gap-1 text-emphasis font-medium text-foreground">
                      <span className="truncate">{name}</span>
                      {fault(s.kind, s.index) && <span aria-label="has a fault" className="size-1.5 shrink-0 rounded-full bg-warning" />}
                    </span>
                    <span className="max-w-full truncate text-body text-muted-foreground">
                      {load
                        ? span(load.p_mw, "MW")
                        : `${capCaption(store!.existing_mw, store!.expandable, store!.max_mw, "MW")} · ${fixed(store!.max_hours, store!.max_hours % 1 ? 1 : 0)} h`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        ))}

        {layout.wires.map((w) => {
          const l = study.lines[w.index]
          const on = same(selection, "lines", w.index)
          return (
            <button
              key={w.index}
              type="button"
              onClick={() => onSelect({ kind: "lines", index: w.index })}
              aria-label={`Line ${l.id} from ${l.bus0} to ${l.bus1}`}
              aria-pressed={on}
              className={`absolute flex w-[140px] flex-col items-center rounded-[7px] border px-1 py-0.5 leading-4 ${ring(on)} ${w.straight ? "" : "bg-board"}`}
              style={{ left: w.label.x - 70, top: w.straight ? w.label.y : w.label.y - 17 }}
            >
              <span className="flex max-w-full items-center gap-1 text-emphasis font-medium text-foreground">
                <span className="truncate">{l.id}</span>
                {fault("lines", w.index) && <span aria-label="has a fault" className="size-1.5 shrink-0 rounded-full bg-warning" />}
              </span>
              <span className="max-w-full truncate text-body text-muted-foreground">{capCaption(l.existing_mva, l.expandable, l.max_mva, "MVA")}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

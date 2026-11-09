import { useRef, useState } from "react"
import { Plus, Trash } from "../../lib/icons"
import { planning } from "../../lib/planning"
import { btnGhostDense } from "../ui/buttons"
import { NumberInput, Toggle, clock, fixed, moment } from "./PlanningUI"

type Column<T> = { key: keyof T; label: string; type?: "number" | "boolean" | "bus"; min?: number }

const cellInput =
  "h-6 w-full min-w-0 rounded-[5px] border border-transparent bg-transparent px-1.5 text-emphasis text-foreground outline-none hover:border-line/40 focus:border-accent/60"

/**
 * One kind of component as rows, every field a cell: the network as a
 * spreadsheet, for a study too large to read as a drawing or for changing one
 * field down a whole column.
 */
export function ComponentTable<T extends { id: string }>({
  label,
  rows,
  columns,
  buses,
  onChange,
  create,
  disabled,
  selected,
  onSelect,
}: {
  label: string
  rows: T[]
  columns: Column<T>[]
  buses: string[]
  onChange: (rows: T[]) => void
  create: () => T
  disabled: boolean
  selected: number | null
  onSelect: (index: number) => void
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-2">
        <h3 className="text-emphasis font-medium text-foreground">{label}</h3>
        <span className="tabular-nums text-body text-muted-foreground">{rows.length}</span>
        <button type="button" disabled={disabled} className={`${btnGhostDense} ml-auto`} onClick={() => onChange([...rows, create()])}>
          <Plus className="size-3" />
          Add
        </button>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-emphasis">
          <thead className="sticky top-0 z-10 bg-panel-head">
            <tr>
              {columns.map((c) => (
                <th
                  key={String(c.key)}
                  className={`whitespace-nowrap border-b border-line/30 px-2.5 py-1.5 text-body font-medium text-muted-foreground ${c.type === "number" ? "text-right" : "text-left"}`}
                >
                  {c.label}
                </th>
              ))}
              <th className="border-b border-line/30 px-2.5 py-1.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                onFocusCapture={() => onSelect(i)}
                onClick={() => onSelect(i)}
                className={i === selected ? "bg-selected" : "hover:bg-hover/60"}
              >
                {columns.map((c) => {
                  const value = row[c.key]
                  const set = (v: unknown) => onChange(rows.map((r, j) => (i === j ? { ...r, [c.key]: v } : r)))
                  const aria = `${label} ${row.id || i + 1}: ${c.label}`
                  return (
                    <td key={String(c.key)} className="border-b border-line/20 px-1 py-0.5">
                      {c.type === "boolean" ? (
                        <div className="flex justify-center">
                          <Toggle label={aria} disabled={disabled} checked={Boolean(value)} onChange={set} />
                        </div>
                      ) : c.type === "bus" ? (
                        <select aria-label={aria} disabled={disabled} className={`${cellInput} min-w-24`} value={String(value)} onChange={(e) => set(e.target.value)}>
                          {!buses.includes(String(value)) && <option value="">Choose a bus</option>}
                          {buses.map((b) => (
                            <option key={b}>{b}</option>
                          ))}
                        </select>
                      ) : (
                        c.type === "number" ? (
                          // The inspector's number well, bare: a decimal point always, and "0." can be typed.
                          <NumberInput
                            label={aria}
                            disabled={disabled}
                            value={Number(value)}
                            onChange={(v) => set(v ?? 0)}
                            className="!h-6 min-w-20 !border-transparent !bg-transparent !px-1.5 hover:!border-line/40"
                          />
                        ) : (
                          <input aria-label={aria} disabled={disabled} className={`${cellInput} min-w-28`} value={String(value)} onChange={(e) => set(e.target.value)} />
                        )
                      )}
                    </td>
                  )
                })}
                <td className="border-b border-line/20 px-1 py-0.5">
                  <button
                    type="button"
                    disabled={disabled}
                    className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-hover hover:text-destructive-quiet disabled:opacity-40"
                    aria-label={`Remove ${row.id || label}`}
                    title={`Remove ${row.id || label}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onChange(rows.filter((_, j) => i !== j))
                    }}
                  >
                    <Trash className="size-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="px-4 py-6 text-center text-emphasis text-muted-foreground">No {label.toLowerCase()} yet.</p>}
    </section>
  )
}

/** Up to this many bars across the inspector; a longer horizon is drawn as the mean of each run of intervals. */
const MAX_BARS = 96

/** A round ceiling for a profile's axis: 1, 2 or 5 times a power of ten. */
function niceCeil(v: number) {
  if (!(v > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!
}

/**
 * Numbers from pasted or imported text: one per line, or separated by commas,
 * semicolons or spaces. A table of several columns (a CSV of time and value)
 * gives its LAST column, and a first row that is not a number is its header.
 * Anything else that is not a number is kept, so the count fails honestly.
 */
export function parseSeries(text: string): number[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const table = lines.length > 1 && lines.some((l) => /[,;\t]/.test(l.replace(/[,;\t]\s*$/, "")))
  if (!table) return text.trim().split(/[\s,;]+/).filter(Boolean).map(Number)
  const cells = lines.map((l) => {
    const parts = l.split(/[,;\t]/).map((s) => s.trim()).filter(Boolean)
    return parts[parts.length - 1] ?? ""
  })
  return cells.filter((c, i) => !(i === 0 && Number.isNaN(Number(c)))).map(Number)
}

/**
 * A component's time series, drawn as bars and edited as a column of numbers.
 *
 * AN EDIT IS A DRAFT UNTIL IT IS APPLIED, and a draft holds Optimize back: a
 * profile half typed is not the profile that would be solved. The draft lives
 * in the planning store, so leaving the component and coming back finds it.
 */
export function ProfileEditor({
  draftKey,
  title,
  unit,
  values,
  times,
  maximum,
  color,
  disabled,
  onChange,
}: {
  draftKey: string
  title: string
  unit: string
  values: number[]
  times: string[]
  maximum?: number
  color: string
  disabled: boolean
  onChange: (values: number[]) => void
}) {
  const [draft, setDraft] = useState<string | null>(() => planning.get().profileDrafts[draftKey] ?? null)
  const [error, setError] = useState("")
  const file = useRef<HTMLInputElement>(null)
  const count = times.length

  const hold = (text: string | null) => {
    setDraft(text)
    planning.set((s) => {
      const profileDrafts = { ...s.profileDrafts }
      const pendingProfiles = { ...s.pendingProfiles }
      if (text == null) {
        delete profileDrafts[draftKey]
        delete pendingProfiles[draftKey]
      } else {
        profileDrafts[draftKey] = text
        pendingProfiles[draftKey] = true
      }
      return { ...s, profileDrafts, pendingProfiles }
    })
  }
  const apply = (text: string) => {
    const v = parseSeries(text)
    if (v.length !== count || v.some((n) => !Number.isFinite(n) || n < 0 || (maximum != null && n > maximum))) {
      setError(
        `Give ${count} numbers ${maximum == null ? "of zero or more" : `from 0 to ${maximum}`}, one per interval; ${v.length} found.`,
      )
      return false
    }
    setError("")
    hold(null)
    onChange(v)
    return true
  }

  if (!count) {
    return <p className="text-emphasis text-muted-foreground">Build the horizon in the study bar first: a profile has one value per interval.</p>
  }

  const per = Math.ceil(count / MAX_BARS)
  const bars: { v: number; tip: string }[] = []
  for (let i = 0; i < count; i += per) {
    const run = values.slice(i, i + per)
    const v = run.reduce((a, b) => a + b, 0) / Math.max(1, run.length)
    const tip =
      per === 1
        ? `${moment(times[i])} · ${fixed(v, 2)} ${unit}`
        : `${moment(times[i])} to ${moment(times[Math.min(i + per, count) - 1])} · mean ${fixed(v, 2)} ${unit}`
    bars.push({ v, tip })
  }
  const peak = Math.max(...values)
  const top = maximum ?? niceCeil(peak)
  const mean = values.reduce((a, b) => a + b, 0) / count
  const peakAt = values.indexOf(peak)
  const multiDay = new Date(times[count - 1]).getTime() - new Date(times[0]).getTime() > 36 * 3600_000
  const when = (iso: string) => (multiDay ? moment(iso) : clock(iso))
  const constant = values.every((v) => v === values[0])
  const digits = maximum === 1 ? 2 : 1

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-emphasis font-medium text-foreground">{title}</h3>
        <span className="text-body text-muted-foreground">{unit === "MW" ? "MW, mean over each interval" : "Share of capacity, 0 to 1"}</span>
      </div>
      <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-1.5 gap-y-1">
        <div className="flex h-[100px] flex-col items-end justify-between text-meta tabular-nums text-muted-foreground">
          <span className="-mt-1 leading-none">{fixed(top, top % 1 ? 1 : 0)}</span>
          <span className="leading-none">{fixed(top / 2, (top / 2) % 1 ? 1 : 0)}</span>
          <span className="-mb-1 leading-none">0</span>
        </div>
        <div className="relative h-[100px] border-b border-line-strong/50" role="img" aria-label={`${title}: mean ${fixed(mean, digits)} ${unit}, peak ${fixed(peak, digits)} ${unit}`}>
          <div aria-hidden className="absolute inset-x-0 top-0 border-t border-line/25" />
          <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-line/25" />
          <div className="absolute inset-0 flex items-end gap-px">
            {bars.map((b, i) => (
              <div
                key={i}
                title={b.tip}
                className="min-w-0 flex-1 rounded-t-[2px]"
                style={{ height: `${Math.min(100, (b.v / top) * 100)}%`, background: color }}
              />
            ))}
          </div>
        </div>
        <span />
        <div className="flex justify-between text-meta tabular-nums text-muted-foreground">
          <span>{when(times[0])}</span>
          <span>{when(times[Math.floor(count / 2)])}</span>
          <span>{when(times[count - 1])}</span>
        </div>
      </div>
      <p className="text-emphasis text-muted-foreground">
        {constant
          ? `Constant at ${fixed(values[0], digits)} ${unit === "MW" ? "MW" : ""} over ${count} intervals`
          : `Mean ${fixed(mean, digits)}${unit === "MW" ? " MW" : ""} · peak ${fixed(peak, digits)}${unit === "MW" ? " MW" : ""} at ${when(times[peakAt])}`}
      </p>

      {draft == null ? (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={disabled} className={btnGhostDense} onClick={() => hold(values.map((v) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toPrecision(12)))).join("\n"))}>
            Edit values
          </button>
          <button
            type="button"
            disabled={disabled}
            className={btnGhostDense}
            title="One value per line, or a table whose last column holds the values"
            onClick={() => file.current?.click()}
          >
            Import CSV
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className="text-body text-muted-foreground" htmlFor={`profile-${draftKey}`}>
            One value per line, {count} in all. Paste a column from a spreadsheet to replace them.
          </label>
          <textarea
            id={`profile-${draftKey}`}
            rows={6}
            disabled={disabled}
            value={draft}
            onChange={(e) => hold(e.target.value)}
            className="resize-y rounded-[6px] border border-line/40 bg-field px-2 py-1.5 font-mono text-body tabular-nums text-foreground outline-none focus:border-accent/60"
          />
          {error && (
            <p role="alert" className="text-body text-destructive-quiet">
              {error}
            </p>
          )}
          <div className="flex gap-1.5">
            <button type="button" disabled={disabled} className={`${btnGhostDense} !border-accent/50 !text-foreground`} onClick={() => apply(draft)}>
              Apply
            </button>
            <button
              type="button"
              className={btnGhostDense}
              onClick={() => {
                setError("")
                hold(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {draft == null && error && (
        <p role="alert" className="text-body text-destructive-quiet">
          {error}
        </p>
      )}
      <input
        ref={file}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        aria-label={`Import ${title.toLowerCase()} from a CSV file`}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (!f) return
          if (f.size > 8_000_000) {
            setError("A profile file can be up to 8 MB.")
            return
          }
          const text = await f.text()
          if (!apply(text)) hold(text)
        }}
      />
    </div>
  )
}

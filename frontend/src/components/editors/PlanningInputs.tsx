import { useState, type ReactNode } from "react"
import { Plus, Trash } from "../../lib/icons"
import { planning } from "../../lib/planning"
import { btnGhostDense, fieldInput } from "../ui/buttons"
import { selectStyle, tdStyle, thStyle } from "./PlanningUI"

type Column<T> = { key: keyof T; label: string; type?: "number" | "boolean" | "bus"; min?: number }
export function ComponentTable<T extends { id: string }>({
  label,
  rows,
  columns,
  buses,
  onChange,
  create,
  disabled,
}: {
  label: string
  rows: T[]
  columns: Column<T>[]
  buses: string[]
  onChange: (rows: T[]) => void
  create: () => T
  disabled: boolean
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <h3 className="eyebrow !text-foreground">{label}</h3>
        <span className="telemetry text-meta text-muted-foreground">{rows.length}</span>
        <button
          type="button"
          disabled={disabled}
          className={`${btnGhostDense} !h-6 ml-auto`}
          onClick={() => onChange([...rows, create()])}
        >
          <Plus className="size-3" />
          Add
        </button>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-meta">
          <thead className="sticky top-0 z-10" style={{ background: "var(--s-panel-head)" }}>
            <tr>
              {columns.map((c) => (
                <th className={`${thStyle} ${c.type === "number" ? "text-right" : ""}`} key={String(c.key)}>
                  {c.label}
                </th>
              ))}
              <th className={thStyle}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-hover/50">
                {columns.map((c) => {
                  const value = row[c.key]
                  const set = (v: unknown) =>
                    onChange(rows.map((r, j) => (i === j ? { ...r, [c.key]: v } : r)))
                  const aria = `${label} ${i + 1} ${c.label}`
                  return (
                    <td key={String(c.key)} className={tdStyle}>
                      {c.type === "boolean" ? (
                        <input
                          aria-label={aria}
                          disabled={disabled}
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(e) => set(e.target.checked)}
                        />
                      ) : c.type === "bus" ? (
                        <select
                          aria-label={aria}
                          disabled={disabled}
                          className={`${selectStyle} !h-6 !border-transparent hover:!border-line/40 focus:!border-accent/55`}
                          value={String(value)}
                          onChange={(e) => set(e.target.value)}
                        >
                          <option value="">Select bus</option>
                          {buses.map((b) => (
                            <option key={b}>{b}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={aria}
                          disabled={disabled}
                          type={c.type === "number" ? "number" : "text"}
                          step="any"
                          min={c.min ?? 0}
                          className={`${fieldInput} !h-6 !text-meta !border-transparent hover:!border-line/40 focus:!border-accent/55 ${c.type === "number" ? "min-w-20 text-right telemetry" : "min-w-28"}`}
                          value={String(value)}
                          onChange={(e) =>
                            set(
                              c.type === "number"
                                ? e.target.value === ""
                                  ? 0
                                  : Number(e.target.value)
                                : e.target.value,
                            )
                          }
                        />
                      )}
                    </td>
                  )
                })}
                <td className={tdStyle}>
                  <button
                    type="button"
                    disabled={disabled}
                    className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-hover hover:text-destructive-quiet disabled:opacity-40"
                    aria-label={`Remove ${row.id || label}`}
                    title={`Remove ${row.id || label}`}
                    onClick={() => onChange(rows.filter((_, j) => i !== j))}
                  >
                    <Trash className="size-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="px-2.5 py-6 text-center text-meta text-muted-foreground">
          No {label.toLowerCase()} in this study. Use Add to create a component.
        </p>
      )}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 grid-cols-[minmax(7rem,34%)_minmax(0,1fr)] items-start gap-3 text-meta text-muted-foreground">
      <span className="pt-1.5">{label}</span>
      <div className="min-w-0">{children}</div>
    </label>
  )
}

export function SeriesInput({
  label,
  values,
  count,
  maximum,
  disabled,
  onChange,
  onPending,
}: {
  label: string
  values: number[]
  count: number
  maximum?: number
  disabled: boolean
  onChange: (v: number[]) => void
  onPending: (pending: boolean) => void
}) {
  const [draft, setDraft] = useState(() => planning.get().profileDrafts[label] ?? values.join(", "))
  const [error, setError] = useState("")
  const apply = () => {
    const parts = draft
      .trim()
      .split(/[\s,;]+/)
      .filter(Boolean)
    const v = parts.map(Number)
    if (
      !draft.trim() ||
      v.length !== count ||
      v.some((n) => !Number.isFinite(n) || n < 0 || (maximum != null && n > maximum))
    ) {
      setError(
        `Enter ${count} numbers ${maximum == null ? "greater than or equal to zero" : `between 0 and ${maximum}`} separated by commas or whitespace.`,
      )
      return
    }
    onPending(false)
    planning.set((s) => {
      const profileDrafts = { ...s.profileDrafts }
      delete profileDrafts[label]
      return { ...s, profileDrafts }
    })
    onChange(v)
    setError("")
  }
  return (
    <section className="flex flex-col gap-2 border-t border-line/30 py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="eyebrow !text-foreground">{label}</h3>
        <span className="ml-auto telemetry text-meta text-muted-foreground">{count} intervals</span>
      </div>
      <textarea
        aria-label={label}
        disabled={disabled}
        rows={3}
        className={`${fieldInput} !h-auto resize-y py-2 font-mono !text-meta`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          const value = e.target.value
          planning.set((s) => ({ ...s, profileDrafts: { ...s.profileDrafts, [label]: value } }))
          onPending(true)
        }}
        onBlur={apply}
      />
      {error && (
        <span role="alert" className="text-destructive-quiet">
          {error}
        </span>
      )}
      <button type="button" disabled={disabled} className={`${btnGhostDense} !h-6 self-end`} onClick={apply}>
        Apply profile
      </button>
    </section>
  )
}

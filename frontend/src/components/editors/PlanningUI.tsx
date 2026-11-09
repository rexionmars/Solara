import { useEffect, useState, type ReactNode } from "react"
import { grouped } from "../../lib/energyFormat"

/**
 * The small parts the planning destination is drawn with: its numbers, its
 * colours, and the controls its forms share.
 */

const MINUS = "−"

/** A figure at a fixed precision, grouped by a thin space from five digits, with a typographic minus. */
export function fixed(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—"
  if (Math.abs(value) >= 10_000) return grouped(value)
  const s = Math.abs(value).toFixed(digits)
  return Number(s) === 0 ? s : value < 0 ? `${MINUS}${s}` : s
}

/** A whole figure: the reading's grouping, never a comma. */
export const whole = (value: number) => grouped(value)

/** A clock time in UTC, which is what the study's timestamps are kept in. */
export function clock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

/** A day and a time in UTC: "1 Jan 2026, 00:00". */
export function moment(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}, ${clock(iso)}`
}

/**
 * Each technology keeps one colour on every surface of the destination, the
 * diagram's glyphs and the dispatch chart alike.
 *
 * Gas, solar and storage were checked together with the dataviz validator on
 * the panel ground (#1b1b1b): lightness band, chroma, colour-vision separation
 * and contrast all pass. A technology the names below do not recognise takes
 * the next of two further hues, then the neutral of "Other"; the chart always
 * labels a series in its legend and its tooltip, so a colour never carries an
 * identity alone.
 */
export const STORAGE_COLOR = "#d55181"
export const OTHER_COLOR = "#8a8a8a"
const KNOWN: [RegExp, string][] = [
  [/solar|pv|photovolt/i, "#c98500"],
  [/gas|ccgt|ocgt|fossil|diesel|oil|coal|lignite|thermal/i, "#3987e5"],
  [/wind/i, "#199e70"],
]
const SPARE = ["#199e70", "#d95926"]

/** Colours for a set of technologies, in the order given; at most `limit` before the rest fold into Other. */
export function carrierColors(carriers: string[], limit = 4): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  for (const c of carriers.slice(0, limit)) {
    const known = KNOWN.find(([re]) => re.test(c))?.[1]
    if (known && !used.has(known)) {
      out.set(c, known)
      used.add(known)
    }
  }
  for (const c of carriers.slice(0, limit)) {
    if (out.has(c)) continue
    const spare = SPARE.find((s) => !used.has(s))
    if (spare) {
      out.set(c, spare)
      used.add(spare)
    }
  }
  return out
}

/** One technology's colour where it is drawn alone, as a diagram glyph is. */
export function carrierColor(carrier: string): string {
  return KNOWN.find(([re]) => re.test(carrier))?.[1] ?? OTHER_COLOR
}

/** An on-off switch: the olive of what is active when on. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ background: checked ? "rgb(var(--p-olive-light))" : "rgb(var(--p-line))" }}
    >
      <span
        aria-hidden
        className="absolute size-3 rounded-full transition-[left]"
        style={{ left: checked ? 17 : 3, background: "rgb(var(--p-ink))" }}
      />
    </button>
  )
}

/** Two or three choices of one kind, the pressed one raised. */
export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  size = "md",
}: {
  label: string
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
  disabled?: boolean
  size?: "sm" | "md"
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 gap-0.5 rounded-[8px] border border-line/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-[6px] font-medium transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
            size === "sm" ? "px-2 py-0.5 text-body" : "px-3 py-1 text-emphasis"
          } ${o.value === value ? "bg-float text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The input well of the planning forms: 28px, the field ground, the unit inside on the right. */
export const wellCls =
  "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-[6px] border border-line/40 bg-field px-2 text-emphasis focus-within:border-accent/60"

/**
 * A number typed as text, so "0." and "1e" can be on their way to a value.
 *
 * The draft is committed when it parses; while it does not, the well is
 * marked and the study keeps its last good value, which is restored on blur.
 */
export function NumberInput({
  value,
  onChange,
  unit,
  label,
  disabled,
  placeholder,
  allowEmpty,
  className = "",
}: {
  value: number | null
  onChange: (v: number | null) => void
  unit?: string
  label: string
  disabled?: boolean
  placeholder?: string
  /** An empty well means null (no cap) instead of a fault. */
  allowEmpty?: boolean
  className?: string
}) {
  const shown = value == null ? "" : String(value)
  const [draft, setDraft] = useState(shown)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(shown)
  }, [shown, focused])
  const parsed = draft.trim() === "" ? (allowEmpty ? null : NaN) : Number(draft.replace(/[\s ]/g, ""))
  const bad = parsed !== null && !Number.isFinite(parsed)
  return (
    <label className={`${wellCls} ${bad ? "!border-destructive-quiet" : ""} ${className}`}>
      <span className="sr-only">{label}</span>
      <input
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setDraft(shown)
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          const t = e.target.value.trim()
          if (t === "" && allowEmpty) onChange(null)
          else {
            const n = Number(t.replace(/[\s ]/g, ""))
            if (t !== "" && Number.isFinite(n)) onChange(n)
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-right tabular-nums text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
      />
      {unit && <span className="shrink-0 whitespace-nowrap text-body text-muted-foreground">{unit}</span>}
    </label>
  )
}

/** A line of text in the well. */
export function TextInput({
  value,
  onChange,
  label,
  disabled,
  placeholder,
  className = "",
}: {
  value: string
  onChange: (v: string) => void
  label: string
  disabled?: boolean
  placeholder?: string
  className?: string
}) {
  return (
    <label className={`${wellCls} ${className}`}>
      <span className="sr-only">{label}</span>
      <input
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
      />
    </label>
  )
}

/** A choice from a list, in the well, with the caret drawn by us. */
export function SelectInput({
  value,
  onChange,
  options,
  label,
  disabled,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  label: string
  disabled?: boolean
  placeholder?: string
}) {
  const known = options.includes(value)
  return (
    <label className={`${wellCls} relative !pr-6 ${!known ? "!border-destructive-quiet/70" : ""}`}>
      <span className="sr-only">{label}</span>
      <select
        disabled={disabled}
        value={known ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 appearance-none bg-transparent text-foreground outline-none disabled:opacity-60"
      >
        {!known && <option value="">{placeholder ?? "Choose…"}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute right-2 size-3 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </label>
  )
}

/** A label and its control on one row of a form. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-7 grid-cols-[minmax(0,44%)_minmax(0,1fr)] items-center gap-3" title={hint}>
      <span className="min-w-0 text-emphasis text-muted-foreground">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  )
}

/** A titled group of rows, divided from the next by a hairline. */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-line/25 px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-emphasis font-medium text-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

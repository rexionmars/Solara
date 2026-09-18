import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowCounterClockwise, Check } from "@phosphor-icons/react"
import { formatKeys, runOperator, useOperator } from "../../lib/operators"
import { btnGhostDense, btnPrimary } from "./buttons"

/** Pixels of travel that cover one step, at normal sensitivity; shift slows it tenfold. */
const PX_PER_STEP = 6
/** Below this, a press was a click asking to type rather than a drag. */
const CLICK_SLOP_PX = 3

/**
 * A value you drag, or type, or step with the arrow keys, as TERRA's
 * NumberField: label and value on one line at the size of a row of text,
 * precision independent of the control's width.
 *
 * One difference, and it is the engine's: a setting may be EMPTY, which means
 * "the engine's default". An empty field shows that default in the muted
 * colour, a set one in the foreground with a reset beside it, so what is sent
 * and what is inherited can be told apart at a glance.
 */
export function NumberField({
  label,
  value,
  fallback,
  step,
  decimals,
  unit,
  validate,
  onChange,
  inlineLabel = false,
  allowEmpty = true,
}: {
  label: string
  value: number | undefined
  /** What an empty field stands for: the engine's default, as it reported it. */
  fallback?: number
  step: number
  decimals?: number
  unit?: string
  /** Why a value is refused, or null. A refused value is not stored. */
  validate?: (v: number) => string | null
  onChange: (v: number | undefined) => void
  inlineLabel?: boolean
  allowEmpty?: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null)

  const shown = value ?? fallback
  const fmt = (v: number | undefined) =>
    v === undefined ? "default" : decimals !== undefined ? v.toFixed(decimals) : String(Number(v.toFixed(6)))

  const propose = (v: number) => {
    const rounded = Number(v.toFixed(decimals ?? 6))
    const problem = validate?.(rounded) ?? null
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    onChange(rounded)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, from: shown ?? 0, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < CLICK_SLOP_PX) return
    d.moved = true
    const steps = Math.round(dx / PX_PER_STEP / (e.shiftKey ? 10 : 1))
    const next = d.from + steps * step
    // Scrubbing stops at the edge of what is accepted rather than flashing an error.
    if (!validate?.(Number(next.toFixed(decimals ?? 6)))) propose(next)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    // A press that did not travel was a request to type, the only way to an exact figure.
    if (!d.moved) setEditing(value === undefined ? "" : fmt(value))
  }

  const commit = (text: string) => {
    setEditing(null)
    hostRef.current?.focus()
    if (text.trim() === "") {
      if (allowEmpty) {
        setError(null)
        onChange(undefined)
      } else setError("A value is required")
      return
    }
    const n = Number(text.replace(",", "."))
    if (!Number.isFinite(n)) {
      setError("Not a number")
      return
    }
    propose(n)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const by = e.shiftKey ? step / 10 : step
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault()
      propose((shown ?? 0) + by)
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault()
      propose((shown ?? 0) - by)
    } else if (e.key === "Enter") {
      e.preventDefault()
      setEditing(value === undefined ? "" : fmt(value))
    } else if ((e.key === "Backspace" || e.key === "Delete") && allowEmpty && value !== undefined) {
      e.preventDefault()
      setError(null)
      onChange(undefined)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-1">
        {editing !== null ? (
          <input
            autoFocus
            value={editing}
            placeholder={fallback === undefined ? "default" : `default ${fmt(fallback)}`}
            aria-label={label}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              // Stopped: Escape and the arrows mean something to the window around this field.
              e.stopPropagation()
              if (e.key === "Enter") commit(e.currentTarget.value)
              else if (e.key === "Escape") {
                setEditing(null)
                hostRef.current?.focus()
              }
            }}
            className="telemetry h-[1.375rem] min-w-0 flex-1 rounded-sm border-0 bg-sunk px-2 text-center text-meta text-foreground outline-none ring-1 ring-ring placeholder:text-muted-foreground"
          />
        ) : (
          <div
            ref={hostRef}
            role="spinbutton"
            tabIndex={0}
            aria-label={label}
            aria-valuenow={shown}
            aria-valuetext={value === undefined ? `${fmt(fallback)} (engine default)` : fmt(value)}
            aria-invalid={error ? true : undefined}
            title={error ?? (value === undefined ? "Engine default. Drag, type or use the arrow keys to set a value." : "Drag, type or use the arrow keys. Delete returns to the default.")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null
            }}
            onKeyDown={onKeyDown}
            className={`flex h-[1.375rem] min-w-0 flex-1 cursor-ew-resize select-none items-center justify-between gap-2 rounded-sm px-2 transition-colors hover:bg-hover ${
              error ? "bg-selected inset-ring-1 inset-ring-destructive-quiet" : "bg-selected inset-ring-1 inset-ring-line-strong/60"
            }`}
          >
            {inlineLabel && <span className="min-w-0 truncate text-meta text-muted-foreground">{label}</span>}
            <span
              className={`telemetry ml-auto shrink-0 text-meta ${value === undefined ? "text-muted-foreground" : "text-foreground"}`}
            >
              {fmt(shown)}
              {unit && <span className="ml-1 text-muted-foreground">{unit}</span>}
            </span>
          </div>
        )}
        {allowEmpty && (
          <button
            type="button"
            onClick={() => {
              setError(null)
              onChange(undefined)
            }}
            tabIndex={value === undefined ? -1 : 0}
            title={`Back to the engine default${fallback === undefined ? "" : ` (${fmt(fallback)})`}`}
            aria-label={`Reset ${label}`}
            className={`grid size-[1.375rem] shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground ${
              value === undefined ? "invisible" : ""
            }`}
          >
            <ArrowCounterClockwise className="size-3" />
          </button>
        )}
      </div>
      {error && <p className="pt-0.5 text-meta text-destructive-quiet">{error}</p>}
    </div>
  )
}

/** A text field that commits on Enter or blur and reverts on Escape. */
export function TextField({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  className = "",
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
}) {
  const [text, setText] = useState(value)
  const editing = useRef(false)
  const cancelled = useRef(false)
  useEffect(() => {
    if (!editing.current) setText(value)
  }, [value])
  return (
    <input
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellCheck={false}
      onFocus={(e) => {
        editing.current = true
        e.currentTarget.select()
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        editing.current = false
        if (cancelled.current) {
          cancelled.current = false
          setText(value)
        } else if (text !== value) onCommit(text)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      className={`h-[1.375rem] w-full min-w-0 rounded-sm border-0 bg-sunk px-2 text-meta text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring ${className}`}
    />
  )
}

export function Checkbox({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string }) {
  return (
    <label className="flex min-h-[1.375rem] items-center gap-2 text-meta text-foreground" title={title}>
      <span className="relative grid size-3.5 shrink-0 place-items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="absolute inset-0 appearance-none rounded-[3px] bg-control inset-ring-1 inset-ring-line-strong/60 checked:bg-accent checked:inset-ring-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
        />
        {checked && <Check className="pointer-events-none relative size-2.5 text-accent-foreground" weight="bold" />}
      </span>
      {label}
    </label>
  )
}

export function Select({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  ariaLabel?: string
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="h-[1.375rem] w-full min-w-0 rounded-sm border-0 bg-selected px-1.5 text-meta text-foreground outline-none inset-ring-1 inset-ring-line-strong/60 hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: "rgb(var(--p-surface))" }}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** A block of controls under an eyebrow heading, TERRA's PanelSection. */
export function PanelSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t px-2.5 py-2.5 first:border-t-0" style={{ borderColor: "var(--hairline)" }}>
      <div className="flex items-center gap-2">
        <span className="eyebrow min-w-0 flex-1 truncate !text-foreground">{title}</span>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** A label and its control on one line. */
export function FieldRow({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(5.5rem,42%)_1fr] items-start gap-2" title={title}>
      <span className="truncate pt-[3px] text-meta text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  )
}

/** A reading: an eyebrow label on the left, a telemetry value on the right. */
export function Figure({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-px" title={title}>
      <span className="eyebrow !text-[9px] min-w-0 truncate">{label}</span>
      <span className="telemetry selectable shrink-0 text-body text-foreground">{value}</span>
    </div>
  )
}

/** A button that runs an operator, disabled with the operator's own reason when it cannot run. */
export function OperatorButton({
  name,
  args,
  label,
  primary,
  className = "",
}: {
  name: string
  args?: string[]
  label?: string
  primary?: boolean
  className?: string
}) {
  const { op, poll } = useOperator(name)
  if (!op) return null
  const IconC = op.icon
  const reason = poll === true ? undefined : poll
  const shortcut = op.keys?.[0] ? ` (${formatKeys(op.keys[0])})` : ""
  return (
    <button
      type="button"
      // aria-disabled rather than disabled: a disabled button shows no tooltip, and the reason is the tooltip.
      aria-disabled={reason ? true : undefined}
      title={reason ?? `${op.label}${shortcut}\n${op.description}`}
      onClick={() => !reason && void runOperator(name, args)}
      className={`${primary ? btnPrimary : btnGhostDense} ${className}`}
    >
      {IconC && <IconC className="size-3.5 shrink-0" />}
      <span className="truncate">{label ?? op.label}</span>
    </button>
  )
}

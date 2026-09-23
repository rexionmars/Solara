import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { completions, runOperator } from "../../lib/operators"
import { report, reports, type ReportLevel } from "../../lib/reports"
import { useStore } from "../../lib/store"

/**
 * The console itself: what the operations said, and a line to name another.
 *
 * It is a body and nothing else -- no header, no area -- so the Console
 * editor and the run graph's footer are the same console rather than two that
 * agree by accident.
 *
 * Typing reaches it only while it has focus: letters typed elsewhere stay
 * where they were typed, so single-key shortcuts and screen readers are left
 * alone.
 */

const COLOUR: Partial<Record<ReportLevel, string>> = {
  warning: "var(--warning)",
  error: "var(--destructive-quiet)",
  info: "var(--accent-quiet)",
}

// What was typed, shared by every console for the session.
const past: string[] = []

export function ConsoleBody() {
  const lines = useStore(reports)
  const [value, setValue] = useState("")
  const recall = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const completion = completions(value)[0]
  const ghost = completion && completion.length > value.trim().length ? completion : undefined

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "Enter": {
        const typed = value.trim() || past.at(-1)
        if (!typed) return
        if (value.trim()) past.push(typed)
        recall.current = null
        setValue("")
        report("input", `>>> ${typed}`)
        const [name, ...args] = typed.split(/\s+/)
        void runOperator(name, args)
        return
      }
      case "Tab":
        if (ghost) {
          e.preventDefault()
          setValue(ghost)
        }
        return
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault()
        if (!past.length) return
        const at = recall.current ?? past.length
        const next = e.key === "ArrowUp" ? Math.max(0, at - 1) : at + 1
        if (next >= past.length) {
          recall.current = null
          setValue("")
        } else {
          recall.current = next
          setValue(past[next])
        }
        return
      }
      case "Escape":
        e.stopPropagation()
        recall.current = null
        setValue("")
    }
  }

  return (
    <div
      className="telemetry flex h-full min-h-0 flex-col text-body leading-5"
      onClick={() => {
        if (!window.getSelection()?.toString()) input.current?.focus()
      }}
    >
      <div ref={scroller} role="log" aria-live="polite" className="panel-scroll selectable min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-2 pt-1">
        {lines.map((l) => (
          <div key={l.id} style={{ color: COLOUR[l.level] }} className={l.level === "operator" ? "text-muted-foreground" : l.level === "input" ? "text-foreground" : ""}>
            {l.level === "operator" ? `  ${l.text}` : l.text}
          </div>
        ))}
      </div>
      <label className="flex h-6 shrink-0 items-center gap-1.5 border-t px-2" style={{ borderColor: "var(--hairline)" }}>
        <span className="text-accent">&gt;&gt;&gt;</span>
        <span className="relative flex h-full flex-1 items-center">
          {ghost && (
            <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center text-foreground/35">
              <span className="invisible whitespace-pre">{value}</span>
              {ghost.slice(value.length)}
            </span>
          )}
          <input
            ref={input}
            value={value}
            onChange={(e) => {
              recall.current = null
              setValue(e.target.value.toUpperCase())
            }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            aria-label="Console input"
            className="relative w-full bg-transparent text-foreground outline-none"
          />
        </span>
      </label>
    </div>
  )
}

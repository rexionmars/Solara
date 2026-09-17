import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react"
import { CaretDown, CaretUp, TerminalWindow, X } from "@phosphor-icons/react"
import { commandLog } from "../../lib/commandLog"
import { completions, runCommand } from "../../lib/commands"
import { useStore } from "../../lib/store"

const LINE_COLOUR = {
  info: "text-info",
  input: "text-muted",
  error: "text-fail",
} as const

// Lines shown above the input while the history is collapsed.
const RECENT_LINES = 3

/**
 * The command line, floating over the bottom of the active document as in
 * desktop CAD: the input, the last few lines above it, and the whole history
 * on request (the caret, or F2).
 *
 * Keys follow CAD convention: Enter runs what was typed, and Enter on an empty
 * line repeats the last command; Tab accepts the completion shown in grey; the
 * arrows walk back through what was typed before; Escape clears the line.
 */
export function CommandLine({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const lines = useStore(commandLog)
  const [value, setValue] = useState("")
  const [expanded, setExpanded] = useState(false)
  const past = useRef<string[]>([])
  // Position while walking back through `past`; null when not walking.
  const recall = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, expanded])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "F2") return
      e.preventDefault()
      setExpanded((x) => !x)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const completion = completions(value)[0]
  const ghost = completion && completion.length > value.trim().length ? completion : undefined
  const visible = expanded ? lines : lines.slice(-RECENT_LINES)

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "Enter": {
        const typed = value.trim() || past.current.at(-1)
        if (!typed) return
        if (value.trim()) past.current.push(typed)
        recall.current = null
        setValue("")
        void runCommand(typed)
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
        const n = past.current.length
        if (n === 0) return
        const at = recall.current ?? n
        const next = e.key === "ArrowUp" ? Math.max(0, at - 1) : at + 1
        if (next >= n) {
          recall.current = null
          setValue("")
        } else {
          recall.current = next
          setValue(past.current[next])
        }
        return
      }
      case "Escape":
        recall.current = null
        setValue("")
        return
    }
  }

  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex w-[min(52rem,calc(100%-9rem))] -translate-x-1/2 flex-col">
      {visible.length > 0 && (
        <div
          ref={scroller}
          role="log"
          aria-live="polite"
          className={`pointer-events-auto ml-[3.75rem] overflow-y-auto whitespace-pre rounded-t-sm px-3 py-1 font-mono text-[11.5px] leading-5 ${
            expanded ? "max-h-64 border border-b-0 border-line bg-chrome/95" : "bg-chrome/75"
          }`}
        >
          {visible.map((l) => (
            <div key={l.id} className={LINE_COLOUR[l.kind]}>
              {l.text}
            </div>
          ))}
        </div>
      )}
      {/*
        CAD's floating command line: its own buttons on a dark strip, and the
        light well where typing goes.
      */}
      <div className="pointer-events-auto flex h-8 items-center gap-0.5 rounded-sm border border-sunken bg-chrome/90 p-0.5 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => void runCommand("COMMANDLINE")}
          title="Hide the command line (COMMANDLINE)"
          className="grid h-6 w-6 place-items-center rounded-sm text-muted hover:bg-hover hover:text-ink"
        >
          <X size={12} weight="bold" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          aria-expanded={expanded}
          title="Command history (F2)"
          className="grid h-6 w-6 place-items-center rounded-sm text-muted hover:bg-hover hover:text-ink"
        >
          {expanded ? (
            <CaretDown size={12} weight="bold" aria-hidden="true" />
          ) : (
            <CaretUp size={12} weight="bold" aria-hidden="true" />
          )}
        </button>
        <label className="relative ml-0.5 flex h-full flex-1 items-center gap-2 rounded-[2px] bg-field px-2 text-field-ink">
          <TerminalWindow size={15} className="shrink-0 opacity-70" aria-hidden="true" />
          <span className="relative flex h-full flex-1 items-center">
            {ghost && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center font-mono text-[12px] text-field-ink/45"
              >
                <span className="invisible whitespace-pre">{value}</span>
                {ghost.slice(value.length)}
              </span>
            )}
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => {
                recall.current = null
                setValue(e.target.value.toUpperCase())
              }}
              onKeyDown={onKeyDown}
              placeholder={ghost ? undefined : "Type a command"}
              spellCheck={false}
              autoComplete="off"
              aria-label="Command"
              className="relative w-full bg-transparent font-mono text-[12px] text-field-ink outline-none placeholder:italic placeholder:text-field-ink/55"
            />
          </span>
        </label>
      </div>
    </div>
  )
}

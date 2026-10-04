import { useEffect, useRef } from "react"
import { Info, Play, Warning, WarningOctagon, type Icon } from "../../lib/icons"
import { clearReports, reports, type ReportLevel } from "../../lib/reports"
import { areaStates, setAreaState } from "../../lib/screen"
import { useStore } from "../../lib/store"
import { AreaHeader } from "../studio/StudioArea"

/**
 * Every report the operations made, with the operations themselves, newest at
 * the foot. A toast leaves; this keeps it.
 */

const LEVELS: { level: ReportLevel; label: string; icon: Icon }[] = [
  { level: "operator", label: "Operators", icon: Play },
  { level: "info", label: "Info", icon: Info },
  { level: "warning", label: "Warnings", icon: Warning },
  { level: "error", label: "Errors", icon: WarningOctagon },
]

const COLOUR: Partial<Record<ReportLevel, string>> = { warning: "var(--warning)", error: "var(--destructive-quiet)" }

const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })

export function ReportsEditor({ areaId }: { areaId: string }) {
  const all = useStore(reports)
  const hidden = new Set((useStore(areaStates)[areaId]?.hidden as ReportLevel[] | undefined) ?? [])
  const shown = all.filter((r) => r.level !== "input" && !hidden.has(r.level))
  const scroller = useRef<HTMLDivElement>(null)
  const atFoot = useRef(true)

  useEffect(() => {
    const el = scroller.current
    if (el && atFoot.current) el.scrollTop = el.scrollHeight
  }, [shown.length])

  return (
    <>
      <AreaHeader
        menus={
          <span className="flex items-center gap-0.5">
            {LEVELS.map(({ level, label, icon: IconC }) => {
              const on = !hidden.has(level)
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={on}
                  title={`${on ? "Hide" : "Show"} ${label.toLowerCase()}`}
                  onClick={() => {
                    const next = new Set(hidden)
                    if (on) next.add(level)
                    else next.delete(level)
                    setAreaState(areaId, { hidden: [...next] })
                  }}
                  className={`flex h-5 items-center gap-1 rounded-sm px-1.5 text-meta transition-colors ${
                    on ? "bg-selected text-foreground" : "text-muted-foreground hover:bg-hover"
                  }`}
                >
                  <IconC className="size-3" />
                  <span className="header-label">{label}</span>
                </button>
              )
            })}
          </span>
        }
        options={
          <button type="button" onClick={clearReports} className="flex h-5 items-center rounded-sm px-1.5 text-meta text-muted-foreground hover:bg-hover hover:text-foreground">
            Clear
          </button>
        }
      />
      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="panel-scroll selectable h-full min-h-0 overflow-y-auto py-1"
        style={{ background: "var(--s-field)" }}
      >
        {shown.length === 0 && <p className="px-3 py-1 text-body text-muted-foreground">No reports.</p>}
        {shown.map((r) => {
          const IconC = LEVELS.find((l) => l.level === r.level)?.icon ?? Info
          return (
            <div key={r.id} className="flex items-start gap-2 px-2 py-px hover:bg-hover" style={{ color: COLOUR[r.level] }}>
              <span className="telemetry shrink-0 pt-px text-[9px] text-muted-foreground">{time(r.time)}</span>
              <IconC className={`mt-[3px] size-3 shrink-0 ${COLOUR[r.level] ? "" : "text-muted-foreground"}`} weight="fill" />
              <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${r.level === "operator" ? "telemetry text-meta text-muted-foreground" : "text-body"} ${COLOUR[r.level] ? "" : r.level === "operator" ? "" : "text-foreground"}`}>
                {r.text}
              </span>
              {r.action && (
                <button type="button" onClick={r.action.run} className="shrink-0 rounded-sm px-1.5 text-meta text-accent-quiet hover:bg-hover">
                  {r.action.label}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

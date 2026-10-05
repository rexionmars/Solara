import { Info, Warning, WarningOctagon, X } from "../../lib/icons"
import { running } from "../../lib/analysis"
import { runOperator } from "../../lib/operators"
import { PRODUCT_NAMES, project } from "../../lib/project"
import { dismissToast, toasts, type Report } from "../../lib/reports"
import { useStore } from "../../lib/store"

/**
 * Reports as TERRA raises them: panel chrome rather than coloured banners, the
 * status in the mark alone, bottom right over the work. The Reports editor
 * keeps every one after it has gone.
 *
 * The analysis in flight is the one toast that stays for as long as its
 * subject does, with its progress and a way to stop it.
 */
const TOAST =
  "pointer-events-auto relative flex w-[22rem] items-start gap-3 rounded-md border py-3 pl-3.5 pr-8 shadow-[0_10px_32px_rgb(0_0_0/0.32)]"

function Mark({ level }: { level: Report["level"] }) {
  if (level === "error") return <WarningOctagon className="mt-px size-4 shrink-0" style={{ color: "var(--destructive-quiet)" }} weight="fill" />
  if (level === "warning") return <Warning className="mt-px size-4 shrink-0" style={{ color: "var(--warning)" }} weight="fill" />
  return <Info className="mt-px size-4 shrink-0 text-muted-foreground" weight="fill" />
}

/** A report as a title and its detail: what happened, then the figures or the reason. */
function split(text: string): { title: string; detail: string | null } {
  const at = text.indexOf(": ")
  if (at > 0 && at < 72) return { title: text.slice(0, at), detail: text.slice(at + 2) }
  return { title: text, detail: null }
}

function RunToast() {
  const r = useStore(running)
  const d = useStore(project).data
  if (!r) return null
  const source = [...d.sites, ...d.areas].find((o) => o.id === r.sourceId)
  return (
    <div className={TOAST} role="status" style={{ background: "var(--s-panel)", borderColor: "rgb(var(--p-line) / 0.32)" }}>
      <span className="mt-1.5 size-1.5 shrink-0 animate-pulse rounded-[1px] bg-accent" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-emphasis font-semibold text-foreground">
          {PRODUCT_NAMES[r.product]}
          {source && <span className="font-normal text-muted-foreground"> · {source.name}</span>}
        </p>
        <div className="h-1 overflow-hidden rounded-full bg-control">
          <div
            className={`h-full bg-accent transition-[width] ${r.progress === null ? "w-1/4 animate-pulse" : ""}`}
            style={r.progress === null ? undefined : { width: `${r.progress}%` }}
          />
        </div>
        <p className="telemetry flex justify-between gap-2 text-body text-muted-foreground">
          <span className="truncate">{r.message}</span>
          {r.progress !== null && <span className="text-foreground">{r.progress}%</span>}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void runOperator("CANCEL")}
        title="Stop the analysis"
        aria-label="Stop the analysis"
        className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-sm border text-muted-foreground hover:text-foreground"
        style={{ borderColor: "rgb(var(--p-line) / 0.35)" }}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

export function Toasts() {
  const list = useStore(toasts)
  return (
    <div className="pointer-events-none fixed bottom-8 right-3 z-[1500] flex flex-col items-end gap-2" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={TOAST}
          role={t.level === "error" ? "alert" : "status"}
          style={{
            background: "var(--s-panel)",
            borderColor:
              t.level === "error"
                ? "color-mix(in srgb, var(--destructive-quiet) 35%, transparent)"
                : "rgb(var(--p-line) / 0.32)",
          }}
        >
          <Mark level={t.level} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="selectable break-words text-emphasis font-semibold text-foreground">{split(t.text).title}</p>
            {split(t.text).detail && (
              <p className="selectable break-words text-body leading-snug text-muted-foreground">{split(t.text).detail}</p>
            )}
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  dismissToast(t.id)
                  t.action?.run()
                }}
                className="mt-1 self-start rounded-sm px-1.5 py-0.5 text-meta text-accent-quiet hover:bg-hover"
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-sm border text-muted-foreground opacity-85 hover:text-foreground hover:opacity-100"
            style={{ borderColor: "rgb(var(--p-line) / 0.35)" }}
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <RunToast />
    </div>
  )
}

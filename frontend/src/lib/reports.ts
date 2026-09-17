import { createStore } from "./store"

/**
 * Reports: what operators tell the user, as Blender's operators report.
 *
 * Every report is kept in the Info editor, and the latest is shown in the
 * status bar whatever editors are open, so no message depends on a panel the
 * user may have closed. Operator lines record what was run, and input lines
 * what was typed in the Console.
 */
export type ReportLevel = "info" | "warning" | "error" | "operator" | "input"

export type ReportAction = { label: string; run: () => void }

export type Report = {
  id: number
  time: Date
  level: ReportLevel
  text: string
  action?: ReportAction
}

// Older reports are dropped past this, so a long session does not grow the
// list the Info editor renders without bound.
const MAX_REPORTS = 1000

export const reports = createStore<Report[]>([])

/** The report the status bar shows: the latest info, warning or error. */
export const lastReport = createStore<Report | null>(null)

let nextId = 0

/**
 * The reports on screen as toasts, newest last, as TERRA raises its own. A
 * toast leaves on its own; the Reports editor keeps it.
 */
export const toasts = createStore<Report[]>([])

// Four at most: past that, the stack covers the corner of the work it is about.
const MAX_TOASTS = 4
const TOAST_MS = { info: 5000, warning: 8000, error: 12000 } as const

export function dismissToast(id: number): void {
  toasts.set((list) => list.filter((t) => t.id !== id))
}

export function report(level: ReportLevel, text: string, action?: ReportAction, toast = true): void {
  const r: Report = { id: nextId++, time: new Date(), level, text, action }
  reports.set((prev) => [...prev.slice(-(MAX_REPORTS - 1)), r])
  if (toast && (level === "info" || level === "warning" || level === "error")) {
    lastReport.set(r)
    toasts.set((list) => [...list, r].slice(-MAX_TOASTS))
    window.setTimeout(() => dismissToast(r.id), TOAST_MS[level])
  }
}

export const info = (text: string, action?: ReportAction) => report("info", text, action)
/**
 * A report kept in the Reports editor and not raised as a toast: what the
 * reader has just watched happen on screen -- a site placed, a run begun --
 * does not need saying a second time over the work.
 */
export const note = (text: string) => report("info", text, undefined, false)
export const warn = (text: string, action?: ReportAction) => report("warning", text, action)
export const fail = (text: string, action?: ReportAction) => report("error", text, action)

export function clearReports(): void {
  reports.set([])
  lastReport.set(null)
  toasts.set([])
}

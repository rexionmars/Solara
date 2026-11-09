import { useMemo, useState } from "react"
import { FilePlus, FloppyDisk, FolderOpen, Graph, PencilSimple, Play, StopCircle, X } from "../../lib/icons"
import { cancelPlanning, checkStudy, planning, runPlanning, studyKey, updateStudy, type PlanningView, type Study } from "../../lib/planning"
import { formatMoment } from "../../lib/format"
import { useStore } from "../../lib/store"
import { AreaHeader } from "../shell/HeaderHosts"
import { MenuItems, StudioPopover } from "../studio/Popover"
import { btnGhost, btnPrimary } from "../ui/buttons"
import { PlanningBuild } from "./PlanningBuild"
import { PlanningResults } from "./PlanningResults"
import { Seg, moment, whole } from "./PlanningUI"
import { usePlanningFiles } from "./usePlanningFiles"

/** The study's name in the header, renamed in place. */
function StudyName({ name, disabled, onRename }: { name: string; disabled: boolean; onRename: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  if (editing) {
    const done = (keep: boolean) => {
      if (keep && draft.trim()) onRename(draft.trim())
      setEditing(false)
    }
    return (
      <input
        autoFocus
        aria-label="Study name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") done(true)
          if (e.key === "Escape") {
            e.stopPropagation()
            done(false)
          }
        }}
        className="h-7 w-64 rounded-[6px] border border-accent/60 bg-field px-2 text-heading text-foreground outline-none"
      />
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      title="Rename the study"
      onClick={() => {
        setDraft(name)
        setEditing(true)
      }}
      className="flex h-7 min-w-0 max-w-[22rem] items-center gap-2 rounded-[6px] px-1.5 text-heading text-foreground hover:bg-hover"
    >
      <span className="truncate">{name || "Untitled study"}</span>
      <PencilSimple className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

/** New, import, example and the two exports, behind one button. */
function FileMenu({ files, busy, pending, hasResult }: { files: ReturnType<typeof usePlanningFiles>; busy: boolean; pending: boolean; hasResult: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <StudioPopover
      open={open}
      onOpenChange={setOpen}
      align="end"
      widthRem={14}
      portal="viewport"
      trigger={(p) => (
        <button
          type="button"
          ref={p.ref as React.Ref<HTMLButtonElement>}
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-haspopup="menu"
          aria-label="Study file: new, import, example, export"
          title="Study file"
          className={`grid size-8 place-items-center rounded-[7px] border border-line/40 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground ${open ? "bg-selected text-foreground" : ""}`}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="currentColor">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        </button>
      )}
    >
      {open && (
        <MenuItems
          onDone={() => setOpen(false)}
          items={[
            { type: "action", label: "New study", icon: FilePlus, disabled: busy && "Optimization in progress", run: files.newStudy },
            { type: "action", label: "Import study…", icon: FolderOpen, disabled: busy && "Optimization in progress", run: files.importStudy },
            { type: "action", label: "Load synthetic example", icon: Graph, disabled: busy && "Optimization in progress", run: files.example },
            { type: "sep" },
            { type: "action", label: "Export study…", icon: FloppyDisk, disabled: pending && "Apply the profile you are editing first", run: files.exportStudy },
            { type: "action", label: "Export run report…", icon: FloppyDisk, disabled: !hasResult && "No run yet", run: files.exportReport },
          ]}
        />
      )}
    </StudioPopover>
  )
}

const plural = (n: number, one: string, many: string) => `${whole(n)} ${n === 1 ? one : many}`

/**
 * System planning: Build makes the study, Results reads a run of it.
 *
 * The header carries what applies to both: the study's name, the switch
 * between the two, whether the latest run still matches the inputs, the file
 * menu and Optimize. Optimize is held back while the draft has a fault the
 * engine would refuse or a profile edit not yet applied, and says which.
 */
export function SystemPlanningEditor() {
  const state = useStore(planning)
  const { study, busy } = state
  const files = usePlanningFiles()
  const set = (patch: Partial<Study>) => updateStudy({ ...study, ...patch })
  const issues = useMemo(() => checkStudy(study), [study])
  const pending = Object.values(state.pendingProfiles).some(Boolean)
  const view: PlanningView = state.view === "results" ? "results" : "build"
  const setView = (v: PlanningView) => planning.set((s) => ({ ...s, view: v }))
  const result = files.result
  const latest = state.results[0]
  const current = !!latest && studyKey(latest.study) === studyKey(study)
  const stale = !!result && studyKey(result.study) !== studyKey(study)
  const blocked = pending ? "Apply or cancel the profile you are editing first." : issues.length ? `Fix ${issues.length === 1 ? "one thing" : `${issues.length} things`} in Build first.` : ""

  const optimize = () => {
    planning.set((s) => ({ ...s, selectedResult: "" }))
    void runPlanning()
  }

  const head = result && (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="reading-head min-w-0 flex-[1_1_22rem]">
        {state.results.length > 1 && (
          <label className="mb-2.5 inline-flex h-7 items-center gap-2 rounded-[7px] border border-[var(--s-line)] bg-[var(--s-sunk)] px-2 text-[12px] text-[var(--s-text-muted)]">
            <span className="text-[var(--s-text)]">Run</span>
            <select
              aria-label="Choose a run"
              value={result.created_at}
              onChange={(e) => planning.set((s) => ({ ...s, selectedResult: e.target.value }))}
              className="bg-transparent text-[12px] text-[var(--s-text)] outline-none"
            >
              {state.results.map((r) => (
                <option key={r.created_at} value={r.created_at}>
                  {formatMoment(r.created_at)} · {r.study.name} · {r.study.mode}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h2>
            {result.study.mode === "expansion" ? "Capacity expansion" : "Economic dispatch"} over {plural(result.summary.hours, "hour", "hours")}
          </h2>
          {stale && (
            <span className="reading-chip" data-tone="warn">
              Inputs changed since this run
            </span>
          )}
        </div>
        <p>
          {plural(result.study.buses.length, "bus", "buses")} and {plural(result.study.lines.length, "line", "lines")},{" "}
          {plural(result.summary.snapshots, "interval", "intervals")} from {moment(result.study.snapshots[0]?.time ?? "")} UTC, costs in{" "}
          {result.study.currency}.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {stale && (
          <button type="button" disabled={busy} className={btnGhost} onClick={() => files.replace(structuredClone(result.study))} title="Replace the draft with the inputs this run used">
            Use these inputs
          </button>
        )}
        <button type="button" className={btnGhost} onClick={files.exportReport}>
          Export report
        </button>
      </div>
    </header>
  )

  return (
    <>
      <AreaHeader
        menus={
          <div className="flex min-w-0 items-center gap-3 pl-1">
            <StudyName name={study.name} disabled={busy} onRename={(name) => set({ name })} />
            <Seg
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: "build", label: "Build" },
                { value: "results", label: "Results" },
              ]}
            />
          </div>
        }
        options={
          <div className="flex items-center gap-2.5">
            {busy ? (
              <>
                <span role="status" className="max-w-[16rem] truncate text-emphasis text-muted-foreground">
                  {state.message || "Optimizing…"}
                </span>
                <progress aria-label="Planning progress" className="h-1.5 w-24 accent-[var(--accent)]" max={100} value={state.progress} />
              </>
            ) : (
              latest && (
                <span className="flex items-center gap-2 text-emphasis text-muted-foreground">
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: current ? "rgb(var(--p-olive-light))" : "rgb(var(--p-line-strong))" }} />
                  {current ? "The latest run matches these inputs" : "Inputs changed since the latest run"}
                </span>
              )
            )}
            <FileMenu files={files} busy={busy} pending={pending} hasResult={!!result} />
            {busy ? (
              <button type="button" disabled={state.cancelling} className={btnGhost} onClick={() => void cancelPlanning()}>
                <StopCircle className="size-3.5" />
                {state.cancelling ? "Cancelling…" : "Cancel"}
              </button>
            ) : (
              <button type="button" className={`${btnPrimary} !px-4`} disabled={!!blocked} title={blocked || "Solve the study with PyPSA and HiGHS"} onClick={optimize}>
                <Play className="size-3" weight="fill" />
                Optimize
              </button>
            )}
          </div>
        }
      />
      {files.input}
      <div className="flex min-h-0 flex-1 flex-col text-foreground">
        {(state.error || state.notice) && (
          <div
            role={state.error ? "alert" : "status"}
            className={`flex shrink-0 items-start gap-3 border-b border-line/25 px-4 py-2 text-emphasis ${state.error ? "bg-destructive/15 text-destructive-quiet" : "bg-panel text-muted-foreground"}`}
          >
            <span className="min-w-0 flex-1">{state.error || state.notice}</span>
            <button type="button" aria-label="Dismiss" className="grid size-5 place-items-center rounded-sm hover:bg-hover" onClick={() => planning.set((s) => ({ ...s, error: "", notice: "" }))}>
              <X className="size-3" />
            </button>
          </div>
        )}
        {view === "build" ? (
          <PlanningBuild study={study} set={set} onExample={files.example} onImport={files.importStudy} />
        ) : result ? (
          <div className="reading min-h-0 flex-1 overflow-auto" style={{ background: "var(--s-panel)" }}>
            <div className="reading-page" style={{ maxWidth: 1180 }}>
              <PlanningResults key={result.created_at} result={result} head={head} />
            </div>
          </div>
        ) : (
          <div className="grid flex-1 place-items-center bg-panel px-6 text-center">
            <div className="flex max-w-[28rem] flex-col items-center gap-2">
              <p className="text-heading text-foreground">{busy ? "Optimizing…" : "No run yet"}</p>
              <p className="text-emphasis text-muted-foreground">
                {busy ? state.message : blocked || "Optimize the study to read its dispatch, the capacity it adds and the cost."}
              </p>
              {!busy && !blocked && (
                <button type="button" className={`${btnPrimary} mt-2 !px-4`} onClick={optimize}>
                  <Play className="size-3" weight="fill" />
                  Optimize
                </button>
              )}
              {!busy && blocked && (
                <button type="button" className={`${btnGhost} mt-2`} onClick={() => setView("build")}>
                  Go to Build
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

import { OpenProject, SaveProject, SetProjectDirty } from "../../wailsjs/go/main/App"
import { WindowSetTitle } from "../../wailsjs/runtime/runtime"
import { errorMessage } from "./errors"
import {
  emptyProject,
  loadProject,
  markSaved,
  project,
  runIdOf,
  type ProjectData,
  type ResultObject,
} from "./project"
import { fail, info, note } from "./reports"
import { select } from "./selection"
import { createStore } from "./store"
import { ask, lastOperation } from "./ui"

/**
 * The project on disk: a JSON document, `name.solara`, and beside it a
 * `name.solara-data` folder holding the rasters the terrain results were drawn
 * from. The Go side owns the folder (app_project.go); this module owns the
 * document.
 */

const FORMAT = "terra-energy-project"
const VERSION = 1

type ProjectDocument = ProjectData & { format: string; version: number; savedAt: string }

const PROJECT_EXT = /\.solara$/i

/** A project's name from its path: the file name without the extension. */
export function nameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(PROJECT_EXT, "")
}

// ---- Recent files -----------------------------------------------------------

const RECENT_KEY = "terra-energy.recent.v1"
const MAX_RECENT = 10

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
    // Only .solara: the shell refuses anything else, so a .terra path left from
    // before the extension changed would sit in the list failing to open.
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string" && PROJECT_EXT.test(p)) : []
  } catch {
    return []
  }
}

export const recentFiles = createStore<string[]>(readRecent())

function remember(path: string): void {
  recentFiles.set((list) => [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENT))
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentFiles.get()))
  } catch {
    /* the list is a convenience */
  }
}

export function clearRecent(): void {
  recentFiles.set([])
  try {
    localStorage.removeItem(RECENT_KEY)
  } catch {
    /* as above */
  }
}

// ---- Title and dirty flag ---------------------------------------------------

/**
 * Keep the window title and the Go side's unsaved flag in step with the
 * project. The flag is what makes closing the window ask first.
 */
export function watchProjectState(): () => void {
  let last = ""
  const sync = () => {
    const p = project.get()
    const title = `${p.dirty ? "* " : ""}${p.data.name} - Solara`
    if (title === last) return
    const dirtyChanged = last === "" || last.startsWith("* ") !== p.dirty
    last = title
    WindowSetTitle(title)
    if (dirtyChanged) void SetProjectDirty(p.dirty).catch(() => {})
  }
  sync()
  return project.subscribe(sync)
}

// ---- Save -------------------------------------------------------------------

async function write(path: string): Promise<boolean> {
  const data = project.get().data
  // Every result that drew a layer, not only the terrain ones: the demand
  // layer lives in a run directory too, and a project saved without it
  // reopens with a raster nothing serves.
  const runIds = data.results.map(runIdOf).filter((id): id is string => !!id)
  const doc: ProjectDocument = { format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), ...data }
  try {
    const saved = await SaveProject(path, JSON.stringify(doc, null, 2), runIds)
    if (!saved) return false
    const name = nameFromPath(saved)
    markSaved(saved, name)
    remember(saved)
    info(`Saved "${saved}".`)
    return true
  } catch (e) {
    fail(`Could not save: ${errorMessage(e)}`)
    return false
  }
}

export const saveProject = () => write(project.get().path ?? "")
export const saveProjectAs = () => write("")

/**
 * Before the project is replaced: nothing to ask when it is saved, otherwise
 * Blender's question. Resolves true when it is safe to go on.
 */
export async function settleUnsaved(): Promise<boolean> {
  const p = project.get()
  if (!p.dirty) return true
  const answer = await ask(
    "Save changes before closing?",
    `${p.data.name} has unsaved changes. They are lost if you don't save them.`,
    [
      { label: "Don't Save", value: "discard", danger: true },
      { label: "Cancel", value: "cancel" },
      { label: "Save", value: "save", primary: true },
    ]
  )
  if (answer === "save") return saveProject()
  return answer === "discard"
}

// ---- New and open -----------------------------------------------------------

export async function newProject(): Promise<void> {
  if (!(await settleUnsaved())) return
  loadProject(emptyProject(), null)
  select(null)
  lastOperation.set(null)
  note("New project.")
}

function joinPath(dir: string, file: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/"
  return dir.endsWith(sep) ? dir + file : dir + sep + file
}

function parse(content: string, runDirs: Record<string, string>): ProjectData {
  const doc = JSON.parse(content) as Partial<ProjectDocument>
  if (doc.format !== FORMAT) throw new Error("not a Solara project")
  if (typeof doc.version !== "number" || doc.version > VERSION) {
    throw new Error(`made by a newer version (format ${doc.version})`)
  }
  const base = emptyProject()
  const results = (doc.results ?? []).map((r) => {
    if (r.kind !== "terrain") return r
    // The raster lives in this session's results directory now, under the
    // same run id; its old absolute path named the session that saved it.
    const id = runIdOf(r)
    const dir = id ? runDirs[id] : undefined
    if (!dir) return r
    const file = r.data.raster_tif.split(/[\\/]/).pop() ?? ""
    return { ...r, data: { ...r.data, raster_tif: joinPath(dir, file) } }
  })
  return {
    name: doc.name ?? base.name,
    sites: doc.sites ?? [],
    areas: doc.areas ?? [],
    results: results as ResultObject[],
    settings: { ...base.settings, ...doc.settings },
  }
}

export async function openProject(path = ""): Promise<void> {
  if (!(await settleUnsaved())) return
  try {
    const opened = await OpenProject(path)
    if (!opened) return
    const data = parse(opened.content, opened.run_dirs ?? {})
    loadProject({ ...data, name: nameFromPath(opened.path) }, opened.path)
    select(null)
    lastOperation.set(null)
    remember(opened.path)
    info(
      `Opened "${opened.path}": ${data.sites.length} sites, ${data.areas.length} areas, ${data.results.length} results.`
    )
  } catch (e) {
    const msg = errorMessage(e)
    fail(`Could not open ${path ? `"${path}"` : "the project"}: ${msg}`)
    if (path && /no such file|cannot find/i.test(msg)) {
      recentFiles.set((list) => list.filter((p) => p !== path))
    }
  }
}

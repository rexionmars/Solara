import type { energy, grid } from "../../wailsjs/go/models"
import { createStore } from "./store"

/**
 * The project: every site, area and result the user has made, and the
 * analysis settings they were made with. One file on disk (see projectFile.ts),
 * one undo history in memory.
 *
 * The model follows Blender's: objects (sites and areas) live in the project,
 * and each result hangs off the object it was computed at, as mesh data and
 * modifiers hang off an object. A result keeps a copy of where it was computed
 * and with which parameters, so moving the site or changing a setting later
 * marks the result stale instead of silently relabelling it.
 *
 * Every change goes through `commit`, which records the previous state for
 * undo. The data is never mutated in place: each commit builds a new object,
 * so an undo step costs a reference, not a copy.
 */

export type LonLat = { lon: number; lat: number }
export type Polygon = { type: "Polygon"; coordinates: number[][][] }

export type SiteObject = { kind: "site"; id: string; name: string; lon: number; lat: number; hidden: boolean }
export type AreaObject = { kind: "area"; id: string; name: string; polygon: Polygon; hidden: boolean }
export type SceneObject = SiteObject | AreaObject

/*
  Parameters. Undefined means "the sidecar's default": no default is written in
  the interface, which shows the values the sidecar reports (defaults.ts).
*/
export type SolarParams = {
  climatologyYears?: number
  hourlyYears?: number
  surfaceAzimuth?: number
  performanceRatio?: number
}
export type WindParams = {
  recordYears?: number
  hubHeightM?: number
  calmThresholdMS?: number
  recordMaxFloorMS?: number
  roughnessLowM?: number
  roughnessHighM?: number
}
export type TerrainParams = { hourlyYears?: number; season?: string }
export type ConnectionParams = { searchRadiusKm?: number }
/**
 * The demand reading's settings. The yield ceiling is what a generator of the
 * area is audited against; left empty, the sidecar applies its own convention
 * and says so in the reading.
 */
export type DemandParams = { yieldCeilingKWhKWp?: number; cellKm?: number }
export type Settings = {
  solar: SolarParams
  wind: WindParams
  terrain: TerrainParams
  connection: ConnectionParams
  demand: DemandParams
}

type ResultBase = {
  id: string
  name: string
  /** The site or area it was computed at, which may since have been deleted. */
  sourceId: string
  createdAt: string
  hidden: boolean
}
export type SolarResult = ResultBase & { kind: "solar"; site: LonLat; params: SolarParams; data: energy.SolarAnalysis }
export type WindResult = ResultBase & { kind: "wind"; site: LonLat; params: WindParams; data: energy.WindAnalysis }
export type TerrainResult = ResultBase & {
  kind: "terrain"
  polygon: Polygon
  params: TerrainParams
  data: energy.SolarTerrainAnalysis
  opacity: number
}
/** Where an area could join the transmission network, read from the grid store. */
export type ConnectionResult = ResultBase & {
  kind: "connection"
  polygon: Polygon
  params: ConnectionParams
  data: grid.ConnectionAnalysis
}
/** What the area already draws from the network, read from the BDGD register. */
export type DemandResult = ResultBase & {
  kind: "demand"
  polygon: Polygon
  params: DemandParams
  data: grid.DemandAnalysis
  /** Of its density layer on the map, as the terrain layer has one. */
  opacity: number
}
export type ResultObject = SolarResult | WindResult | TerrainResult | ConnectionResult | DemandResult
export type Product = ResultObject["kind"]

export const PRODUCT_NAMES: Record<Product, string> = {
  solar: "Solar resource",
  wind: "Wind screening",
  terrain: "Solar terrain",
  connection: "Grid connection",
  demand: "Area consumption",
}

/**
 * What each product is, in one sentence, from here and nowhere else.
 *
 * ONE SOURCE BECAUSE IT IS ASKED IN TWO PLACES. The properties card and the
 * empty reading both have to answer "what does this do", and while each kept
 * its own wording the reading's screen described the button and the card
 * described the product. A reader who saw only the reading never got the
 * answer.
 *
 * CONSUMPTION IS NOT DEMAND, and the wording keeps them apart on purpose. The
 * register carries monthly energy, ENE_01..12; demand in this sector is kW at
 * an instant, and the register's own DEM_ columns -- which exist in medium and
 * high voltage -- are not read by this product. Calling it demand would
 * promise a quantity it does not carry.
 */
export const PRODUCT_SUMMARY: Record<Product, string> = {
  solar: "NASA POWER at the site's radiation cell; the photovoltaic yield with pvlib.",
  wind: "MERRA-2 at the site's cell, extrapolated to hub height. Gross and unvalidated: a screening.",
  terrain: "Plane-of-array irradiation over the area's 30 m terrain, with horizon shading. Draws a layer.",
  connection:
    "Where the area could join the transmission network, and what the plants already joined there lost. Read from the grid store.",
  demand:
    "What this area already draws from the network and already puts back, counted from the distributor's BDGD register, with the share of that register its own generators contradict.",
}

/** The products read over an area rather than at a site. */
export type AreaResult = TerrainResult | ConnectionResult | DemandResult
export const isAreaProduct = (p: Product): p is AreaResult["kind"] =>
  p === "terrain" || p === "connection" || p === "demand"
export const isAreaResult = (r: ResultObject): r is AreaResult => isAreaProduct(r.kind)

export type ProjectData = {
  name: string
  sites: SiteObject[]
  areas: AreaObject[]
  results: ResultObject[]
  settings: Settings
}

type UndoStep = { label: string; data: ProjectData }

export type ProjectState = {
  data: ProjectData
  /** The file it was last saved to or opened from; null for a new project. */
  path: string | null
  dirty: boolean
  undo: UndoStep[]
  redo: UndoStep[]
}

// Deep enough for an afternoon's work; each step shares all unchanged data.
const MAX_UNDO = 128

// Edits with the same label this close together are one undo step, so typing
// "110" into a field is one step, not three.
const COALESCE_MS = 1200

export function emptyProject(): ProjectData {
  return {
    name: "Untitled",
    sites: [],
    areas: [],
    results: [],
    settings: { solar: {}, wind: {}, terrain: {}, connection: {}, demand: {} },
  }
}

export const project = createStore<ProjectState>({
  data: emptyProject(),
  path: null,
  dirty: false,
  undo: [],
  redo: [],
})

let lastCommit = { label: "", at: 0 }

/**
 * Apply a change as one undo step named `label`. `coalesce` merges it into the
 * previous step when that had the same label and was moments ago.
 */
export function commit(label: string, change: (d: ProjectData) => ProjectData, coalesce = false): void {
  const now = Date.now()
  project.set((p) => {
    const next = change(p.data)
    if (next === p.data) return p
    const merge = coalesce && lastCommit.label === label && now - lastCommit.at < COALESCE_MS && p.undo.length > 0
    const undo = merge ? p.undo : [...p.undo, { label, data: p.data }].slice(-MAX_UNDO)
    return { ...p, data: next, dirty: true, undo, redo: [] }
  })
  lastCommit = { label, at: now }
}

/**
 * Record an undo step without changing anything yet, for a change made over
 * many frames (dragging a site). The frames then go through `mutate`.
 */
export function beginStep(label: string): void {
  project.set((p) => ({ ...p, undo: [...p.undo, { label, data: p.data }].slice(-MAX_UNDO), redo: [] }))
  lastCommit = { label: "", at: 0 }
}

/** Change the data without an undo step of its own; see beginStep. */
export function mutate(change: (d: ProjectData) => ProjectData): void {
  project.set((p) => ({ ...p, data: change(p.data), dirty: true }))
}

export function undo(): string | null {
  const p = project.get()
  const step = p.undo.at(-1)
  if (!step) return null
  project.set({
    ...p,
    data: step.data,
    dirty: true,
    undo: p.undo.slice(0, -1),
    redo: [...p.redo, { label: step.label, data: p.data }],
  })
  lastCommit = { label: "", at: 0 }
  return step.label
}

export function redo(): string | null {
  const p = project.get()
  const step = p.redo.at(-1)
  if (!step) return null
  project.set({
    ...p,
    data: step.data,
    dirty: true,
    redo: p.redo.slice(0, -1),
    undo: [...p.undo, { label: step.label, data: p.data }],
  })
  lastCommit = { label: "", at: 0 }
  return step.label
}

/** Replace the whole project, as New and Open do. Clears the history. */
export function loadProject(data: ProjectData, path: string | null): void {
  project.set({ data, path, dirty: false, undo: [], redo: [] })
  lastCommit = { label: "", at: 0 }
}

export function markSaved(path: string, name: string): void {
  project.set((p) => ({ ...p, path, dirty: false, data: { ...p.data, name } }))
}

// ---- Ids and names ----------------------------------------------------------

export function newId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** `base`, or `base.001`, `base.002`… as Blender names a duplicate. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken)
  if (!names.has(base)) return base
  for (let i = 1; ; i++) {
    const candidate = `${base}.${String(i).padStart(3, "0")}`
    if (!names.has(candidate)) return candidate
  }
}

export function allNames(d: ProjectData): string[] {
  return [...d.sites, ...d.areas, ...d.results].map((o) => o.name)
}

// ---- Lookups ----------------------------------------------------------------

export type AnyItem = SceneObject | ResultObject

export function findItem(d: ProjectData, id: string | null): AnyItem | null {
  if (!id) return null
  return (
    d.sites.find((s) => s.id === id) ??
    d.areas.find((a) => a.id === id) ??
    d.results.find((r) => r.id === id) ??
    null
  )
}

export function isResult(item: AnyItem | null): item is ResultObject {
  return (
    !!item &&
    (item.kind === "solar" ||
      item.kind === "wind" ||
      item.kind === "terrain" ||
      item.kind === "connection" ||
      item.kind === "demand")
  )
}

export function resultsOf(d: ProjectData, sourceId: string): ResultObject[] {
  return d.results.filter((r) => r.sourceId === sourceId)
}

/**
 * A result's run id, from the URL its layer is served at, or null where it
 * drew no layer. What the run directory holds is saved beside the project, so
 * a reopened project still finds its rasters.
 */
export function runIdOf(r: ResultObject): string | null {
  const url = r.kind === "terrain" ? r.data.overlay_url : r.kind === "demand" ? r.data.density?.overlay_url : null
  const m = url?.match(/^\/results\/([^/]+)\//)
  return m ? m[1] : null
}

// ---- Edits ------------------------------------------------------------------

export function renameItem(id: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  commit("Rename", (d) => {
    const item = findItem(d, id)
    if (!item || item.name === trimmed) return d
    const taken = allNames(d).filter((n) => n !== item.name)
    const unique = uniqueName(trimmed, taken)
    return mapItem(d, id, (o) => ({ ...o, name: unique }))
  })
}

export function setHidden(id: string, hidden: boolean): void {
  commit(hidden ? "Hide" : "Show", (d) => mapItem(d, id, (o) => ({ ...o, hidden })))
}

/** Delete an object with its results, or one result. */
export function deleteItem(id: string): AnyItem | null {
  const item = findItem(project.get().data, id)
  if (!item) return null
  commit("Delete", (d) => ({
    ...d,
    sites: d.sites.filter((s) => s.id !== id),
    areas: d.areas.filter((a) => a.id !== id),
    results: d.results.filter((r) => r.id !== id && r.sourceId !== id),
  }))
  return item
}

export function mapItem(d: ProjectData, id: string, change: <T extends AnyItem>(o: T) => T): ProjectData {
  if (d.sites.some((s) => s.id === id)) return { ...d, sites: d.sites.map((s) => (s.id === id ? change(s) : s)) }
  if (d.areas.some((a) => a.id === id)) return { ...d, areas: d.areas.map((a) => (a.id === id ? change(a) : a)) }
  if (d.results.some((r) => r.id === id)) return { ...d, results: d.results.map((r) => (r.id === id ? change(r) : r)) }
  return d
}

// ---- Staleness --------------------------------------------------------------

function sameParams(a: object, b: object): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false
  }
  return true
}

function samePolygon(a: Polygon, b: Polygon): boolean {
  return JSON.stringify(a.coordinates) === JSON.stringify(b.coordinates)
}

/**
 * Why a result no longer describes its source as it stands, or null when it
 * still does. Read on screen beside the result, never used to hide it.
 */
export function staleReason(d: ProjectData, r: ResultObject): string | null {
  const source = findItem(d, r.sourceId)
  if (!source) return isAreaResult(r) ? "Its area has been deleted" : "Its site has been deleted"
  if (isAreaResult(r)) {
    if (source.kind !== "area" || !samePolygon(source.polygon, r.polygon)) return "The area has been redrawn since this run"
    if (!sameParams(d.settings[r.kind], r.params)) {
      return `The ${PRODUCT_NAMES[r.kind].toLowerCase()} settings have changed since this run`
    }
    return null
  }
  if (source.kind !== "site" || source.lon !== r.site.lon || source.lat !== r.site.lat) {
    return "The site has moved since this run"
  }
  const current = r.kind === "solar" ? d.settings.solar : d.settings.wind
  if (!sameParams(current, r.params)) {
    return `The ${r.kind} settings have changed since this run`
  }
  return null
}

import { ChartBar, Cube, Fan, Graph, Mountains, PlugsConnected, Sun, Table, TerminalWindow, type Icon } from "./icons"
import { EDITORS, editorMeta, type EditorId, type StudioGroup } from "./editors"
import type { Product } from "./project"
import { select } from "./selection"
import { createStore } from "./store"

/**
 * The studio's arrangement, as TERRA's: named workspaces, each a tree of
 * areas split in rows and columns, each area holding one editor.
 *
 * Presets are not user data. Moving a division or retyping an area changes
 * the live tree, which is kept in this browser's storage so the arrangement
 * survives a restart; Reset puts a workspace back the way it ships.
 */

export type { EditorId } from "./editors"

export type AreaNode = { type: "area"; id: string; editor: EditorId }
export type SplitNode = {
  type: "split"
  id: string
  /** row: side by side; col: stacked. */
  dir: "row" | "col"
  /** Where the division falls, as the share of the first child. */
  ratio: number
  a: LayoutNode
  b: LayoutNode
}
export type LayoutNode = AreaNode | SplitNode

export type WorkspacePreset = {
  id: string
  label: string
  group: StudioGroup
  hint: string
  /** The glyph of the editor the arrangement is built around. */
  icon: Icon
  build: () => LayoutNode
}

export type ScreenState = {
  /** The live tree per workspace, when it differs from the preset. */
  trees: Record<string, LayoutNode>
  active: string
  /** An area shown alone over its workspace (Ctrl Space), or null. */
  maximized: string | null
}

let counter = 0
const nid = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`

const area = (editor: EditorId): AreaNode => ({ type: "area", id: nid("a"), editor })
const split = (dir: "row" | "col", ratio: number, a: LayoutNode, b: LayoutNode): SplitNode => ({
  type: "split",
  id: nid("s"),
  dir,
  ratio,
  a,
  b,
})

/** The column every workspace keeps at its right: what is in the project over what is active. */
const sideColumn = () => split("col", 0.42, area("outliner"), area("properties"))

/*
  The fractions are chosen against the application's minimum window of 960x600,
  so no preset is born with an area under its editor's own floor.
*/
export const WORKSPACES: WorkspacePreset[] = [
  {
    id: "layout",
    label: "Layout",
    group: "board",
    icon: Cube,
    hint: "The map at full size, the project beside it and the reports under it",
    build: () => split("row", 0.76, split("col", 0.82, area("map"), area("reports")), sideColumn()),
  },
  {
    id: "graph",
    label: "Graph",
    group: "board",
    icon: Graph,
    hint: "The run graph beside the map: set a run up card by card, and see what the reading read",
    build: () => split("row", 0.76, split("col", 0.8, split("row", 0.36, area("map"), area("graph")), area("reports")), sideColumn()),
  },
  {
    id: "data",
    label: "Data",
    group: "board",
    icon: Table,
    hint: "Every result of a product in one table, over the map of where they were computed",
    build: () => split("row", 0.76, split("col", 0.52, area("table"), area("map")), sideColumn()),
  },
  {
    id: "scripting",
    label: "Scripting",
    group: "board",
    icon: TerminalWindow,
    hint: "The console and the reports beside the map",
    build: () =>
      split("row", 0.76, split("col", 0.6, area("map"), split("row", 0.55, area("console"), area("reports"))), sideColumn()),
  },
  {
    id: "solar",
    label: "Resource",
    group: "solar",
    icon: Sun,
    hint: "The solar resource at a site, read beside the map",
    build: () => split("row", 0.74, split("row", 0.4, area("map"), area("solar")), sideColumn()),
  },
  {
    id: "terrain",
    label: "Terrain",
    group: "solar",
    icon: Mountains,
    hint: "The irradiation over an area's terrain, with its layer on the map",
    build: () => split("row", 0.74, split("row", 0.5, area("map"), area("terrain")), sideColumn()),
  },
  {
    id: "wind",
    label: "Screening",
    group: "wind",
    icon: Fan,
    hint: "The wind screening at a site, read beside the map",
    build: () => split("row", 0.74, split("row", 0.4, area("map"), area("wind")), sideColumn()),
  },
  {
    id: "connection",
    label: "Connection",
    group: "grid",
    icon: PlugsConnected,
    hint: "Where an area could join the transmission network, beside the map of plants and lines",
    build: () => split("row", 0.74, split("row", 0.55, area("map"), area("connection")), sideColumn()),
  },
  {
    id: "demand",
    label: "Demand",
    group: "grid",
    icon: ChartBar,
    hint: "What an area already draws from the network, beside the map",
    build: () => split("row", 0.74, split("row", 0.55, area("map"), area("demand")), sideColumn()),
  },
]

const STORAGE_KEY = "terra-energy.studio.v2"

function validNode(n: LayoutNode): boolean {
  if (n?.type === "area") return typeof n.id === "string" && EDITORS.some((e) => e.id === n.editor)
  if (n?.type === "split") return validNode(n.a) && validNode(n.b) && n.ratio > 0 && n.ratio < 1
  return false
}

function restore(): ScreenState {
  const fallback: ScreenState = { trees: {}, active: "layout", maximized: null }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as ScreenState | null
    if (!parsed || typeof parsed.trees !== "object") return fallback
    const trees: Record<string, LayoutNode> = {}
    for (const [id, tree] of Object.entries(parsed.trees)) {
      if (WORKSPACES.some((w) => w.id === id) && validNode(tree)) trees[id] = tree
    }
    const active = WORKSPACES.some((w) => w.id === parsed.active) ? parsed.active : "layout"
    return { trees, active, maximized: null }
  } catch {
    return fallback
  }
}

export const screen = createStore<ScreenState>(restore())

let saveTimer: number | undefined
screen.subscribe(() => {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...screen.get(), maximized: null }))
    } catch {
      /* the arrangement is a convenience; the next launch starts from the presets */
    }
  }, 250)
})

/*
  Built once per workspace and remembered, so an untouched preset keeps stable
  area ids for the session -- the per-area state (a pinned result, a filter)
  is keyed by them.
*/
const built = new Map<string, LayoutNode>()

export function workspaceTree(id: string): LayoutNode {
  const s = screen.get()
  if (s.trees[id]) return s.trees[id]
  let tree = built.get(id)
  if (!tree) {
    tree = (WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0]).build()
    built.set(id, tree)
  }
  return tree
}

export function activeWorkspace(): WorkspacePreset {
  return WORKSPACES.find((w) => w.id === screen.get().active) ?? WORKSPACES[0]
}

export function activeTree(): LayoutNode {
  return workspaceTree(screen.get().active)
}

export function setWorkspace(id: string): void {
  screen.set((s) => (s.active === id ? s : { ...s, active: id, maximized: null }))
}

export function cycleWorkspace(step: 1 | -1): void {
  const i = WORKSPACES.findIndex((w) => w.id === screen.get().active)
  setWorkspace(WORKSPACES[(i + step + WORKSPACES.length) % WORKSPACES.length].id)
}

function mapNode(n: LayoutNode, id: string, change: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (n.id === id) return change(n)
  if (n.type === "split") {
    const a = mapNode(n.a, id, change)
    const b = mapNode(n.b, id, change)
    return a === n.a && b === n.b ? n : { ...n, a, b }
  }
  return n
}

function updateActive(change: (root: LayoutNode) => LayoutNode): void {
  const id = screen.get().active
  const next = change(workspaceTree(id))
  screen.set((s) => ({ ...s, trees: { ...s.trees, [id]: next } }))
}

export function leaves(n: LayoutNode): AreaNode[] {
  return n.type === "area" ? [n] : [...leaves(n.a), ...leaves(n.b)]
}

export function findArea(id: string | null): AreaNode | null {
  if (!id) return null
  return leaves(activeTree()).find((a) => a.id === id) ?? null
}

/** Editors that may be in one area only and already are, in the active workspace. */
export function takenUnique(): Set<EditorId> {
  return new Set(leaves(activeTree()).filter((a) => editorMeta(a.editor).unique).map((a) => a.editor))
}

export function setRatio(splitId: string, ratio: number): void {
  const clamped = Math.min(0.95, Math.max(0.05, ratio))
  updateActive((root) => mapNode(root, splitId, (n) => (n.type === "split" ? { ...n, ratio: clamped } : n)))
}

export function setEditor(areaId: string, editor: EditorId): void {
  const current = findArea(areaId)
  if (!current || current.editor === editor) return
  if (editorMeta(editor).unique && takenUnique().has(editor)) return
  updateActive((root) => mapNode(root, areaId, (n) => ({ ...(n as AreaNode), editor })))
}

/** Split an area in two; the new half takes the same editor, or the reports where that one is unique. */
export function splitArea(areaId: string, dir: "row" | "col"): void {
  updateActive((root) =>
    mapNode(root, areaId, (n) => {
      const a = n as AreaNode
      return split(dir, 0.5, a, area(editorMeta(a.editor).unique ? "reports" : a.editor))
    })
  )
}

/** Close an area; its neighbour takes the space. The last area cannot be closed. */
export function closeArea(areaId: string): void {
  updateActive((root) => {
    const remove = (n: LayoutNode): LayoutNode => {
      if (n.type !== "split") return n
      if (n.a.id === areaId) return n.b
      if (n.b.id === areaId) return n.a
      const a = remove(n.a)
      const b = remove(n.b)
      return a === n.a && b === n.b ? n : { ...n, a, b }
    }
    return remove(root)
  })
  screen.set((s) => (s.maximized === areaId ? { ...s, maximized: null } : s))
}

export function toggleMaximized(areaId: string | null): void {
  screen.set((s) => ({ ...s, maximized: s.maximized || !areaId ? null : areaId }))
}

export function resetWorkspace(): void {
  const id = screen.get().active
  built.delete(id)
  screen.set((s) => {
    const trees = { ...s.trees }
    delete trees[id]
    return { ...s, trees, maximized: null }
  })
}

// ---- Geometry ---------------------------------------------------------------

export type Rect = { x: number; y: number; w: number; h: number }

/** The gap of the window's own ground between two areas, which is what says they are two. */
export const AREA_GUTTER_PX = 5
/** The corner the gap turns, cut on each area's own box. */
export const AREA_RADIUS_PX = 6

export type Seam = { id: string; dir: "row" | "col"; bounds: Rect; ratio: number }

/**
 * Every area's rectangle and every division's line, from one walk of the tree.
 *
 * Nothing is stored: a leaf's position is a consequence of the splits above
 * it. Each area is inset by half the gap inside its own rectangle and the
 * viewport by half before anything is computed, so the gap is the same
 * between two areas as at the window's edge -- and each division runs down
 * the middle of the gap it resizes.
 */
export function areaRects(root: LayoutNode, viewport: Rect, gutter = AREA_GUTTER_PX) {
  const half = gutter / 2
  const out: { leaves: (AreaNode & { rect: Rect })[]; seams: Seam[] } = { leaves: [], seams: [] }
  const walk = (n: LayoutNode, r: Rect) => {
    if (n.type === "area") {
      out.leaves.push({ ...n, rect: { x: r.x + half, y: r.y + half, w: Math.max(0, r.w - gutter), h: Math.max(0, r.h - gutter) } })
      return
    }
    out.seams.push({ id: n.id, dir: n.dir, bounds: r, ratio: n.ratio })
    if (n.dir === "row") {
      const w = r.w * n.ratio
      walk(n.a, { x: r.x, y: r.y, w, h: r.h })
      walk(n.b, { x: r.x + w, y: r.y, w: r.w - w, h: r.h })
    } else {
      const h = r.h * n.ratio
      walk(n.a, { x: r.x, y: r.y, w: r.w, h })
      walk(n.b, { x: r.x, y: r.y + h, w: r.w, h: r.h - h })
    }
  }
  walk(root, { x: viewport.x + half, y: viewport.y + half, w: Math.max(0, viewport.w - gutter), h: Math.max(0, viewport.h - gutter) })
  return out
}

/** The ids of every split inside one, so a division is never snapped to its own descendants. */
export function splitsWithin(root: LayoutNode, splitId: string): Set<string> {
  const found = new Set<string>()
  const collect = (n: LayoutNode) => {
    if (n.type !== "split") return
    found.add(n.id)
    collect(n.a)
    collect(n.b)
  }
  const locate = (n: LayoutNode): void => {
    if (n.type !== "split") return
    if (n.id === splitId) {
      collect(n.a)
      collect(n.b)
      return
    }
    locate(n.a)
    locate(n.b)
  }
  locate(root)
  return found
}

// ---- The area under the pointer ---------------------------------------------

/**
 * Where the pointer is. Shortcuts go to the editor under the pointer, as in
 * Blender: X over the map deletes the active object, X over the reports does
 * nothing.
 */
export const hoveredArea = createStore<{ id: string | null; editor: EditorId | null }>({ id: null, editor: null })

// ---- Per-area editor state --------------------------------------------------

/** What each area remembers about its editor: a pinned result, a filter, a mode. */
export type AreaState = Record<string, unknown>

const AREA_STATE_KEY = "terra-energy.areas.v2"

function restoreAreaState(): Record<string, AreaState> {
  try {
    return JSON.parse(localStorage.getItem(AREA_STATE_KEY) ?? "{}") as Record<string, AreaState>
  } catch {
    return {}
  }
}

export const areaStates = createStore<Record<string, AreaState>>(restoreAreaState())

let areaSaveTimer: number | undefined
areaStates.subscribe(() => {
  window.clearTimeout(areaSaveTimer)
  areaSaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(AREA_STATE_KEY, JSON.stringify(areaStates.get()))
    } catch {
      /* as for the arrangement */
    }
  }, 250)
})

export function setAreaState(areaId: string, patch: AreaState): void {
  areaStates.set((all) => ({ ...all, [areaId]: { ...all[areaId], ...patch } }))
}

// ---- Navigation between editors ---------------------------------------------

const WORKSPACE_OF: Record<Product, string> = { solar: "solar", wind: "wind", terrain: "terrain", connection: "connection", demand: "demand" }

/**
 * Bring a result into view: select it, and open the workspace built around
 * its reading unless the current one already has that editor.
 */
export function showResult(id: string, product?: Product): void {
  select(id)
  if (!product) return
  if (leaves(activeTree()).some((a) => a.editor === product)) return
  setWorkspace(WORKSPACE_OF[product])
}

/**
 * Open the run graph with one product already chosen.
 *
 * THE ONE WAY TO A RUN, so the places that used to run a product themselves
 * can send the reader here instead. A run has five or six inputs and the
 * graph is where all of them are visible at once; a button elsewhere spends
 * the run with none of them on screen.
 *
 * The product is kept per graph panel, so it is set on whichever panel is
 * showing the graph -- after the switch, because the workspace it switches to
 * may be the one that introduces that panel. A workspace already showing a
 * graph keeps its own layout and only changes what the graph is about.
 *
 * Without a product the graph keeps the one it had, which is what a caller
 * that has no product in mind should ask for: the map's menu opens the board,
 * it does not choose what the board is about.
 */
export function openRunGraph(product?: Product): void {
  if (!leaves(activeTree()).some((a) => a.editor === "graph")) setWorkspace("graph")
  if (!product) return
  for (const a of leaves(activeTree())) {
    if (a.editor === "graph") setAreaState(a.id, { product })
  }
}

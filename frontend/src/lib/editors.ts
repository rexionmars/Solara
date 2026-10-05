import { ChartBar, CheckSquare, Fan, Graph, MapTrifold, Mountains, PlugsConnected, Scroll, SlidersHorizontal, Sun, Table, TerminalWindow, TreeView, type Icon } from "./icons"

/**
 * What an area can be, named once, as TERRA's studioEditors names its own.
 *
 * The type menu, the workspace presets and the area headers all read this
 * table, so a label cannot exist twice and disagree with itself. Metadata only:
 * the switch from an id to a component lives where the props are.
 */

export type EditorId = "map" | "graph" | "outliner" | "properties" | "table" | "reports" | "console" | "solar" | "wind" | "terrain" | "connection" | "demand" | "ground"

/**
 * What kind of work a thing is FOR. The workspace bar and the type menu group
 * by the same subjects, so a reader who has learnt one has learnt the other.
 */
export type StudioGroup = "board" | "solar" | "wind" | "grid" | "ground"

export const STUDIO_GROUPS: readonly { id: StudioGroup; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "solar", label: "Solar" },
  { id: "wind", label: "Wind" },
  { id: "grid", label: "Grid" },
  { id: "ground", label: "Ground" },
]

export type EditorMeta = {
  id: EditorId
  group: StudioGroup
  label: string
  icon: Icon
  /**
   * The size below which the editor stops being able to say anything. An area
   * under it says what it needs rather than drawing something unreadable.
   */
  minRem: number
  minRowRem: number
  /**
   * Whether only one area may hold it. The map is one MapLibre instance, one
   * WebGL context, moved between areas rather than created per area.
   */
  unique?: boolean
  /** One line in the type menu, saying what the editor is for. */
  hint: string
}

export const EDITORS: readonly EditorMeta[] = [
  {
    id: "map",
    group: "board",
    label: "Map",
    icon: MapTrifold,
    minRem: 14,
    minRowRem: 10,
    unique: true,
    hint: "Sites and areas on the ground, and the layers computed over them",
  },
  {
    id: "graph",
    group: "board",
    label: "Run graph",
    icon: Graph,
    minRem: 20,
    minRowRem: 14,
    hint: "One product's run as cards wired into it, and whether the reading on screen read each",
  },
  {
    id: "outliner",
    group: "board",
    label: "Outliner",
    icon: TreeView,
    minRem: 11,
    minRowRem: 8,
    hint: "Every site and area in the project, with the results under each",
  },
  {
    id: "properties",
    group: "board",
    label: "Properties",
    icon: SlidersHorizontal,
    minRem: 12,
    minRowRem: 8,
    hint: "The active item: where it is, what it can run, what it produced",
  },
  {
    id: "table",
    group: "board",
    label: "Data table",
    icon: Table,
    minRem: 24,
    minRowRem: 8,
    hint: "Every result of one product side by side, sortable, as the CSV exports it",
  },
  {
    id: "reports",
    group: "board",
    label: "Reports",
    icon: Scroll,
    minRem: 18,
    minRowRem: 4,
    hint: "What every operation reported, kept after the toast has gone",
  },
  {
    id: "console",
    group: "board",
    label: "Console",
    icon: TerminalWindow,
    minRem: 18,
    minRowRem: 4,
    hint: "Operators by name, with their arguments",
  },
  {
    id: "solar",
    group: "solar",
    label: "Solar resource",
    icon: Sun,
    minRem: 22,
    minRowRem: 14,
    hint: "Irradiation and photovoltaic yield at a site, as each was measured",
  },
  {
    id: "terrain",
    group: "solar",
    label: "Solar terrain",
    icon: Mountains,
    minRem: 22,
    minRowRem: 14,
    hint: "Plane-of-array irradiation over an area's terrain, and its shading",
  },
  {
    id: "wind",
    group: "wind",
    label: "Wind screening",
    icon: Fan,
    minRem: 22,
    minRowRem: 14,
    hint: "Hub-height wind at a site, and how far the estimate moves with shear",
  },
  {
    id: "connection",
    group: "grid",
    label: "Grid connection",
    icon: PlugsConnected,
    minRem: 22,
    minRowRem: 14,
    hint: "Where an area could join the transmission network, read from the grid store",
  },
  {
    id: "demand",
    group: "grid",
    label: "Area consumption",
    icon: ChartBar,
    minRem: 22,
    minRowRem: 14,
    hint: "What an area already draws from the network, and what it already puts back",
  },
  {
    id: "ground",
    group: "ground",
    label: "Usable ground",
    icon: CheckSquare,
    minRem: 22,
    minRowRem: 14,
    hint: "How much of an area a plant could stand on, and what excludes the rest",
  },
]

const BY_ID = new Map(EDITORS.map((e) => [e.id, e]))

export function editorMeta(id: EditorId): EditorMeta {
  return BY_ID.get(id) ?? EDITORS[0]
}

import { createStore } from "./store"

/**
 * The map's active tool, as Blender's toolbar holds one. The tool decides what
 * a click on the map does; it stays active until another is chosen or Escape
 * returns to Select, so several sites can be placed in a row.
 */
export type ToolId = "select" | "site" | "area" | "measure"

export type Tool = {
  id: ToolId
  label: string
  /** The operator that activates it, whose shortcut the toolbar shows. */
  operator: string
  description: string
  /** Mouse and key hints for the status bar while the tool is active. */
  hints: [string, string][]
}

export const TOOLS: Tool[] = [
  {
    id: "select",
    label: "Select",
    operator: "TOOL_SELECT",
    description: "Click a site or area to make it active; drag a site to move it",
    hints: [
      ["Click", "Select"],
      ["Drag site", "Move"],
      ["Right-click", "Context menu"],
    ],
  },
  {
    id: "site",
    label: "Place site",
    operator: "TOOL_SITE",
    description: "Click the map to add a site where the point products are computed",
    hints: [
      ["Click", "Add site"],
      ["Esc", "Select tool"],
    ],
  },
  {
    id: "area",
    label: "Draw area",
    operator: "TOOL_AREA",
    description: "Click to add vertices, click the first vertex to close the area",
    hints: [
      ["Click", "Add vertex"],
      ["Click first vertex", "Close area"],
      ["Esc", "Cancel"],
    ],
  },
  {
    id: "measure",
    label: "Measure",
    operator: "TOOL_MEASURE",
    description: "Click two points to measure the great-circle distance between them",
    hints: [
      ["Click", "Start / end point"],
      ["Esc", "Clear"],
    ],
  },
]

export const activeTool = createStore<ToolId>("select")

export function setTool(id: ToolId): void {
  if (activeTool.get() !== id) activeTool.set(id)
}

/** What the Map editor draws over the basemap, as Blender's Overlays popover. */
export type Overlays = {
  siteLabels: boolean
  areas: boolean
  layers: boolean
  legend: boolean
  statistics: boolean
  /** The grid store's registers: plants in the operational record, the rest, lines and buses. */
  gridMetered: boolean
  gridRegistered: boolean
  gridLines: boolean
  gridBuses: boolean
  /** The weather now, from the internet: clouds from GOES-East and rain from radar. */
  weatherSatellite: boolean
  weatherRadar: boolean
}

const OVERLAYS_KEY = "terra-energy.overlays.v1"

function restoreOverlays(): Overlays {
  const fallback: Overlays = {
    siteLabels: true,
    areas: true,
    layers: true,
    legend: true,
    statistics: true,
    // Off until asked for: the register is several megabytes, and a store that
    // is not running should not be the first thing a new user is told about.
    gridMetered: false,
    gridRegistered: false,
    gridLines: false,
    gridBuses: false,
    weatherSatellite: false,
    weatherRadar: false,
  }
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(OVERLAYS_KEY) ?? "{}") as Partial<Overlays>) }
  } catch {
    return fallback
  }
}

export const overlays = createStore<Overlays>(restoreOverlays())

overlays.subscribe(() => {
  try {
    localStorage.setItem(OVERLAYS_KEY, JSON.stringify(overlays.get()))
  } catch {
    /* a convenience only */
  }
})

/** Whether the toolbar (T) and the sidebar (N) of the Map editor are shown. */
export const mapRegions = createStore<{ toolbar: boolean; sidebar: boolean; sidebarTab: "item" | "view" }>({
  toolbar: true,
  sidebar: false,
  sidebarTab: "item",
})

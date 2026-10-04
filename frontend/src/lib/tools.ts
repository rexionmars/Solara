import type { BasemapId } from "./basemap"
import { createStore } from "./store"

/**
 * The map's active tool, as Blender's toolbar holds one. The tool decides what
 * a click on the map does; it stays active until another is chosen or Escape
 * returns to Select, so several sites can be placed in a row.
 */
/*
  THERE IS NO AREA TOOL, AND THAT IS THE POINT. A hand-drawn polygon is ground
  nobody published: it crosses whatever boundary the register answering the
  question ends at, at a size nothing checked, and the reading comes back about
  the part that register happened to reach. An area comes from the boundary
  catalogue in the run graph instead, where it is a state or a municipality
  IBGE publishes.
*/
export type ToolId = "select" | "site" | "measure"

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
  gridConcessions: boolean
  gridDemand: boolean
  gridMetered: boolean
  gridRegistered: boolean
  gridLines: boolean
  gridBuses: boolean
  /** The weather now, from the internet: clouds from GOES-East and rain from radar. */
  weatherSatellite: boolean
  weatherRadar: boolean
  /** The GFS wind field: colour by speed, and particles along it. */
  weatherWind: boolean
  /** Relief from the global elevation tiles, under everything the map draws. */
  hillshade: boolean
  /*
    Read from the registers that publish themselves, rather than from the
    local store. Each is one remote service, so each is off until asked for
    and each says on the console when it is refusing.
  */
  /** Nighttime lights: where the load is, said by something other than the record. */
  nightLights: boolean
  /** ANEEL's own map: turbine by turbine, and the strips already declared of public utility. */
  sigel: boolean
}

const OVERLAYS_KEY = "terra-energy.overlays.v1"

function restoreOverlays(): Overlays {
  const fallback: Overlays = {
    siteLabels: true,
    areas: true,
    layers: true,
    legend: true,
    statistics: true,
    /*
      ON, unlike every other grid layer. The argument below is about weight
      and about a store that is not running; neither applies here. The whole
      layer is 29 kB, and what it answers -- which register reaches this
      ground, and therefore whether a demand reading can be asked here at all
      -- is the one thing a reader needs BEFORE choosing anything. A store
      that does not answer leaves it empty and says so on its own label.
    */
    gridConcessions: true,
    // Off until asked for: the register is several megabytes, and a store that
    // is not running should not be the first thing a new user is told about.
    gridDemand: false,
    gridMetered: false,
    gridRegistered: false,
    gridLines: false,
    gridBuses: false,
    weatherSatellite: false,
    weatherRadar: false,
    weatherWind: false,
    // Off until asked for, all of them: each is a request to somebody else's
    // service, and a map that opens by calling three of them is a map that
    // fails in three ways before it has drawn anything.
    hillshade: false,
    nightLights: false,
    sigel: false,
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

/**
 * Which ground the basemap draws. Kept beside the overlays because the reader
 * reaches it from the same popover and expects it to be remembered the same
 * way.
 */
const BASEMAP_KEY = "terra-energy.basemap.v1"

export const basemap = createStore<BasemapId>(
  localStorage.getItem(BASEMAP_KEY) === "satellite" ? "satellite" : "dark"
)

basemap.subscribe(() => {
  try {
    localStorage.setItem(BASEMAP_KEY, basemap.get())
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

import { ArrowClockwise, ArrowCounterClockwise, ArrowsOut, ChartBar, Compass, CornersOut, Cursor, Database, Download, Eye, EyeSlash, FileArrowDown, FilePlus, FloppyDisk, FolderOpen, Gear, Heartbeat, House, Info as InfoIcon, Keyboard, MagnifyingGlass, MagnifyingGlassMinus, MagnifyingGlassPlus, MapPin, MapTrifold, Mountains, PencilSimple, Play, PlugsConnected, Question, Ruler, SidebarSimple, SignOut, SlidersHorizontal, StopCircle, Sun, Swatches, Trash, UserCircle, Wind, X, type Icon } from "@phosphor-icons/react"
import { Quit, WindowIsFullscreen, WindowFullscreen, WindowUnfullscreen } from "../../wailsjs/runtime/runtime"
import { account, logout } from "./account"
import { cancelRun, runConnection, runDemand, runSolar, runTerrain, runWind, running } from "./analysis"
import { loadDefaults } from "./defaults"
import { errorMessage } from "./errors"
import { exportGeoTiff, exportResultCsv, exportResultJson, exportTableCsv, reveal } from "./export"
import { checkGridStore, storeReachable } from "./grid"
import { cancelGesture, frameAll, frameItem, resetNorth, zoomIn, zoomOut } from "./mapEngine"
import { legendsShown, mapMounted, setLegendShown } from "./mapState"
import { addSite, validLonLat } from "./objects"
import { IS_MAC } from "./platform"
import {
  PRODUCT_NAMES,
  deleteItem,
  isAreaProduct,
  isAreaResult,
  type AreaObject,
  type AreaResult,
  type SiteObject,
  isResult,
  project,
  redo,
  setHidden,
  undo,
  type Product,
} from "./project"
import { newProject, openProject, saveProject, saveProjectAs, settleUnsaved } from "./projectFile"
import { clearReports, fail, info, note, report, warn } from "./reports"
import {
  cycleWorkspace,
  hoveredArea,
  resetWorkspace,
  screen,
  toggleMaximized,
  type EditorId,
} from "./screen"
import { activeArea, activeItem, activeSite, select, selection } from "./selection"
import { SetProjectDirty } from "../../wailsjs/go/main/App"
import { checkSidecar, sidecar } from "./sidecarStatus"
import { createStore, useStore } from "./store"
import { activeTool, mapRegions, setTool } from "./tools"
import { lastOperation, lastOperationOpen, operatorSearch, placePrompt, preferences, renaming, splashOpen } from "./ui"

/**
 * Every action the application performs, in one registry, as Blender's
 * operators.
 *
 * Menus, toolbar buttons, context menus, shortcuts, the operator search (F3)
 * and the Console all run operators by name from here, so a tool is written
 * once and reached every way.
 *
 * An operator's `poll` says whether it can run now, and if not, why. Menus
 * draw the item disabled with that reason as its tooltip, so an unavailable
 * action is explained before it is tried rather than failing after.
 */

export type Scope = "window" | "map" | "objects" | "outliner"

export type Operator = {
  /** Upper case, as typed in the Console. */
  name: string
  aliases: string[]
  label: string
  description: string
  /** How to type it with arguments. Absent for an operator that takes none. */
  usage?: string
  icon?: Icon
  /** Where it appears in the menus, for the operator search: "File", "Map › View". */
  menu: string
  /**
   * Key combinations, e.g. "Mod+S" (Cmd on macOS, Ctrl elsewhere), "Shift+Mod+Z",
   * "F3", "X", "Period". Letters and punctuation match the physical key.
   */
  keys?: string[]
  /** Where its keys work: anywhere, or only with the pointer over those editors. */
  scope?: Scope
  /** Whether its keys work while typing in a field. */
  inFields?: boolean
  /** true when it can run; otherwise the reason it cannot. */
  poll?: () => true | string
  run: (args: string[]) => void | Promise<void>
  /** Not echoed to the Info editor: view changes that would flood it. */
  quiet?: boolean
}

// ---- Polls ----------------------------------------------------------------------

const needMap = () => (mapMounted.get() ? true : "Needs a Map area in this workspace")

const notRunning = (): true | string => {
  const r = running.get()
  return r ? `${PRODUCT_NAMES[r.product]} is running` : true
}

const engineUp = (): true | string =>
  sidecar.get().kind === "failed" ? "The calculation engine is unavailable (Studio › Check the engine)" : true

function all(...polls: (() => true | string)[]): () => true | string {
  return () => {
    for (const p of polls) {
      const r = p()
      if (r !== true) return r
    }
    return true
  }
}

const needSite = () => (activeSite() ? true : "Select a site first (Place Site tool, P)")
const needArea = () => (activeArea() ? true : "Select an area first (Draw Area tool, D)")
const needItem = () => (activeItem() ? true : "Nothing is selected")
const needResult = () => (isResult(activeItem()) ? true : "Select a result first")
const needTerrainResult = () => (activeItem()?.kind === "terrain" ? true : "Select a solar terrain result first")

// ---- Run helpers ---------------------------------------------------------------

/** The operator that runs each product. */
export const RUN_OPERATOR: Record<Product, string> = { solar: "SOLAR", wind: "WIND", terrain: "TERRAIN", connection: "CONNECTION", demand: "DEMAND" }

const needGridStore = (): true | string =>
  storeReachable() ? true : "The grid store is not reachable (Studio › Settings › Grid store says why)"

/**
 * Which function runs each product. A total record rather than a chain of
 * conditions: a product added without one does not compile, where a chain
 * would quietly send it to whichever branch came last.
 */
const RUN_AREA: Record<AreaResult["kind"], (a: AreaObject) => Promise<string | null>> = {
  terrain: runTerrain,
  connection: runConnection,
  demand: runDemand,
}
const RUN_SITE: Record<Exclude<Product, AreaResult["kind"]>, (s: SiteObject) => Promise<string | null>> = {
  solar: runSolar,
  wind: runWind,
}

async function runProduct(product: Product): Promise<void> {
  if (isAreaProduct(product)) {
    const area = activeArea()
    if (!area) return
    const id = await RUN_AREA[product](area)
    if (id) lastOperation.set({ operator: RUN_OPERATOR[product], label: PRODUCT_NAMES[product], kind: "run", target: id })
    return
  }
  const site = activeSite()
  if (!site) return
  const id = await RUN_SITE[product](site)
  if (id) {
    lastOperation.set({ operator: RUN_OPERATOR[product], label: PRODUCT_NAMES[product], kind: "run", target: id })
  }
}

// ---- The registry -----------------------------------------------------------------

export const OPERATORS: Operator[] = [
  // File
  {
    name: "NEW",
    aliases: [],
    label: "New",
    description: "Start a new, empty project",
    icon: FilePlus,
    menu: "Studio",
    keys: ["Mod+N"],
    inFields: true,
    run: () => newProject(),
  },
  {
    name: "OPEN",
    aliases: [],
    label: "Open…",
    description: "Open a project file",
    icon: FolderOpen,
    menu: "Studio",
    keys: ["Mod+O"],
    inFields: true,
    run: () => openProject(),
  },
  {
    name: "SAVE",
    aliases: [],
    label: "Save",
    description: "Save the project, asking where the first time",
    icon: FloppyDisk,
    menu: "Studio",
    keys: ["Mod+S"],
    inFields: true,
    run: async () => {
      await saveProject()
    },
  },
  {
    name: "SAVEAS",
    aliases: [],
    label: "Save as…",
    description: "Save the project to a new file",
    menu: "Studio",
    keys: ["Shift+Mod+S"],
    inFields: true,
    run: async () => {
      await saveProjectAs()
    },
  },
  {
    name: "REVEAL_PROJECT",
    aliases: [],
    label: "Reveal project file",
    description: "Show the project file in the file manager",
    menu: "Studio",
    poll: () => (project.get().path ? true : "The project has not been saved yet"),
    run: () => reveal(project.get().path ?? ""),
  },
  {
    name: "EXPORT_CSV",
    aliases: [],
    label: "Result as CSV…",
    description: "Export the active result's headline figures as CSV",
    icon: FileArrowDown,
    menu: "Studio › Export",
    poll: needResult,
    run: () => {
      const r = activeItem()
      if (isResult(r)) return exportResultCsv(r)
    },
  },
  {
    name: "EXPORT_JSON",
    aliases: [],
    label: "Result as JSON…",
    description: "Export the active result in full, with its parameters, as JSON",
    icon: FileArrowDown,
    menu: "Studio › Export",
    poll: needResult,
    run: () => {
      const r = activeItem()
      if (isResult(r)) return exportResultJson(r)
    },
  },
  {
    name: "EXPORT_GEOTIFF",
    aliases: [],
    label: "Terrain layer as GeoTIFF…",
    description: "Save the active solar terrain result's float32 GeoTIFF",
    icon: Download,
    menu: "Studio › Export",
    poll: needTerrainResult,
    run: () => {
      const r = activeItem()
      if (r?.kind === "terrain") return exportGeoTiff(r)
    },
  },
  {
    name: "EXPORT_TABLE",
    aliases: [],
    label: "Comparison table as CSV…",
    description: "Export every result of one product as a CSV table",
    usage: "EXPORT_TABLE solar|wind|terrain|connection",
    icon: FileArrowDown,
    menu: "Studio › Export",
    poll: () => (project.get().data.results.length ? true : "There are no results yet"),
    run: (args) => {
      const product = (args[0]?.toLowerCase() ?? activeProductForTable()) as Product
      if (!(product in PRODUCT_NAMES)) {
        fail("Usage: EXPORT_TABLE solar|wind|terrain|connection")
        return
      }
      return exportTableCsv(product)
    },
  },
  {
    name: "QUIT",
    aliases: ["EXIT"],
    label: "Quit",
    description: "Close the application",
    icon: X,
    menu: "Studio",
    keys: ["Mod+Q"],
    inFields: true,
    run: async () => {
      if (!(await settleUnsaved())) return
      await SetProjectDirty(false).catch(() => {})
      Quit()
    },
  },

  // Edit
  {
    name: "UNDO",
    aliases: [],
    label: "Undo",
    description: "Undo the last change to the project",
    icon: ArrowCounterClockwise,
    menu: "Studio",
    keys: ["Mod+Z"],
    quiet: true,
    poll: () => {
      const step = project.get().undo.at(-1)
      return step ? true : "Nothing to undo"
    },
    run: () => {
      const label = undo()
      // As in Blender, an undone operation can no longer be adjusted.
      lastOperation.set(null)
      if (label) note(`Undo: ${label}`)
    },
  },
  {
    name: "REDO",
    aliases: [],
    label: "Redo",
    description: "Redo the change last undone",
    icon: ArrowClockwise,
    menu: "Studio",
    keys: ["Shift+Mod+Z", "Mod+Y"],
    quiet: true,
    poll: () => (project.get().redo.length ? true : "Nothing to redo"),
    run: () => {
      const label = redo()
      lastOperation.set(null)
      if (label) note(`Redo: ${label}`)
    },
  },
  {
    name: "ADJUST_LAST",
    aliases: [],
    label: "Adjust last operation",
    description: "Edit the parameters of the last site added or analysis run",
    icon: SlidersHorizontal,
    menu: "Studio",
    keys: ["F9"],
    inFields: true,
    quiet: true,
    poll: () => (lastOperation.get() ? true : "No operation to adjust"),
    run: () => lastOperationOpen.set(!lastOperationOpen.get()),
  },
  {
    name: "SEARCH",
    aliases: [],
    label: "Operator search…",
    description: "Find and run any operator by name",
    icon: MagnifyingGlass,
    menu: "Studio",
    keys: ["F3", "Mod+K"],
    inFields: true,
    quiet: true,
    run: () => operatorSearch.set(true),
  },
  {
    name: "RENAME",
    aliases: [],
    label: "Rename active item",
    description: "Rename the active site, area or result",
    icon: PencilSimple,
    menu: "Map › Object",
    keys: ["F2"],
    quiet: true,
    poll: needItem,
    run: () => renaming.set(selection.get().id),
  },
  {
    name: "DELETE",
    aliases: ["DEL"],
    label: "Delete",
    description: "Delete the active item; a site or area is deleted with its results",
    icon: Trash,
    menu: "Map › Object",
    keys: ["X", "Delete", "Backspace"],
    scope: "objects",
    poll: needItem,
    run: () => {
      const item = deleteItem(selection.get().id ?? "")
      if (!item) return
      select(null)
      info(`Deleted ${item.name}.`, { label: "Undo", run: () => void runOperator("UNDO") })
    },
  },
  {
    name: "LEGEND",
    aliases: [],
    label: "Legend on the map",
    description: "Draw or remove the active terrain layer's legend, tied to the layer on the map",
    icon: Swatches,
    menu: "Map › Object",
    scope: "objects",
    poll: needTerrainResult,
    run: () => {
      const item = activeItem()
      if (item?.kind === "terrain") setLegendShown(item.id, !legendsShown.get().has(item.id))
    },
  },
  {
    name: "HIDE",
    aliases: [],
    label: "Hide / show active",
    description: "Toggle whether the active item is drawn on the map",
    icon: EyeSlash,
    menu: "Map › Object",
    keys: ["H"],
    scope: "objects",
    poll: needItem,
    run: () => {
      const item = activeItem()
      if (item) setHidden(item.id, !item.hidden)
    },
  },
  {
    name: "UNHIDE_ALL",
    aliases: [],
    label: "Show all",
    description: "Draw every hidden site, area and layer again",
    icon: Eye,
    menu: "Map › Object",
    keys: ["Alt+H"],
    scope: "objects",
    poll: () => {
      const d = project.get().data
      return [...d.sites, ...d.areas, ...d.results].some((o) => o.hidden) ? true : "Nothing is hidden"
    },
    run: () => {
      const d = project.get().data
      for (const o of [...d.sites, ...d.areas, ...d.results]) if (o.hidden) setHidden(o.id, false)
    },
  },
  {
    name: "SELECT_NONE",
    aliases: [],
    label: "Select none",
    description: "Clear the active item",
    menu: "Map › Select",
    keys: ["Alt+A"],
    scope: "objects",
    quiet: true,
    run: () => select(null),
  },
  {
    name: "PREFERENCES",
    aliases: ["PREFS"],
    label: "Preferences…",
    description: "Account, calculation engine, keymap",
    icon: Gear,
    menu: "Studio",
    keys: ["Mod+Comma"],
    inFields: true,
    quiet: true,
    run: () => preferences.set("account"),
  },

  // Add and tools
  {
    name: "SITE_ADD",
    aliases: ["SITE", "PT"],
    label: "Site",
    description: "Add a site: pick it on the map, or give latitude and longitude",
    usage: "SITE_ADD [lat lon]",
    icon: MapPin,
    menu: "Map › Add",
    keys: ["Shift+A"],
    scope: "map",
    run: (args) => {
      if (args.length === 0) {
        if (needMap() !== true) {
          fail("Open a Map editor to pick a site, or type SITE_ADD <lat> <lon>.")
          return
        }
        setTool("site")
        return
      }
      // "-15.79 -47.88" and "-15.79,-47.88" both read as latitude, longitude.
      const parts = args.length === 1 ? args[0].split(",") : args
      const [lat, lon] = parts.map(Number)
      if (parts.length !== 2 || !validLonLat(lon, lat)) {
        fail("Usage: SITE_ADD <lat> <lon>, in decimal degrees, e.g. SITE_ADD -15.79 -47.88")
        return
      }
      const id = addSite(lon, lat)
      lastOperation.set({ operator: "SITE_ADD", label: "Add Site", kind: "site", target: id })
    },
  },
  {
    name: "TOOL_SELECT",
    aliases: [],
    label: "Select",
    description: "Click a site or area to make it active; drag a site to move it",
    icon: Cursor,
    menu: "Map › Tools",
    keys: ["W"],
    scope: "map",
    quiet: true,
    run: () => setTool("select"),
  },
  {
    name: "TOOL_SITE",
    aliases: [],
    label: "Place site",
    description: "Click the map to add sites",
    icon: MapPin,
    menu: "Map › Tools",
    keys: ["P"],
    scope: "map",
    quiet: true,
    poll: needMap,
    run: () => setTool("site"),
  },
  {
    name: "AREA_PLACE",
    aliases: ["PLACE", "CITY", "MUNICIPIO"],
    label: "Area from a place",
    description:
      "Take an area from a published boundary -- a state or a municipality, from IBGE -- instead of drawing one",
    icon: MapTrifold,
    menu: "Map › Add",
    keys: ["Shift+D"],
    scope: "map",
    poll: notRunning,
    run: async () => {
      placePrompt.set(true)
    },
  },
  {
    name: "TOOL_MEASURE",
    aliases: ["MEASURE"],
    label: "Measure",
    description: "Measure the distance between two points",
    icon: Ruler,
    menu: "Map › Tools",
    keys: ["M"],
    scope: "map",
    quiet: true,
    poll: needMap,
    run: () => setTool("measure"),
  },

  // View
  {
    name: "ZOOMIN",
    aliases: ["ZI"],
    label: "Zoom in",
    description: "Zoom the map in by one level",
    icon: MagnifyingGlassPlus,
    menu: "Map › View",
    quiet: true,
    poll: needMap,
    run: () => void zoomIn(),
  },
  {
    name: "ZOOMOUT",
    aliases: ["ZO"],
    label: "Zoom out",
    description: "Zoom the map out by one level",
    icon: MagnifyingGlassMinus,
    menu: "Map › View",
    quiet: true,
    poll: needMap,
    run: () => void zoomOut(),
  },
  {
    name: "FRAME_ALL",
    aliases: ["HOME", "ZE"],
    label: "Frame all",
    description: "Fit every site and area in view, or show the whole of Brazil when there are none",
    icon: House,
    menu: "Map › View",
    keys: ["Home"],
    scope: "objects",
    quiet: true,
    poll: needMap,
    run: () => void frameAll(),
  },
  {
    name: "FRAME_SELECTED",
    aliases: ["ZS"],
    label: "Frame selected",
    description: "Fit the active item in view",
    icon: CornersOut,
    menu: "Map › View",
    keys: ["Period", "NumpadDecimal"],
    scope: "objects",
    quiet: true,
    poll: all(needMap, needItem),
    run: () => {
      const item = activeItem()
      if (item) frameItem(item)
    },
  },
  {
    name: "NORTH",
    aliases: ["N"],
    label: "North up",
    description: "Reset the map's bearing and pitch",
    icon: Compass,
    menu: "Map › View",
    quiet: true,
    poll: needMap,
    run: () => void resetNorth(),
  },
  {
    name: "TOGGLE_TOOLBAR",
    aliases: [],
    label: "Toolbar",
    description: "Show or hide the Map editor's toolbar",
    menu: "Map › View",
    keys: ["T"],
    scope: "map",
    quiet: true,
    run: () => mapRegions.set((r) => ({ ...r, toolbar: !r.toolbar })),
  },
  {
    name: "TOGGLE_SIDEBAR",
    aliases: [],
    label: "Sidebar",
    description: "Show or hide the Map editor's sidebar: the active item and the view",
    icon: SidebarSimple,
    menu: "Map › View",
    keys: ["N"],
    scope: "map",
    quiet: true,
    run: () => mapRegions.set((r) => ({ ...r, sidebar: !r.sidebar })),
  },

  // Analyze
  {
    name: "SOLAR",
    aliases: ["SR"],
    label: "Solar resource",
    description: "Solar resource and photovoltaic yield at the active site (NASA POWER, pvlib)",
    icon: Sun,
    menu: "Analyze",
    poll: all(needSite, notRunning, engineUp),
    run: () => runProduct("solar"),
  },
  {
    name: "WIND",
    aliases: ["WR"],
    label: "Wind screening",
    description: "Wind resource screening at the active site (NASA POWER, MERRA-2); unvalidated",
    icon: Wind,
    menu: "Analyze",
    poll: all(needSite, notRunning, engineUp),
    run: () => runProduct("wind"),
  },
  {
    name: "TERRAIN",
    aliases: ["ST"],
    label: "Solar terrain",
    description: "Plane-of-array irradiation over the active area's terrain (Copernicus DEM, NASA POWER)",
    icon: Mountains,
    menu: "Analyze",
    poll: all(needArea, notRunning, engineUp),
    run: () => runProduct("terrain"),
  },
  {
    name: "CONNECTION",
    aliases: ["GC", "GRID"],
    label: "Grid connection",
    description: "Where the active area could join the transmission network, read from the grid store (ONS, ANEEL)",
    icon: PlugsConnected,
    menu: "Analyze",
    poll: all(needArea, notRunning, engineUp, needGridStore),
    run: () => runProduct("connection"),
  },
  {
    name: "DEMAND",
    // LOAD and DEMAND are kept as names a reader may type. The operator is not
    // renamed with its label: the name is what a keystroke and a saved macro
    // refer to, and the register carries energy, not the load either word
    // promises.
    aliases: ["LOAD", "CONSUMPTION"],
    label: "Area consumption",
    description:
      "What the active area already draws from the network and already puts back, read from the BDGD register in the grid store",
    icon: ChartBar,
    menu: "Analyze",
    poll: all(needArea, notRunning, engineUp, needGridStore),
    run: () => runProduct("demand"),
  },
  {
    name: "GRID_STORE",
    aliases: [],
    label: "Check the grid store",
    description: "Ask the grid store what it holds, or why it does not answer",
    icon: Database,
    menu: "Studio",
    poll: engineUp,
    run: () => checkGridStore(true),
  },
  {
    name: "RERUN",
    aliases: [],
    label: "Run again with current settings",
    description: "Compute the active result's product again at its source, as the source and settings stand now",
    icon: Play,
    menu: "Analyze",
    keys: ["Shift+R"],
    scope: "objects",
    poll: all(needResult, notRunning, engineUp, () => {
      const r = activeItem()
      const d = project.get().data
      return isResult(r) && d.results.some((x) => x.id === r.id) && (isAreaResult(r) ? activeArea() : activeSite())
        ? true
        : "Its source has been deleted"
    }),
    run: () => {
      const r = activeItem()
      if (isResult(r)) return runProduct(r.kind)
    },
  },
  {
    name: "CANCEL",
    aliases: ["STOP"],
    label: "Cancel analysis",
    description: "Stop the analysis in progress",
    icon: StopCircle,
    menu: "Analyze",
    poll: () => (running.get() ? true : "Nothing is running"),
    run: () => cancelRun(),
  },
  {
    name: "PING",
    aliases: ["CHECK"],
    label: "Check Engine",
    description: "Start the Python calculation engine and report its version",
    icon: Heartbeat,
    menu: "Studio",
    run: async () => {
      note("Checking the calculation engine…")
      const s = await checkSidecar()
      if (s.kind === "ready") {
        info(`Engine ready · Python ${s.version} · ${s.python}`)
        void loadDefaults()
      }
      else if (s.kind === "failed") fail(`Engine unavailable: ${s.message}`)
    },
  },

  // Window
  {
    name: "WORKSPACE_NEXT",
    aliases: [],
    label: "Next workspace",
    description: "Switch to the workspace to the right",
    menu: "Studio",
    keys: ["Ctrl+PageDown"],
    quiet: true,
    run: () => cycleWorkspace(1),
  },
  {
    name: "WORKSPACE_PREV",
    aliases: [],
    label: "Previous workspace",
    description: "Switch to the workspace to the left",
    menu: "Studio",
    keys: ["Ctrl+PageUp"],
    quiet: true,
    run: () => cycleWorkspace(-1),
  },
  {
    name: "AREA_MAXIMIZE",
    aliases: [],
    label: "Toggle maximize area",
    description: "Show the area under the pointer alone, or restore the layout",
    icon: ArrowsOut,
    menu: "Studio",
    keys: ["Ctrl+Space"],
    quiet: true,
    poll: () => (screen.get().maximized || hoveredArea.get().id ? true : "Point at an area first"),
    run: () => toggleMaximized(hoveredArea.get().id),
  },
  {
    name: "RESET_LAYOUT",
    aliases: [],
    label: "Reset workspace layout",
    description: "Restore this workspace's areas and editors to their defaults",
    menu: "Studio",
    quiet: true,
    run: () => resetWorkspace(),
  },
  {
    name: "FULLSCREEN",
    aliases: [],
    label: "Toggle window fullscreen",
    description: "Fill the screen with the window",
    menu: "Studio",
    keys: [IS_MAC ? "Ctrl+Mod+F" : "F11"],
    inFields: true,
    quiet: true,
    run: async () => {
      if (await WindowIsFullscreen()) WindowUnfullscreen()
      else WindowFullscreen()
    },
  },

  // Help
  {
    name: "HELP",
    aliases: ["?"],
    label: "List operators",
    description: "Print every operator, its console name and its shortcut to the Console",
    icon: Question,
    menu: "Studio",
    run: () => {
      for (const op of OPERATORS) {
        const aliases = op.aliases.length ? ` (${op.aliases.join(", ")})` : ""
        const keys = op.keys?.length ? `  [${op.keys.map(formatKeys).join(", ")}]` : ""
        report("info", `${((op.usage ?? op.name) + aliases).padEnd(30)} ${op.description}${keys}`)
      }
    },
  },
  {
    name: "KEYMAP",
    aliases: [],
    label: "Keymap",
    description: "Show every shortcut",
    icon: Keyboard,
    menu: "Studio",
    quiet: true,
    run: () => preferences.set("keymap"),
  },
  {
    name: "ABOUT",
    aliases: ["VERSION"],
    label: "About Solara",
    description: "Version and data sources",
    icon: InfoIcon,
    menu: "Studio",
    quiet: true,
    run: () => preferences.set("about"),
  },
  {
    name: "SPLASH",
    aliases: ["START"],
    label: "Splash screen",
    description: "Show the start screen: first steps and recent projects",
    menu: "Studio",
    quiet: true,
    run: () => splashOpen.set(true),
  },
  {
    name: "ACCOUNT",
    aliases: ["PROFILE", "LOGIN"],
    label: "Account…",
    description: "Sign in, or edit the signed-in profile",
    icon: UserCircle,
    menu: "Studio",
    quiet: true,
    run: () => preferences.set("account"),
  },
  {
    name: "LOGOUT",
    aliases: ["SIGNOUT"],
    label: "Sign out",
    description: "Sign out and continue as the guest",
    icon: SignOut,
    menu: "Studio",
    poll: () => (account.get().user ? true : "Not signed in"),
    run: async () => {
      try {
        await logout()
      } catch (e) {
        fail(`Sign out failed: ${errorMessage(e)}`)
      }
    },
  },
  {
    name: "CLEAR",
    aliases: ["CLS"],
    label: "Clear reports",
    description: "Clear the Info and Console history",
    menu: "Studio",
    quiet: true,
    run: () => clearReports(),
  },
]

/** The product whose table a Spreadsheet export takes when none is given. */
function activeProductForTable(): Product {
  const item = activeItem()
  if (isResult(item)) return item.kind
  return project.get().data.results.at(-1)?.kind ?? "solar"
}

const BY_NAME = new Map<string, Operator>()
for (const op of OPERATORS) {
  for (const key of [op.name, ...op.aliases]) BY_NAME.set(key, op)
}

export function findOperator(name: string): Operator | undefined {
  return BY_NAME.get(name.trim().toUpperCase())
}

export function pollOperator(op: Operator): true | string {
  try {
    return op.poll ? op.poll() : true
  } catch (e) {
    return errorMessage(e)
  }
}

/**
 * Run an operator: refused with its poll reason when it cannot run, echoed to
 * the Info editor when it can.
 */
export async function runOperator(name: string, args: string[] = []): Promise<boolean> {
  const op = findOperator(name)
  if (!op) {
    fail(`Unknown operator "${name.toUpperCase()}". Type HELP for the list.`)
    return false
  }
  if (args.length && !op.usage) {
    fail(`${op.name} takes no arguments.`)
    return false
  }
  const poll = pollOperator(op)
  if (poll !== true) {
    warn(`${op.label.replace(/…$/, "")}: ${poll}.`)
    return false
  }
  if (!op.quiet) report("operator", [op.name, ...args].join(" "))
  try {
    await op.run(args)
    return true
  } catch (e) {
    fail(`${op.label.replace(/…$/, "")}: ${errorMessage(e)}`)
    return false
  }
}

/** Console-name completions for the Console. */
export function completions(prefix: string): string[] {
  const p = prefix.trimStart().toUpperCase()
  if (!p || /\s/.test(p)) return []
  return OPERATORS.map((o) => o.name).filter((n) => n.startsWith(p))
}

/** Operators matching a search, by label, name, alias, menu or description; label matches first. */
export function searchOperators(query: string): Operator[] {
  const q = query.trim().toLowerCase()
  if (!q) return OPERATORS
  const words = q.split(/\s+/)
  // "run" and "compute" find the analyses, which are named for what they produce.
  const text = (o: Operator) =>
    `${o.label} ${o.name} ${o.aliases.join(" ")} ${o.menu} ${o.description} ${o.menu === "Analyze" ? "run compute analysis" : ""}`.toLowerCase()
  const hits = OPERATORS.filter((o) => words.every((w) => text(o).includes(w)))
  const rank = (o: Operator) =>
    o.label.toLowerCase().startsWith(q) ? 0 : o.name.toLowerCase().startsWith(q) ? 1 : o.label.toLowerCase().includes(q) ? 2 : 3
  return hits.sort((a, b) => rank(a) - rank(b))
}

// ---- Reactivity --------------------------------------------------------------

/**
 * A counter bumped whenever anything a poll reads changes, so a component
 * drawing an operator re-renders when it becomes available or unavailable.
 */
const pollTick = createStore(0)
const bump = () => pollTick.set((n) => n + 1)
for (const s of [project, selection, running, sidecar, mapMounted, screen, lastOperation, account, activeTool]) {
  s.subscribe(bump)
}

/** The operator and whether it can run now, kept current. */
export function useOperator(name: string): { op: Operator | undefined; poll: true | string } {
  useStore(pollTick)
  const op = findOperator(name)
  return { op, poll: op ? pollOperator(op) : `Unknown operator ${name}` }
}

export function usePollTick(): number {
  return useStore(pollTick)
}

// ---- Keys -----------------------------------------------------------------------

const MAC_SYMBOLS: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" }
const KEY_NAMES: Record<string, string> = {
  Period: ".",
  Comma: ",",
  NumpadDecimal: "Numpad .",
  Space: "Space",
  Delete: "Del",
  Backspace: "⌫",
  PageDown: "PgDn",
  PageUp: "PgUp",
}

/** A key combination as the platform writes it: ⇧⌘S on macOS, Shift+Ctrl+S elsewhere. */
export function formatKeys(spec: string): string {
  const parts = spec.split("+")
  const key = parts.pop() ?? ""
  const name = KEY_NAMES[key] ?? key
  if (IS_MAC) return parts.map((m) => MAC_SYMBOLS[m] ?? m).join("") + name
  return [...parts.map((m) => (m === "Mod" ? "Ctrl" : m)), name].join("+")
}

function keyOf(e: KeyboardEvent): string {
  // The physical key for letters and punctuation, so Alt+A reads as A and not
  // as the character macOS types for it.
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5)
  if (["Period", "Comma", "Space", "NumpadDecimal", "Equal", "Minus"].includes(e.code)) return e.code
  return e.key
}

function matches(spec: string, e: KeyboardEvent): boolean {
  const parts = spec.split("+")
  const key = parts.pop()
  const mods = new Set(parts)
  const wantMeta = IS_MAC && mods.has("Mod")
  const wantCtrl = mods.has("Ctrl") || (!IS_MAC && mods.has("Mod"))
  return (
    keyOf(e) === key &&
    e.metaKey === wantMeta &&
    e.ctrlKey === wantCtrl &&
    e.altKey === mods.has("Alt") &&
    e.shiftKey === mods.has("Shift")
  )
}

function inScope(scope: Scope | undefined, editor: EditorId | null): boolean {
  switch (scope ?? "window") {
    case "window":
      return true
    case "map":
      return editor === "map"
    case "outliner":
      return editor === "outliner"
    case "objects":
      return editor === "map" || editor === "outliner"
  }
}

/**
 * The window's keymap: the operator whose keys match, in the scope of the
 * editor under the pointer. Installed once by the screen.
 */
export function installKeymap(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat) return
    const target = e.target as HTMLElement | null
    const typing = !!target?.closest("input, textarea, select, [contenteditable='true']")

    if (e.key === "Escape" && !typing) {
      if (cancelGesture()) e.preventDefault()
      return
    }

    const editor = hoveredArea.get().editor
    const candidates = OPERATORS.filter((op) => op.keys?.some((k) => matches(k, e)))
    if (!candidates.length) return
    // An editor's own binding wins over a window binding for the same keys.
    const op =
      candidates.find((o) => o.scope && o.scope !== "window" && inScope(o.scope, editor)) ??
      candidates.find((o) => inScope(o.scope, editor))
    if (!op) return
    if (typing && !op.inFields) return
    e.preventDefault()
    void runOperator(op.name)
  }
  window.addEventListener("keydown", onKey)
  return () => window.removeEventListener("keydown", onKey)
}

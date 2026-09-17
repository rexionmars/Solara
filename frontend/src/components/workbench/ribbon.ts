import type { Panels } from "../../lib/layout"

/**
 * The ribbon's arrangement: tabs, the groups on each tab, and the commands in
 * each group. Items name commands in lib/commands.ts; what a command does and
 * how it is drawn live there.
 */
export type RibbonItem = {
  command: string
  /**
   * Large: icon over label, one column. Small: icon beside label, stacked
   * three to a column, for the secondary commands of a group.
   */
  size?: "large" | "small"
  /** Shown pressed while this panel or layer is visible. */
  pressedWhen?: keyof Panels | "terrainLayer"
}

export type RibbonGroup = { title: string; items: RibbonItem[] }

export type RibbonTab = { id: string; label: string; groups: RibbonGroup[] }

/** The quick access toolbar in the title bar: commands reached from any tab. */
export const QUICK_ACCESS = ["HOME", "SITE", "AREA", "CANCEL"]

export const RIBBON: RibbonTab[] = [
  {
    id: "home",
    label: "Home",
    groups: [
      {
        title: "Navigate",
        items: [
          { command: "HOME" },
          { command: "ZOOMIN", size: "small" },
          { command: "ZOOMOUT", size: "small" },
          { command: "NORTH", size: "small" },
        ],
      },
      { title: "Sidecar", items: [{ command: "PING" }] },
      { title: "Account", items: [{ command: "ACCOUNT" }, { command: "LOGOUT", size: "small" }] },
    ],
  },
  {
    id: "energy",
    label: "Energy",
    groups: [
      { title: "Site", items: [{ command: "SITE" }] },
      { title: "Area", items: [{ command: "AREA" }, { command: "AREACLEAR", size: "small" }] },
      { title: "Resource", items: [{ command: "SOLAR" }, { command: "WIND" }] },
      {
        title: "Terrain",
        items: [
          { command: "TERRAIN" },
          { command: "TERRAINLAYER", size: "small", pressedWhen: "terrainLayer" },
        ],
      },
      { title: "Run", items: [{ command: "CANCEL" }] },
    ],
  },
  {
    id: "view",
    label: "View",
    groups: [
      {
        title: "Palettes",
        items: [
          { command: "PROPERTIES", pressedWhen: "properties" },
          { command: "COMMANDLINE", pressedWhen: "commandLine" },
        ],
      },
      {
        title: "History",
        items: [
          { command: "CLEAR", size: "small" },
          { command: "HELP", size: "small" },
        ],
      },
    ],
  },
]

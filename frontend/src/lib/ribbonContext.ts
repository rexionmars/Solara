import type { Product } from "./project"
import type { EditorId } from "./editors"

export type RibbonTab = "map" | "analysis" | "view" | "share" | "study" | "run" | "data" | "tools"
export type RibbonContext = {
  planning: boolean
  products: Product[]
  tabs: RibbonTab[]
  defaultTab: RibbonTab
}
export const RIBBON_TABS: Record<RibbonTab, { label: string; hint: string }> = {
  map: { label: "Map", hint: "Map objects, navigation and layers" },
  analysis: { label: "Analysis", hint: "Analyses available in this workspace" },
  view: { label: "View", hint: "Panels and layout of the current workspace" },
  share: { label: "Export", hint: "Export the current workspace's data and results" },
  study: { label: "Study", hint: "Planning study files, network and profiles" },
  run: { label: "Run", hint: "Optimize the planning study and inspect results" },
  data: { label: "Data", hint: "Result tables and their exports" },
  tools: { label: "Tools", hint: "Console, operators and calculation engine" },
}

const ALL_PRODUCTS: Product[] = ["solar", "terrain", "wind", "connection", "demand", "ground"]
const PRODUCTS_BY_WORKSPACE: Record<string, Product[]> = {
  solar: ["solar", "terrain"],
  terrain: ["solar", "terrain"],
  wind: ["wind"],
  connection: ["connection", "demand"],
  demand: ["connection", "demand"],
  ground: ["ground"],
}

/** Actual panels determine available tools, including when a preset is customized. */
export function ribbonContext(workspace: string, editors: readonly EditorId[]): RibbonContext {
  const hasMap = editors.includes("map")
  const isPlanning = workspace === "planning" || editors.includes("planning")
  const products = PRODUCTS_BY_WORKSPACE[workspace] ?? ALL_PRODUCTS
  if (isPlanning)
    return {
      planning: true,
      products: [],
      tabs: ["study", "run", ...(hasMap ? ["map" as const] : []), "view", "share"],
      defaultTab: "study",
    }
  if (workspace === "data" && editors.includes("table"))
    return {
      planning: false,
      products,
      tabs: ["data", ...(hasMap ? ["map" as const] : []), "view", "share"],
      defaultTab: "data",
    }
  if (workspace === "scripting" && editors.includes("console"))
    return {
      planning: false,
      products: [],
      tabs: ["tools", ...(hasMap ? ["map" as const] : []), "view"],
      defaultTab: "tools",
    }
  return {
    planning: false,
    products,
    tabs: [...(hasMap ? ["map" as const] : []), "analysis", "view", "share"],
    defaultTab: workspace === "layout" && hasMap ? "map" : "analysis",
  }
}

/** A tab saved for another context must never expose an unrelated toolbar. */
export function resolveRibbonTab(context: RibbonContext, saved?: string): RibbonTab {
  return context.tabs.includes(saved as RibbonTab) ? (saved as RibbonTab) : context.defaultTab
}

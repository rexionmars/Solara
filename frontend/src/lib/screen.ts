import { arrived } from "./mapState"
import type { Product } from "./project"
import { select } from "./selection"
import { goTo, openPanel, resultProduct } from "./shell"
import { createStore } from "./store"

/**
 * What the editors share about where they are drawn, now that the studio's
 * arrangement is gone and the map shell holds them (shell.ts): the editor under
 * the pointer, what each holder remembers about its editor, and the way to a
 * reading.
 */

/** The holders whose keys answer while the pointer is over them: the map, and a list of the project's things. */
export type EditorId = "map" | "outliner"

// ---- The editor under the pointer --------------------------------------------

/**
 * Where the pointer is. Shortcuts go to the editor under the pointer, as in
 * Blender: X over the map deletes the active object, X over the reports does
 * nothing. The shell sets it for the map and for the lists of the project.
 */
export const hoveredArea = createStore<{ id: string | null; editor: EditorId | null }>({ id: null, editor: null })

// ---- Per-holder editor state ----------------------------------------------------

/** What each holder remembers about its editor: a pinned result, a filter, a mode. */
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
      /* a convenience only */
    }
  }, 250)
})

export function setAreaState(areaId: string, patch: AreaState): void {
  areaStates.set((all) => ({ ...all, [areaId]: { ...all[areaId], ...patch } }))
}

// ---- The way to a reading ---------------------------------------------------------

/** Bring a result into view: select it and hold its reading up over the map. */
export function showResult(id: string, product?: Product): void {
  select(id)
  if (product) resultProduct.set(product)
  openPanel("result")
  // Where it is, is on the map: brought clear of the panel only if none of it shows (mapEngine.ts).
  arrived.set(null)
  arrived.set(id)
}

/**
 * Where a product is set up and run: Products for the place in hand, whose
 * card lists what a run would read and carries the button.
 */
export function openReading(product: Product): void {
  resultProduct.set(product)
  openPanel("products")
}

/** The holder id of the run graph's destination, whose product the graph is about. */
export const GRAPH_HOLDER = "shell:graph"

/** Open the run graph, about one product when one is named. */
export function openRunGraph(product?: Product): void {
  goTo("graph")
  if (product) setAreaState(GRAPH_HOLDER, { product })
}

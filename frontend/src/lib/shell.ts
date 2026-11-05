import type { Product } from "./project"
import { createStore } from "./store"

/**
 * Where the reader is: which destination, and which panel is held up over the
 * map. TERRA's map shell, whose layout follows Pixxel Aurora.
 *
 * ONE PANEL, BY CONSTRUCTION. The shell holds a single value saying which is
 * open, so opening one closes the last rather than stacking or dividing the
 * window; the map stays the ground and a panel is something held up in front
 * of it.
 *
 * A DESTINATION IS WHAT A MAP CANNOT HOLD. Results compared side by side, a
 * planning study and the run graph are not about one place on the ground, so
 * each fills the window beside the rail instead of floating over the map.
 */

export type ShellPanelId = "places" | "products" | "result" | "layers" | "activity"
export type Destination = "explore" | "compare" | "planning" | "graph"

export type ShellState = {
  destination: Destination
  panel: ShellPanelId | null
  /** The destinations opened once, kept mounted behind the map so their state survives a look at the ground. */
  opened: readonly Destination[]
}

export const shell = createStore<ShellState>({ destination: "explore", panel: null, opened: [] })

export function togglePanel(id: ShellPanelId): void {
  shell.set((s) => ({ ...s, destination: "explore", panel: s.panel === id && s.destination === "explore" ? null : id }))
}

export function openPanel(id: ShellPanelId): void {
  shell.set((s) => ({ ...s, destination: "explore", panel: id }))
}

export function closePanel(): void {
  shell.set((s) => ({ ...s, panel: null }))
}

export function goTo(destination: Destination): void {
  shell.set((s) => ({
    ...s,
    destination,
    opened: destination === "explore" || s.opened.includes(destination) ? s.opened : [...s.opened, destination],
  }))
}

/**
 * Which product the Result panel reads, when the selection does not say: set
 * by "Read it", by a finished run and by the panel's own tabs.
 */
export const resultProduct = createStore<Product | null>(null)

/** Panel widths, in rem, which the camera keeps what it frames clear of. */
export const PANEL_REM = { narrow: 26, wide: 44 } as const

/** Whether a panel reads wide: a reading has figures across it that the narrow column cannot hold. */
export const panelWide = (id: ShellPanelId | null) => id === "result"

const RAIL_KEY = "solara.rail-open"

function readRailOpen(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1"
  } catch {
    return false
  }
}

/** Whether the rail shows its labels. Per viewer, so local storage. */
export const railOpen = createStore<boolean>(readRailOpen())

railOpen.subscribe(() => {
  try {
    localStorage.setItem(RAIL_KEY, railOpen.get() ? "1" : "0")
  } catch {
    // Held for this session only.
  }
})

/**
 * How much of the map's right edge is covered, in pixels: the tool column, and
 * the panel when one is open. The camera frames what it is sent to clear of it.
 */
export const mapInsetRight = createStore<number>(56)

/** The tool column and the gap either side of it, which a panel stops short of. */
const COLUMN_PX = 56

/*
  Derived here and not in a component's effect: a run that finishes opens its
  reading and then sends the camera to it, in one turn, and the camera has to
  know the panel is already there.
*/
shell.subscribe(() => {
  const { destination, panel } = shell.get()
  const open = destination === "explore" ? panel : null
  const rem = typeof document === "undefined" ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const next = COLUMN_PX + (open ? (panelWide(open) ? PANEL_REM.wide : PANEL_REM.narrow) * rem + 12 : 0)
  if (next !== mapInsetRight.get()) mapInsetRight.set(next)
})

/** The last report the reader has seen, so the rail can mark Activity while a newer one waits. */
export const reportsSeen = createStore<unknown>(null)

import type { Icon } from "@phosphor-icons/react"
import { createStore } from "./store"

/**
 * Transient interface state that no editor owns: the open context menu, the
 * confirmation dialog, the operator search, the preferences window and the
 * last operation the Adjust Last Operation panel edits.
 */

export type MenuItem =
  | { type: "op"; op: string; args?: string[]; label?: string }
  | {
      type: "action"
      label: string
      run: () => void
      icon?: Icon
      checked?: boolean
      /** Why it is unavailable; the item is drawn disabled with this as its tooltip. */
      disabled?: string | false
      shortcut?: string
    }
  | { type: "sub"; label: string; icon?: Icon; items: () => MenuItem[] }
  | { type: "sep" }
  | { type: "heading"; label: string }

export const contextMenu = createStore<{ x: number; y: number; title?: string; items: MenuItem[] } | null>(null)

export function openContextMenu(e: { clientX: number; clientY: number }, items: MenuItem[], title?: string): void {
  contextMenu.set({ x: e.clientX, y: e.clientY, items, title })
}

// ---- Confirmation -----------------------------------------------------------

export type ConfirmButton = { label: string; value: string; primary?: boolean; danger?: boolean }

export type ConfirmRequest = {
  title: string
  message: string
  buttons: ConfirmButton[]
  resolve: (value: string) => void
}

export const confirmRequest = createStore<ConfirmRequest | null>(null)

/** Ask a question in a modal dialog; resolves with the chosen button's value, or "cancel" on Escape. */
export function ask(title: string, message: string, buttons: ConfirmButton[]): Promise<string> {
  return new Promise((resolve) => {
    confirmRequest.set({
      title,
      message,
      buttons,
      resolve: (value) => {
        confirmRequest.set(null)
        resolve(value)
      },
    })
  })
}

// ---- Search, preferences ----------------------------------------------------

export const operatorSearch = createStore<boolean>(false)

export type PreferencesSection = "account" | "engine" | "grid" | "keymap" | "about"

export const preferences = createStore<PreferencesSection | null>(null)

/**
 * Whether the navigation rail is collapsed to its icons.
 *
 * Kept across launches, because it is a decision about the shape of the
 * window rather than about the work: a reader who gave the rail back its
 * pixels should not have to do it again tomorrow.
 */
const RAIL_KEY = "terra-energy.rail.v1"

export const sidebarCollapsed = createStore<boolean>(
  (() => {
    try {
      return localStorage.getItem(RAIL_KEY) === "1"
    } catch {
      return false
    }
  })()
)

export function toggleSidebar(): void {
  sidebarCollapsed.set((v) => !v)
  try {
    localStorage.setItem(RAIL_KEY, sidebarCollapsed.get() ? "1" : "0")
  } catch {
    // A browser that refuses storage still gets a working rail, just a forgetful one.
  }
}

/*
  The ribbon under the workspace tabs. Folded, it gives its rows back to the
  areas and the tabs alone remain; the choice is remembered like the rail's.
*/
const RIBBON_KEY = "terra-energy.ribbon.v1"

export const ribbonCollapsed = createStore<boolean>(
  (() => {
    try {
      return localStorage.getItem(RIBBON_KEY) === "1"
    } catch {
      return false
    }
  })()
)

/** The ribbon's tabs: what kind of command is wanted, not which arrangement is on screen. */
export type RibbonTab = "map" | "analysis" | "view" | "share"

const RIBBON_TAB_KEY = "terra-energy.ribbon-tab.v1"

export const ribbonTab = createStore<RibbonTab>(
  (() => {
    try {
      const saved = localStorage.getItem(RIBBON_TAB_KEY)
      return saved === "analysis" || saved === "view" || saved === "share" ? saved : "map"
    } catch {
      return "map"
    }
  })()
)

ribbonTab.subscribe(() => {
  try {
    localStorage.setItem(RIBBON_TAB_KEY, ribbonTab.get())
  } catch {
    /* a convenience only */
  }
})

export function toggleRibbon(): void {
  ribbonCollapsed.set((v) => !v)
  try {
    localStorage.setItem(RIBBON_KEY, ribbonCollapsed.get() ? "1" : "0")
  } catch {
    // A convenience only: the ribbon still folds, it just opens again next launch.
  }
}

/** The start screen (StartSplash): open at launch, as Blender's splash. */
export const splashOpen = createStore<boolean>(true)

/** Renaming in place: the id of the item whose name is being edited in the Outliner. */
export const renaming = createStore<string | null>(null)

// ---- Adjust Last Operation --------------------------------------------------

/**
 * The last operation that can be adjusted, as Blender's redo panel holds it:
 * its name, and the fields the panel draws. `apply` repeats the operation with
 * the fields as edited.
 */
export type LastOperation = {
  operator: string
  label: string
  kind: "site" | "run"
  /** The site added, or the result produced, that `apply` replaces. */
  target: string
}

export const lastOperation = createStore<LastOperation | null>(null)

/** Whether the Adjust Last Operation panel is expanded (F9). */
export const lastOperationOpen = createStore<boolean>(false)

/** The map's address search: folded to its magnifier, or open with its field. */
export const addressSearchOpen = createStore<boolean>(false)

/** The Add › Site at Coordinates dialog. */
export const coordinatePrompt = createStore<boolean>(false)

/** Whether the place search is open: an area taken from a published boundary. */
export const placePrompt = createStore<boolean>(false)

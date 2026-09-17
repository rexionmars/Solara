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

/** The Add › Site at Coordinates dialog. */
export const coordinatePrompt = createStore<boolean>(false)

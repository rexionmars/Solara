import { findItem, isResult, project, type AreaObject, type AnyItem, type SiteObject } from "./project"
import { createStore, useStore } from "./store"

/**
 * The active item: one site, area or result, as Blender has one active object.
 * Operators act on it, the Properties editor shows it, and the Results editor
 * follows it.
 *
 * Kept outside the project data, so selecting is not an undo step. An undo
 * that removes the active item leaves the selection pointing at nothing, and
 * every reader treats that as no selection.
 */
export const selection = createStore<{ id: string | null }>({ id: null })

export function select(id: string | null): void {
  if (selection.get().id !== id) selection.set({ id })
}

export function activeItem(): AnyItem | null {
  return findItem(project.get().data, selection.get().id)
}

export function useActiveItem(): AnyItem | null {
  const { data } = useStore(project)
  const { id } = useStore(selection)
  return findItem(data, id)
}

/** The site operators act on: the active site, or the site of the active point result. */
export function activeSite(): SiteObject | null {
  const d = project.get().data
  const item = activeItem()
  if (item?.kind === "site") return item
  if (isResult(item) && item.kind !== "terrain") {
    const s = findItem(d, item.sourceId)
    return s?.kind === "site" ? s : null
  }
  return null
}

/** The area operators act on: the active area, or the area of the active terrain result. */
export function activeArea(): AreaObject | null {
  const d = project.get().data
  const item = activeItem()
  if (item?.kind === "area") return item
  if (item?.kind === "terrain") {
    const a = findItem(d, item.sourceId)
    return a?.kind === "area" ? a : null
  }
  return null
}

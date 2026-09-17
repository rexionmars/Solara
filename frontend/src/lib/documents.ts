import { createStore } from "./store"

/**
 * The documents open in the tab strip under the ribbon. The map is always
 * open and cannot be closed; the others open on request or when a result
 * arrives, as a CAD program opens its start page beside the drawings.
 */
export type DocumentId = "map" | "account" | "solar" | "wind" | "terrain"

export const DOCUMENT_TITLES: Record<DocumentId, string> = {
  map: "Map",
  account: "Account",
  solar: "Solar resource",
  wind: "Wind screening",
  terrain: "Solar terrain",
}

export type Documents = { open: DocumentId[]; active: DocumentId }

export const documents = createStore<Documents>({ open: ["map"], active: "map" })

/** Open a document's tab, bringing it to the front unless `activate` is false. */
export function openDocument(id: DocumentId, activate = true): void {
  documents.set((d) => ({
    open: d.open.includes(id) ? d.open : [...d.open, id],
    active: activate ? id : d.active,
  }))
}

export function activateDocument(id: DocumentId): void {
  documents.set((d) => (d.open.includes(id) ? { ...d, active: id } : d))
}

export function closeDocument(id: DocumentId): void {
  if (id === "map") return
  documents.set((d) => ({
    open: d.open.filter((x) => x !== id),
    active: d.active === id ? "map" : d.active,
  }))
}

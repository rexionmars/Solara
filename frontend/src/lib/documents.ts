import { createStore } from "./store"

/**
 * The documents open in the tab strip under the ribbon. The map is always
 * open and cannot be closed; the others open on request or when a result
 * arrives, as a CAD program opens its start page beside the drawings.
 */
export type DocumentId = "map" | "account" | "solar" | "wind"

export const DOCUMENT_TITLES: Record<DocumentId, string> = {
  map: "Map",
  account: "Account",
  solar: "Solar resource",
  wind: "Wind screening",
}

export type Documents = { open: DocumentId[]; active: DocumentId }

export const documents = createStore<Documents>({ open: ["map"], active: "map" })

export function openDocument(id: DocumentId): void {
  documents.set((d) => ({ open: d.open.includes(id) ? d.open : [...d.open, id], active: id }))
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

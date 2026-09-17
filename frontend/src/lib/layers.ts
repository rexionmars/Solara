import { createStore } from "./store"

/**
 * How the rendered layers are shown on the map. A layer can be hidden and
 * shown again without being recomputed; TERRA could only clear a solar layer
 * to get it off the map.
 */
export type LayerState = { visible: boolean; opacity: number }

export const terrainLayer = createStore<LayerState>({ visible: true, opacity: 0.85 })

export function toggleTerrainLayer(): void {
  terrainLayer.set((l) => ({ ...l, visible: !l.visible }))
}

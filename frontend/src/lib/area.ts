import { print } from "./commandLog"
import { polygonAreaKm2 } from "./geo"
import { createStore } from "./store"

/**
 * The analysis area: one polygon, drawn on the map after AREA. The terrain
 * product resolves within it; the point products read the site instead.
 *
 * One area at a time. A new drawing replaces the old one rather than joining
 * it, so what a run reads is never ambiguous.
 */
export type Polygon = { type: "Polygon"; coordinates: number[][][] }

export type AreaState = { polygon: Polygon | null; drawing: boolean }

export const area = createStore<AreaState>({ polygon: null, drawing: false })

export function startDrawing(): void {
  area.set((a) => ({ ...a, drawing: true }))
}

export function cancelDrawing(): void {
  if (!area.get().drawing) return
  area.set((a) => ({ ...a, drawing: false }))
  print("Area drawing cancelled.")
}

export function finishDrawing(polygon: Polygon): void {
  area.set({ polygon, drawing: false })
  const vertices = polygon.coordinates[0].length - 1
  print(`Area set: ${vertices} vertices, ${polygonAreaKm2(polygon).toFixed(2)} km².`)
}

export function clearArea(): void {
  if (!area.get().polygon) {
    print("No area to clear.", "error")
    return
  }
  area.set({ polygon: null, drawing: false })
  print("Area cleared.")
}

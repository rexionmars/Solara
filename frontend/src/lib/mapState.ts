import type { BusProps, LineProps, PlantProps } from "./grid"
import { createStore } from "./store"

/**
 * What the rest of the interface reads about the map, kept apart from the map
 * itself (mapEngine.ts) so a module can read it without importing MapLibre or
 * the operators the engine runs.
 */

// Centroid of Brazil's territory, at a zoom that shows all of it.
export const HOME_VIEW = { center: [-51.9, -14.2] as [number, number], zoom: 3.5 }

export type MapViewState = { lng: number; lat: number; zoom: number; bearing: number; pitch: number }

export const mapView = createStore<MapViewState>({
  lng: HOME_VIEW.center[0],
  lat: HOME_VIEW.center[1],
  zoom: HOME_VIEW.zoom,
  bearing: 0,
  pitch: 0,
})

/** Geographic position under the pointer, or null when it is off the map. */
export const cursor = createStore<{ lng: number; lat: number } | null>(null)

/** Whether the map is in an area on screen. Operators that need it poll this. */
export const mapMounted = createStore<boolean>(false)

/** The Measure tool's points: none, a start, or a start and an end. */
export const measure = createStore<{ lon: number; lat: number }[]>([])

/** Whether the map's style has loaded, so a marker placed now is placed by the projection that stays. */
export const mapLoaded = createStore<boolean>(false)

/**
 * The terrain results whose legend is drawn on the map, tied to the layer it
 * describes (OverlayCallouts). Shown by asking, as TERRA's: a legend per layer
 * nobody asked for is a map covered in boxes. Kept for the session rather than
 * in the project, since which legends are up is about what is being looked at
 * now.
 */
export const legendsShown = createStore<ReadonlySet<string>>(new Set())

export function setLegendShown(id: string, on: boolean): void {
  legendsShown.set((prev) => {
    if (prev.has(id) === on) return prev
    const next = new Set(prev)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })
}

/** A feature of the grid layers the reader clicked, captioned where it was clicked (OverlayCallouts). */
export type PickedGrid =
  | { kind: "plant"; at: [number, number]; props: PlantProps }
  | { kind: "line"; at: [number, number]; props: LineProps }
  | { kind: "bus"; at: [number, number]; props: BusProps }

export const pickedGrid = createStore<PickedGrid | null>(null)

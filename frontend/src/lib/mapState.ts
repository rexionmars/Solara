import type { BusProps, LineProps, PlantProps, ReachProps } from "./grid"
import { createStore } from "./store"

/**
 * What the rest of the interface reads about the map, kept apart from the map
 * itself (mapEngine.ts) so a module can read it without importing MapLibre or
 * the operators the engine runs.
 */

/*
  The whole world, which is where a map opens the first time and what Home
  frames when neither the project nor a store says where the work is. It was
  Brazil, when Brazil was the only ground the application read.
*/
export const HOME_VIEW = { center: [0, 15] as [number, number], zoom: 1.4 }

const VIEW_KEY = "terra-energy.mapView.v1"

/** Where the map was last left, so it opens on the ground being worked on. */
export function restoreView(): { center: [number, number]; zoom: number } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as { lng?: number; lat?: number; zoom?: number } | null
    if (v && Number.isFinite(v.lng) && Number.isFinite(v.lat) && Number.isFinite(v.zoom) && Math.abs(v.lat!) <= 90) {
      return { center: [v.lng!, v.lat!], zoom: v.zoom! }
    }
  } catch {
    // An unreadable note of the last view is no view; the world is.
  }
  return HOME_VIEW
}

export function rememberView(lng: number, lat: number, zoom: number): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lng, lat, zoom }))
  } catch {
    /* a convenience only */
  }
}

export type MapViewState = { lng: number; lat: number; zoom: number; bearing: number; pitch: number }

const opened = restoreView()

export const mapView = createStore<MapViewState>({
  lng: opened.center[0],
  lat: opened.center[1],
  zoom: opened.zoom,
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
  | { kind: "reach"; at: [number, number]; props: ReachProps }

export const pickedGrid = createStore<PickedGrid | null>(null)

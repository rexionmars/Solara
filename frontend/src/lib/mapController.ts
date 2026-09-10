import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl"
import { createStore } from "./store"

/**
 * The one map the viewport holds, and the state the other panels read from it.
 *
 * Commands act on the map through here rather than through a ref passed down,
 * because they are started from three places -- the ribbon, the command line
 * and the viewport's own toolbar -- none of which owns the map.
 */

// Centroid of Brazil's territory, at a zoom that shows all of it.
export const HOME_VIEW = { center: [-51.9, -14.2] as [number, number], zoom: 3.5 }

export type MapViewState = {
  lng: number
  lat: number
  zoom: number
  bearing: number
  pitch: number
}

export const mapView = createStore<MapViewState>({
  lng: HOME_VIEW.center[0],
  lat: HOME_VIEW.center[1],
  zoom: HOME_VIEW.zoom,
  bearing: 0,
  pitch: 0,
})

/** Geographic position under the pointer, or null when it is off the map. */
export const cursor = createStore<{ lng: number; lat: number } | null>(null)

let current: MapLibreMap | null = null

type ClickListener = (at: { lng: number; lat: number }) => void
const clickListeners = new Set<ClickListener>()

/** Calls `listener` with the position of every click on the map. Returns the unsubscribe. */
export function onMapClick(listener: ClickListener): () => void {
  clickListeners.add(listener)
  return () => {
    clickListeners.delete(listener)
  }
}

/** Registers the viewport's map. Returns the function that unregisters it. */
export function attachMap(map: MapLibreMap): () => void {
  current = map
  const onClick = (e: MapMouseEvent) =>
    clickListeners.forEach((listener) => listener({ lng: e.lngLat.lng, lat: e.lngLat.lat }))
  map.on("click", onClick)

  const onMove = () => {
    const c = map.getCenter()
    mapView.set({
      lng: c.lng,
      lat: c.lat,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    })
  }
  const onPointer = (e: MapMouseEvent) => cursor.set({ lng: e.lngLat.lng, lat: e.lngLat.lat })
  const onLeave = () => cursor.set(null)

  map.on("move", onMove)
  map.on("mousemove", onPointer)
  map.on("mouseout", onLeave)
  onMove()

  return () => {
    map.off("click", onClick)
    map.off("move", onMove)
    map.off("mousemove", onPointer)
    map.off("mouseout", onLeave)
    if (current === map) current = null
    cursor.set(null)
  }
}

/** Runs `action` on the map, reporting false when no map is attached. */
function withMap(action: (map: MapLibreMap) => void): boolean {
  if (!current) return false
  action(current)
  return true
}

export const zoomIn = () => withMap((m) => m.zoomIn())
export const zoomOut = () => withMap((m) => m.zoomOut())
export const flyHome = () => withMap((m) => m.flyTo({ ...HOME_VIEW, bearing: 0, pitch: 0 }))
export const resetNorth = () => withMap((m) => m.resetNorthPitch())
/** Centre the map on a site, zooming in to regional scale if it is further out. */
export const flyToSite = (lon: number, lat: number) =>
  withMap((m) => m.flyTo({ center: [lon, lat], zoom: Math.max(m.getZoom(), 8) }))

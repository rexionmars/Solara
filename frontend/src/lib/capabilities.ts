import { gridStore, storeInfo, storeReport, type GridStoreState } from "./grid"
import { mapView } from "./mapState"
import type { Product } from "./project"
import { createStore, useStore } from "./store"
import type { Overlays } from "./tools"

/**
 * What is offered, decided by what can answer: the connected store's
 * capabilities and the ground the map is over.
 *
 * WHY THIS EXISTS. Every menu was a fixed list written for one country: six
 * layers of the Brazilian record, three Brazilian services, a satellite that
 * sees the Americas. Over any other ground most of that list is a row of
 * things that fail or draw nothing, and the application reads as built for
 * Brazil alone -- when three of its five products never needed Brazil at all.
 * A menu that lists only what can answer here says the opposite, truthfully.
 *
 * ONE RULE, READ BY EVERY MENU. The ribbon, the outliner, the overlays popover
 * and the run graph each ask this module instead of keeping a list of their
 * own, so they cannot come to disagree about what exists.
 */

// ---- The ground the map is over ---------------------------------------------------------

export type MapRegion = {
  /** Over Brazil, where SIGEL publishes. */
  brazil: boolean
  /** Inside the disc GOES-East sees: the Americas and the Atlantic to about 15 W. */
  goesEast: boolean
}

function regionAt(lng: number, lat: number): MapRegion {
  return {
    brazil: lng >= -74.5 && lng <= -34 && lat >= -34.5 && lat <= 5.5,
    goesEast: lng >= -135 && lng <= -15,
  }
}

/*
  Kept apart from mapView and changed only when a flag does: the map reports
  its centre on every frame of a pan, and a menu subscribed to that would
  redraw on every frame to say the same thing.
*/
export const mapRegion = createStore<MapRegion>(regionAt(mapView.get().lng, mapView.get().lat))

mapView.subscribe(() => {
  const v = mapView.get()
  const next = regionAt(v.lng, v.lat)
  const cur = mapRegion.get()
  if (next.brazil !== cur.brazil || next.goesEast !== cur.goesEast) mapRegion.set(next)
})

// ---- What the store can do ----------------------------------------------------------------

type Caps = { connected: boolean; plants: boolean; network: boolean; brazil: boolean }

/**
 * With no store connected the generic layers are still offered -- they are
 * what a store would give, and asking for one says to connect it -- but
 * nothing of the Brazilian record is, since no store is there to be Brazil's.
 */
function caps(s: GridStoreState): Caps {
  const report = storeReport(s)
  const info = storeInfo(s)
  if (!report?.reachable || !info) return { connected: false, plants: true, network: true, brazil: false }
  const c = info.capabilities
  return { connected: true, plants: c.plants, network: c.network, brazil: c.brazil }
}

// ---- Layers ---------------------------------------------------------------------------------

export function layerAvailable(key: keyof Overlays, s: GridStoreState = gridStore.get(), r: MapRegion = mapRegion.get()): boolean {
  const c = caps(s)
  switch (key) {
    // The Brazilian record: where each register reaches, consumption by
    // municipality, and which plants the operator meters.
    case "gridConcessions":
    case "gridDemand":
    case "gridMetered":
      return c.brazil
    case "gridRegistered":
      return c.plants
    case "gridLines":
    case "gridBuses":
      return c.network
    case "sigel":
      return r.brazil
    case "weatherSatellite":
      return r.goesEast
    default:
      return true
  }
}

/**
 * A layer's name over the store that is connected. "Registered only" is a
 * distinction TERRA's store makes -- plants the operator's record does not
 * cover -- and any other store simply has plants.
 */
export function layerLabel(key: keyof Overlays, label: string, s: GridStoreState = gridStore.get()): string {
  if (key === "gridRegistered" && !caps(s).brazil) return "Plants"
  return label
}

/** The layers of a list that can answer here, each under the name it has here. */
export function availableLayers<T extends { key: keyof Overlays; label: string }>(
  items: readonly T[],
  s: GridStoreState = gridStore.get(),
  r: MapRegion = mapRegion.get()
): T[] {
  return items.filter((it) => layerAvailable(it.key, s, r)).map((it) => ({ ...it, label: layerLabel(it.key, it.label, s) }))
}

/** `availableLayers`, for a component: redrawn when the store or the ground changes. */
export function useAvailableLayers<T extends { key: keyof Overlays; label: string }>(items: readonly T[]): T[] {
  return availableLayers(items, useStore(gridStore), useStore(mapRegion))
}

// ---- Products -------------------------------------------------------------------------------

/**
 * Why a product cannot be run against the store as it is, or null when it can.
 * Solar, wind and terrain read global sources and are never blocked by a store.
 */
export function productBlocked(product: Product, s: GridStoreState = gridStore.get()): string | null {
  if (product !== "connection" && product !== "demand") return null
  const report = storeReport(s)
  const info = storeInfo(s)
  if (!report?.reachable || !info) return "The grid store is not connected or not reachable (Settings › Grid store says why)"
  if (product === "connection") {
    return info.capabilities.connection ? null : "This store carries no lines or substations, so there is no network to measure a connection against"
  }
  return info.capabilities.brazil
    ? null
    : "Area consumption is read from the Brazilian record TERRA loads, and this store follows the contract, which does not carry it"
}

/**
 * Whether a product belongs on a menu at all. Narrower than `productBlocked`:
 * a product blocked only because no store is connected is still offered, with
 * its reason; one the connected store could never answer is left out.
 */
export function productOffered(product: Product, s: GridStoreState = gridStore.get()): boolean {
  const c = caps(s)
  if (product === "demand") return c.brazil
  if (product === "connection") return !c.connected || c.network
  return true
}

export function useProductOffered(product: Product): boolean {
  return productOffered(product, useStore(gridStore))
}

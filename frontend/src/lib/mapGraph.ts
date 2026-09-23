import type { FeatureCollection } from "geojson"
import { centroidOf, pointInPolygon } from "./geo"
import type { Polygon } from "./project"
import { createStore } from "./store"
import type { Overlays } from "./tools"

/**
 * What the map draws, as a graph: a ground, a layer over it, and the map.
 *
 * WHY THE MAP IS A SUBJECT OF THE RUN GRAPH. A run graph says what a reading
 * was made of; the map has exactly the same question and, until now, no place
 * to answer it. A layer arrived from a checkbox in a popover, over ground
 * nobody chose, and the reader could not see WHICH register they were looking
 * at or over WHAT it was drawn. The same cards that say what a run reads can
 * say what the map draws, and then the two are one vocabulary instead of two.
 *
 * THE CHOICES HERE ARE NOT PROJECT DATA. They are what this window is looking
 * at, like `overlays`, so they live in this browser and not in the file: two
 * windows on one project are allowed to look at different things. A region
 * naming an area that has since been deleted falls back to the whole register
 * rather than drawing nothing.
 */

/** The layers this graph can put on the map: the ones read from the grid store. */
export type MapLayerKey = Extract<
  keyof Overlays,
  "gridConcessions" | "gridDemand" | "gridMetered" | "gridRegistered" | "gridLines" | "gridBuses"
>

export const MAP_LAYERS: { key: MapLayerKey; label: string; what: string }[] = [
  {
    key: "gridConcessions",
    label: "Where each register has data",
    what: "The ground each register loaded in the store covers. A demand reading outside every one of these comes back empty.",
  },
  {
    key: "gridDemand",
    label: "Consumption by municipality",
    what: "What the units of each register consume, by municipality, on IBGE's mesh. Says where the demand is before any ground is chosen.",
  },
  {
    key: "gridMetered",
    label: "Plants in the record",
    what: "Plants ANEEL registers that are also in ONS's operational record, so a connection reading over them reports what they lost.",
  },
  {
    key: "gridRegistered",
    label: "Registered only",
    what: "Plants ANEEL registers that the operational record does not cover. An absence of measurement, not a curtailment of zero.",
  },
  { key: "gridLines", label: "Transmission lines", what: "The transmission network, drawn terminal to terminal as the register publishes it." },
  { key: "gridBuses", label: "Substations", what: "Substation buses, published at one coordinate per station." },
]

export const layerMeta = (key: MapLayerKey) => MAP_LAYERS.find((l) => l.key === key) ?? MAP_LAYERS[0]

/**
 * Which layers the Region card actually scopes.
 *
 * Written down rather than assumed, because the Map card must not claim a
 * clip that the map does not perform: for every other layer the region is
 * chosen and ignored, and saying so is the difference between a setting and
 * a decoration.
 */
export const REGION_AWARE: readonly MapLayerKey[] = ["gridConcessions", "gridDemand"]

/**
 * A layer cut to a region, BY THE FEATURE'S MIDDLE and not by intersection.
 *
 * A municipality half inside a region is drawn whole or not at all: its
 * figure is the whole municipality's, so clipping the SHAPE would draw a part
 * of it labelled with the whole's number. Which side its middle falls on is
 * the honest cut.
 *
 * Here rather than in mapEngine because the card that reports what is drawn
 * has to count exactly what the map drew; two implementations of this would
 * eventually disagree, and the disagreement would be a caption that lies.
 */
export function clipFeatures(fc: FeatureCollection, region: Polygon | null): FeatureCollection {
  if (!region) return fc
  return {
    type: "FeatureCollection",
    features: fc.features.filter((f) => {
      if (!f.geometry) return false
      const c = centroidOf(f.geometry as { type: string; coordinates: unknown })
      return !!c && pointInPolygon(c.lon, c.lat, region)
    }),
  }
}

/**
 * The ground a layer is scoped to.
 *
 * A REGION IS NOT AN AREA, and conflating the two was a mistake worth naming.
 * An area is a thing the project owns: it is analysed, it has results, it is
 * saved with the file. A region is a viewport filter -- "show me this layer
 * over Sergipe" -- and it is thrown away the moment the reader picks another.
 * Taking a region used to add an area, so every boundary tried while looking
 * around was left behind on the map with nothing to manage it.
 *
 * So a region is one of three things: nothing at all, an area the project
 * already has (it follows that area, and falls back to nothing if it is
 * deleted), or a boundary this graph owns outright and the project never
 * hears about.
 */
export type MapRegion =
  | { kind: "area"; id: string }
  | { kind: "place"; name: string; polygon: Polygon }

export type MapGraph = {
  /** Which layer the graph configures. */
  layer: MapLayerKey
  /** Null for every ground the register itself reaches. */
  region: MapRegion | null
}

/** The region as a name and a shape, resolved against the project. */
export function resolveRegion(
  region: MapRegion | null,
  areas: readonly { id: string; name: string; polygon: Polygon }[]
): { name: string; polygon: Polygon } | null {
  if (!region) return null
  if (region.kind === "place") return { name: region.name, polygon: region.polygon }
  const area = areas.find((a) => a.id === region.id)
  return area ? { name: area.name, polygon: area.polygon } : null
}

/*
  One region at a time, so what this holds is bounded: a state boundary at
  IBGE's finest mesh measures 36 kB (Piaui), 44 kB (Sao Paulo), 60 kB (Bahia)
  once serialised beside the layer key. Against a 5 MB quota that is nothing,
  and it buys a region that survives a restart without the project carrying it.
*/
const KEY = "terra-energy.mapGraph.v2"

function restore(): MapGraph {
  const fallback: MapGraph = { layer: "gridDemand", region: null }
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<MapGraph>) }
  } catch {
    return fallback
  }
}

export const mapGraph = createStore<MapGraph>(restore())

mapGraph.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(mapGraph.get()))
  } catch {
    // A browser that refuses storage still draws; only the choice is forgotten.
  }
})

export function setMapGraph(patch: Partial<MapGraph>): void {
  mapGraph.set((g) => ({ ...g, ...patch }))
}

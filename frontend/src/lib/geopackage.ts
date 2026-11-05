import type { FeatureCollection } from "geojson"
import type { Map as MapLibreMap, GeoJSONSource, ExpressionSpecification, PointLike } from "maplibre-gl"
import { GeoPackageFeature, GeoPackageFeatures } from "../../wailsjs/go/main/App"
import { errorMessage } from "./errors"
import { createStore } from "./store"
import { drawnFields, featureColor, normalizeColor, paletteColor, titleField, type PackageField, type PackageStyle } from "./geopackageStyle"
import { pickedGeoPackage, type PickedGeoPackage } from "./mapState"
import { mapInsetRight } from "./shell"

export type PackageLayer = { name: string; label: string; geometry: string; count: number; bbox: number[] | null; error: string | null; style?: PackageStyle; fields?: PackageField[]; pk?: string | null }
export type GeoPackageCatalog = { path: string; name: string; layers: PackageLayer[] }
/** A view too crowded to draw one by one: how many features it holds, and the most any cell holds. */
export type Counted = { inView: number; largest: number }
export type LayerView = { visible: boolean; color: string; loading: boolean; message: string; error: string; counted: Counted | null }
export type PackageDisplay = { visibleLayers?: string[]; colors?: Record<string, string> }
type Cells = { zoom: number; items: number[][] }
type Preview = { geojson: FeatureCollection; cells?: Cells; in_view?: number; limited: boolean; skipped: number; indexed: boolean }
export const geoPackage = createStore<{
  file: GeoPackageCatalog | null; layer: string; opening: boolean; views: Record<string, LayerView>
}>({ file: null, layer: "", opening: false, views: {} })

const PREFIX = "local-geopackage-"
const COLOR = "__solara_display_color"
const COUNT = "__solara_count"
const RADIUS = "__solara_radius"
const CELL = "__solara_cell"

/** Features the sidecar draws one by one in a view; past this it counts them per cell. */
export const PREVIEW_LIMIT = 5000

/** A counted cell's radius in px: its area grows with its count, up to the largest cell in view. */
export function countRadius(count: number, largest: number): number {
  return 2 + 11 * Math.sqrt(count / largest)
}

/** The ground a counted cell covers, from its tile address. */
export function cellBounds(z: number, x: number, y: number): [[number, number], [number, number]] {
  const n = 2 ** z
  const lon = (i: number) => i / n * 360 - 180
  const lat = (j: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * j / n))) * 180 / Math.PI
  return [[lon(x), lat(y + 1)], [lon(x + 1), lat(y)]]
}

/** A crowded view's cells as points for the count layer, each at the mean of its features. */
function cellCollection(cells: Cells, color: string): { collection: FeatureCollection; largest: number } {
  const largest = cells.items.reduce((most, c) => Math.max(most, c[2]), 1)
  return {
    largest,
    collection: {
      type: "FeatureCollection",
      features: cells.items.map(([x, y, count, lon, lat]) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { [COUNT]: count, [RADIUS]: countRadius(count, largest), [CELL]: `${cells.zoom}/${x}/${y}`, [COLOR]: color },
      })),
    },
  }
}
const empty = (): FeatureCollection => ({ type: "FeatureCollection", features: [] })
type Renderer = { source: string; ids: string[] }
const renderers = new Map<string, Renderer>()
let map: MapLibreMap | null = null
let nextId = 0
let version = 0
let pending = false
let active = false
let timer: ReturnType<typeof setTimeout> | undefined

/**
 * What a preview carries besides the primary key: the attributes the map
 * colours by and the one a feature is called by. A click reads the rest.
 * A layer without a primary key cannot be read feature by feature, so its
 * preview carries every attribute instead.
 */
function previewFields(layer: PackageLayer): string[] {
  if (!layer.pk) return (layer.fields ?? []).map(f => f.name)
  const title = titleField(layer.fields)
  return [...drawnFields(layer.style, layer.fields), ...(title ? [title] : [])]
}

function updateView(name: string, patch: Partial<LayerView>) {
  geoPackage.set(s => s.views[name] ? { ...s, views: { ...s.views, [name]: { ...s.views[name], ...patch } } } : s)
}

function removeRenderers() {
  for (const { ids, source } of renderers.values()) {
    for (const id of ids) if (map?.getLayer(id)) map.removeLayer(id)
    if (map?.getSource(source)) map.removeSource(source)
  }
  renderers.clear()
}

export function loadGeoPackage(file: GeoPackageCatalog, selectedLayer?: string, display?: PackageDisplay): void {
  version++
  pending = false
  pickedGeoPackage.set(null)
  removeRenderers()
  const start = Math.random() * 360
  const views: Record<string, LayerView> = {}
  file.layers.forEach((l, i) => {
    views[l.name] = { visible: false, color: normalizeColor(l.style?.color) ?? normalizeColor(display?.colors?.[l.name]) ?? paletteColor(i, start), loading: false, message: "", error: "", counted: null }
  })
  const available = file.layers.filter(l => !l.error && l.count > 0)
  const initial = available.find(l => l.name === selectedLayer) ?? available.find(l => l.name === "substation") ?? available.find(l => l.bbox) ?? available[0]
  const shown = display?.visibleLayers ?? (initial ? [initial.name] : [])
  for (const name of shown) if (views[name] && !file.layers.find(l => l.name === name)?.error) views[name].visible = true
  geoPackage.set(s => ({ ...s, file, layer: initial?.name ?? "", views }))
  for (const name of shown) if (views[name]?.visible) ensureRenderer(name)
  if (initial) framePackageLayer(initial.name)
  schedule()
}

function ensureRenderer(name: string): Renderer | undefined {
  if (!map) return
  const previous = renderers.get(name)
  if (previous) return previous
  const source = PREFIX + nextId++
  const ids = [source + "-fill", source + "-line", source + "-point", source + "-count"]
  const fallback = geoPackage.get().views[name]?.color ?? "#80bfff"
  const color: ExpressionSpecification = ["coalesce", ["get", COLOR], fallback]
  map.addSource(source, { type: "geojson", data: empty() })
  map.addLayer({ id: ids[0], type: "fill", source, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": 0.24 } }, "area-fill")
  map.addLayer({ id: ids[1], type: "line", source, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": color, "line-width": 1.8 } }, "area-fill")
  map.addLayer({ id: ids[2], type: "circle", source, filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", COUNT]]], paint: { "circle-color": color, "circle-radius": 4.5, "circle-stroke-color": "#17252b", "circle-stroke-width": 1 } }, "area-fill")
  map.addLayer({ id: ids[3], type: "circle", source, filter: ["has", COUNT], paint: { "circle-color": color, "circle-opacity": 0.7, "circle-radius": ["get", RADIUS], "circle-stroke-color": "#14181c", "circle-stroke-width": 0.8 } }, "area-fill")
  const renderer = { source, ids }
  renderers.set(name, renderer)
  return renderer
}

export function framePackageLayer(name: string): void {
  const layer = geoPackage.get().file?.layers.find(l => l.name === name)
  if (layer?.bbox && map) {
    const [w, s, e, n] = layer.bbox
    map.fitBounds([[w, s], [e, n]], { padding: { top: 48, bottom: 48, left: 48, right: 48 + mapInsetRight.get() }, maxZoom: 15, duration: 400 })
  }
}

/** Choosing an analysis layer adds it to the map without hiding other layers. */
export function choosePackageLayer(name: string): void {
  const state = geoPackage.get()
  if (!state.views[name]) return
  geoPackage.set(s => ({ ...s, layer: name }))
  if (!state.file?.layers.find(l => l.name === name)?.error) setPackageLayerVisible(name, true)
  framePackageLayer(name)
}

export function setPackageLayerVisible(name: string, visible: boolean): void {
  const state = geoPackage.get()
  if (!state.views[name] || state.file?.layers.find(l => l.name === name)?.error) return
  updateView(name, { visible, loading: false, ...(visible ? {} : { counted: null }) })
  const renderer = visible ? ensureRenderer(name) : renderers.get(name)
  for (const id of renderer?.ids ?? []) if (map?.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none")
  if (!visible && renderer) map?.getSource<GeoJSONSource>(renderer.source)?.setData(empty())
  if (!visible && pickedGeoPackage.get()?.layer === name) pickedGeoPackage.set(null)
  schedule()
}

export function togglePackageVisibility(name = geoPackage.get().layer): void {
  setPackageLayerVisible(name, !geoPackage.get().views[name]?.visible)
}

export function closeGeoPackage(): void {
  version++
  pending = false
  clearTimeout(timer)
  pickedGeoPackage.set(null)
  removeRenderers()
  geoPackage.set(s => ({ ...s, file: null, layer: "", views: {} }))
}

function schedule() {
  version++
  clearTimeout(timer)
  timer = setTimeout(() => { pending = true; void refresh() }, 250)
}

async function refresh(): Promise<void> {
  if (active || !pending || !map) return
  pending = false
  const state = geoPackage.get()
  if (!state.file) return
  const token = version
  const b = map.getBounds()
  const bbox = [Math.max(-180, b.getWest()), Math.max(-90, b.getSouth()), Math.min(180, b.getEast()), Math.min(90, b.getNorth())]
  const zoom = Math.min(24, Math.max(0, map.getZoom()))
  if (bbox[0] >= bbox[2]) return
  const queue = state.file.layers.filter(l => state.views[l.name]?.visible && !l.error)
  if (!queue.length) return
  active = true
  for (const l of queue) updateView(l.name, { loading: true, error: "" })
  const worker = async () => {
    while (queue.length && token === version) {
      const layer = queue.shift()!
      try {
        const result = await GeoPackageFeatures(state.file!.path, layer.name, bbox, previewFields(layer), zoom) as unknown as Preview
        if (token !== version || !geoPackage.get().views[layer.name]?.visible) continue
        const renderer = ensureRenderer(layer.name)
        const color = state.views[layer.name].color
        const cells = result.cells ? cellCollection(result.cells, color) : null
        if (!cells) for (const feature of result.geojson.features) feature.properties = { ...feature.properties, [COLOR]: featureColor(feature, layer.style, color) }
        if (renderer) map?.getSource<GeoJSONSource>(renderer.source)?.setData(cells?.collection ?? result.geojson)
        // Said only when something is missing from the map: a view drawn whole, or counted, needs no note.
        const notes = [
          result.limited ? "Preview limit reached; zoom in" : "",
          result.skipped ? `${result.skipped} geometries could not be displayed` : "",
          !result.indexed ? "No spatial index; scans up to 50,000 records" : "",
        ].filter(Boolean)
        updateView(layer.name, { loading: false, message: notes.join(" · "), counted: cells ? { inView: result.in_view ?? 0, largest: cells.largest } : null })
      } catch (e) {
        if (token !== version) continue
        const renderer = renderers.get(layer.name)
        if (renderer) map?.getSource<GeoJSONSource>(renderer.source)?.setData(empty())
        updateView(layer.name, { loading: false, error: errorMessage(e), message: "", counted: null })
      }
    }
  }
  try { await Promise.all([worker(), worker()]) }
  finally {
    active = false
    if (pending) void refresh()
  }
}

/** Attach once to the application's single map. Each visible layer has its own source. */
export function attachGeoPackage(m: MapLibreMap): void {
  map = m
  for (const [name, view] of Object.entries(geoPackage.get().views)) if (view.visible) ensureRenderer(name)
  m.on("moveend", schedule)
  if (geoPackage.get().layer) framePackageLayer(geoPackage.get().layer)
  schedule()
}

/**
 * A click on a counted cell frames the cell, which is how its features are
 * reached: a view of one cell holds fewer of them. True when it did.
 */
export function frameCountedCell(m: MapLibreMap, point: PointLike): boolean {
  const ids = [...renderers].filter(([name]) => geoPackage.get().views[name]?.visible).map(([, r]) => r.ids[3])
  if (!ids.length) return false
  const cell = m.queryRenderedFeatures(point, { layers: ids })[0]?.properties?.[CELL]
  if (typeof cell !== "string") return false
  const [z, x, y] = cell.split("/").map(Number)
  m.fitBounds(cellBounds(z, x, y), { padding: { top: 48, bottom: 48, left: 48, right: 48 + mapInsetRight.get() }, duration: 400 })
  return true
}

/**
 * Identify the feature; OverlayCallouts owns its presentation, like the grid's.
 * The pick shows what the preview holds at once, and the whole feature when it arrives.
 */
export function pickGeoPackage(m: MapLibreMap, point: PointLike, at: [number, number]): PickedGeoPackage | null {
  const state = geoPackage.get()
  // The count layer is the fourth; a counted cell is framed, not identified (frameCountedCell).
  const ids = [...renderers].filter(([name]) => state.views[name]?.visible).flatMap(([, r]) => r.ids.slice(0, 3))
  if (!ids.length || !state.file) return null
  const feature = m.queryRenderedFeatures(point, { layers: ids })[0]
  if (!feature) return null
  const layer = [...renderers].find(([, r]) => r.ids.includes(feature.layer.id))?.[0]
  if (!layer) return null
  const source = state.file.layers.find(l => l.name === layer)
  const props = Object.fromEntries(Object.entries(feature.properties ?? {}).filter(([key]) => !key.startsWith("__solara_")))
  const id = source?.pk ? props[source.pk] : undefined
  const fid = typeof id === "number" && Number.isInteger(id) ? id : null
  const picked: PickedGeoPackage = {
    at, layer, label: source?.label ?? layer,
    file: state.file.name, geometry: feature.geometry.type,
    color: normalizeColor(feature.properties?.[COLOR]) ?? state.views[layer].color,
    props, fields: source?.fields ?? [], fid, status: fid === null ? "preview" : "reading", shape: null,
  }
  if (fid !== null) void readWhole(state.file.path, picked, fid)
  return picked
}

/** Replaces the pick's preview attributes with the feature's own, unless another pick has taken its place. */
async function readWhole(path: string, picked: PickedGeoPackage, fid: number): Promise<void> {
  try {
    const whole = await GeoPackageFeature(path, picked.layer, fid)
    pickedGeoPackage.set(p => p === picked ? { ...p, props: whole.properties ?? p.props, shape: whole.geometry ?? null, status: "whole" } : p)
  } catch (e) {
    pickedGeoPackage.set(p => p === picked ? { ...p, status: "failed", error: errorMessage(e) } : p)
  }
}

/** Past this many layers, a GeoPackage's are grouped by the prefix of their names. */
export const GROUP_PAST = 15

/**
 * A GeoPackage's layers in the order the file lists them, with those sharing a
 * name's prefix (before the first underscore) gathered into one group when the
 * file has more than GROUP_PAST of them. A prefix only one layer has stays a
 * layer: a group of one is a folder to open for nothing.
 */
export function groupLayers(layers: PackageLayer[]): (PackageLayer | { prefix: string; layers: PackageLayer[] })[] {
  if (layers.length <= GROUP_PAST) return layers
  const byPrefix = new Map<string, PackageLayer[]>()
  for (const layer of layers) {
    const prefix = layer.name.split("_")[0]
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), layer])
  }
  return [...byPrefix].map(([prefix, members]) => (members.length > 1 ? { prefix, layers: members } : members[0]))
}

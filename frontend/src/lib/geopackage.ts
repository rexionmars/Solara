import type { FeatureCollection } from "geojson"
import type { Map as MapLibreMap, GeoJSONSource, ExpressionSpecification, PointLike } from "maplibre-gl"
import { GeoPackageFeatures } from "../../wailsjs/go/main/App"
import { errorMessage } from "./errors"
import { createStore } from "./store"
import { featureColor, normalizeColor, paletteColor, type PackageStyle } from "./geopackageStyle"
import { pickedGeoPackage, type PickedGeoPackage } from "./mapState"

export type PackageLayer = { name: string; label: string; geometry: string; count: number; bbox: number[] | null; error: string | null; style?: PackageStyle }
export type GeoPackageCatalog = { path: string; name: string; layers: PackageLayer[] }
export type LayerView = { visible: boolean; color: string; loading: boolean; message: string; error: string }
export type PackageDisplay = { visibleLayers?: string[]; colors?: Record<string, string> }
type Preview = { geojson: FeatureCollection; limited: boolean; skipped: number; indexed: boolean }
export const geoPackage = createStore<{
  file: GeoPackageCatalog | null; layer: string; opening: boolean; views: Record<string, LayerView>
}>({ file: null, layer: "", opening: false, views: {} })

const PREFIX = "local-geopackage-"
const COLOR = "__solara_display_color"
const empty = (): FeatureCollection => ({ type: "FeatureCollection", features: [] })
type Renderer = { source: string; ids: string[] }
const renderers = new Map<string, Renderer>()
let map: MapLibreMap | null = null
let nextId = 0
let version = 0
let pending = false
let active = false
let timer: ReturnType<typeof setTimeout> | undefined

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
    views[l.name] = { visible: false, color: normalizeColor(l.style?.color) ?? normalizeColor(display?.colors?.[l.name]) ?? paletteColor(i, start), loading: false, message: "", error: "" }
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
  const ids = [source + "-fill", source + "-line", source + "-point"]
  const fallback = geoPackage.get().views[name]?.color ?? "#80bfff"
  const color: ExpressionSpecification = ["coalesce", ["get", COLOR], fallback]
  map.addSource(source, { type: "geojson", data: empty() })
  map.addLayer({ id: ids[0], type: "fill", source, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": 0.24 } }, "area-fill")
  map.addLayer({ id: ids[1], type: "line", source, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": color, "line-width": 1.8 } }, "area-fill")
  map.addLayer({ id: ids[2], type: "circle", source, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": color, "circle-radius": 4.5, "circle-stroke-color": "#17252b", "circle-stroke-width": 1 } }, "area-fill")
  const renderer = { source, ids }
  renderers.set(name, renderer)
  return renderer
}

export function framePackageLayer(name: string): void {
  const layer = geoPackage.get().file?.layers.find(l => l.name === name)
  if (layer?.bbox && map) {
    const [w, s, e, n] = layer.bbox
    map.fitBounds([[w, s], [e, n]], { padding: 48, maxZoom: 15, duration: 400 })
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
  updateView(name, { visible, loading: false })
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
  if (bbox[0] >= bbox[2]) return
  const queue = state.file.layers.filter(l => state.views[l.name]?.visible && !l.error)
  if (!queue.length) return
  active = true
  for (const l of queue) updateView(l.name, { loading: true, error: "" })
  const worker = async () => {
    while (queue.length && token === version) {
      const layer = queue.shift()!
      try {
        const result = await GeoPackageFeatures(state.file!.path, layer.name, bbox) as Preview
        if (token !== version || !geoPackage.get().views[layer.name]?.visible) continue
        const renderer = ensureRenderer(layer.name)
        const color = state.views[layer.name].color
        for (const feature of result.geojson.features) feature.properties = { ...feature.properties, [COLOR]: featureColor(feature, layer.style, color) }
        if (renderer) map?.getSource<GeoJSONSource>(renderer.source)?.setData(result.geojson)
        const count = result.geojson.features.length.toLocaleString()
        updateView(layer.name, { loading: false, message: `${count} features in view${result.limited ? " · Preview limit reached; zoom in" : ""}${result.skipped ? ` · ${result.skipped} geometries could not be displayed` : ""}${!result.indexed ? " · No spatial index; scans up to 50,000 records" : ""}` })
      } catch (e) {
        if (token !== version) continue
        const renderer = renderers.get(layer.name)
        if (renderer) map?.getSource<GeoJSONSource>(renderer.source)?.setData(empty())
        updateView(layer.name, { loading: false, error: errorMessage(e), message: "" })
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

/** Identify the feature; OverlayCallouts owns its presentation, like the grid's. */
export function pickGeoPackage(m: MapLibreMap, point: PointLike, at: [number, number]): PickedGeoPackage | null {
  const state = geoPackage.get()
  const ids = [...renderers].filter(([name]) => state.views[name]?.visible).flatMap(([, r]) => r.ids)
  if (!ids.length || !state.file) return null
  const feature = m.queryRenderedFeatures(point, { layers: ids })[0]
  if (!feature) return null
  const layer = [...renderers].find(([, r]) => r.ids.includes(feature.layer.id))?.[0]
  if (!layer) return null
  return {
    at, layer, label: state.file.layers.find(l => l.name === layer)?.label ?? layer,
    file: state.file.name, geometry: feature.geometry.type,
    color: normalizeColor(feature.properties?.[COLOR]) ?? state.views[layer].color,
    props: Object.fromEntries(Object.entries(feature.properties ?? {}).filter(([key]) => !key.startsWith("__solara_"))),
  }
}

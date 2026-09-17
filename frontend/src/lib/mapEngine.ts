import type { Feature, FeatureCollection } from "geojson"
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type ImageSource,
  type MapMouseEvent,
} from "maplibre-gl"
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw"
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter"
import { BASEMAP_FIRST_LABEL, BASEMAP_STYLE } from "./basemap"
import { ACTIVE, AREA, SITE, SITE_OUTLINE } from "./colors"
import { bounds, distanceKm, ringCentre } from "./geo"
import { addArea } from "./objects"
import { beginStep, findItem, isResult, mutate, project, type AnyItem, type TerrainResult } from "./project"
import { runOperator } from "./operators"
import { select, selection } from "./selection"
import { HOME_VIEW, cursor, mapMounted, mapView, measure } from "./mapState"
import { activeTool, overlays, setTool } from "./tools"
import { openContextMenu, type MenuItem } from "./ui"

/**
 * The one map, and everything drawn on it.
 *
 * MapLibre holds a WebGL context and every tile it has loaded, and the webview
 * stops creating contexts after a small number, so the map is created once and
 * its element is moved into whichever area shows the Map editor. Switching
 * workspace or editor moves the element; nothing is reloaded.
 */

/*
  MapLibre finds its worker next to its own module, which no longer holds once
  the module is bundled: the dev server answers 404 and the build leaves the
  worker out. Vector tiles are decoded in the worker, so without it the map
  draws its background and nothing else. Vite bundles the worker here instead.
*/
setWorkerUrl(maplibreWorkerUrl)

let map: MapLibreMap | null = null
let host: HTMLDivElement | null = null

/** Put the map into `container`. Returns the function that takes it out again. */
export function mountMap(container: HTMLElement): () => void {
  if (!host) {
    host = document.createElement("div")
    host.style.position = "absolute"
    host.style.inset = "0"
  }
  container.appendChild(host)
  if (!map) create(host)
  else map.resize()
  mapMounted.set(true)
  return () => {
    if (host && host.parentElement === container) container.removeChild(host)
    mapMounted.set(host?.isConnected ?? false)
  }
}

// ---- Layer ids ----------------------------------------------------------------

const SITES = "sites"
const AREAS = "areas"
const AREA_LABELS = "area-labels"
const MEASURE = "measure"
const TERRAIN_PREFIX = "terrain-"

/** The source and scene object a result's layer is drawn with. */
const terrainLayerId = (r: TerrainResult) => TERRAIN_PREFIX + r.id

function create(container: HTMLDivElement): void {
  const m = new MapLibreMap({
    container,
    style: BASEMAP_STYLE,
    ...HOME_VIEW,
    // The credit is drawn at the editor's foot instead, as TERRA draws it: a
    // licensing obligation rather than map chrome, with links that open.
    attributionControl: false,
  })
  map = m
  new ResizeObserver(() => m.resize()).observe(container)

  const onMove = () => {
    const c = m.getCenter()
    mapView.set({ lng: c.lng, lat: c.lat, zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() })
  }
  m.on("move", onMove)
  onMove()
  m.on("mouseout", () => cursor.set(null))

  m.on("load", () => {
    addLayers(m)
    draw = startDraw(m)
    syncAll()
    project.subscribe(syncAll)
    selection.subscribe(syncAll)
    overlays.subscribe(syncAll)
    measure.subscribe(syncMeasure)
    activeTool.subscribe(syncTool)
    syncTool()
  })

  m.on("click", onClick)
  m.on("mousedown", onMouseDown)
  m.on("mousemove", onMouseMove)
  m.on("contextmenu", onContextMenu)
}

function empty(): FeatureCollection {
  return { type: "FeatureCollection", features: [] }
}

// Selected objects are drawn in the active orange, as Blender draws the active object.
const selectedColour = (base: string): ExpressionSpecification => ["case", ["get", "selected"], ACTIVE, base]

function addLayers(m: MapLibreMap): void {
  m.addSource(AREAS, { type: "geojson", data: empty() })
  m.addSource(AREA_LABELS, { type: "geojson", data: empty() })
  m.addSource(SITES, { type: "geojson", data: empty() })
  m.addSource(MEASURE, { type: "geojson", data: empty() })

  // Areas under the basemap's labels, so place names stay readable over them.
  m.addLayer(
    {
      id: "area-fill",
      type: "fill",
      source: AREAS,
      paint: { "fill-color": selectedColour(AREA), "fill-opacity": ["case", ["get", "selected"], 0.16, 0.08] },
    },
    BASEMAP_FIRST_LABEL
  )
  m.addLayer(
    {
      id: "area-line",
      type: "line",
      source: AREAS,
      paint: { "line-color": selectedColour(AREA), "line-width": ["case", ["get", "selected"], 2.5, 1.5] },
    },
    BASEMAP_FIRST_LABEL
  )

  // Sites, the measure and every label above the basemap: they are what is clicked.
  m.addLayer({
    id: "area-label",
    type: "symbol",
    source: AREA_LABELS,
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 12 },
    paint: {
      "text-color": selectedColour("#e6e6e6"),
      "text-halo-color": "#161616",
      "text-halo-width": 1.4,
    },
  })
  m.addLayer({
    id: "site-circle",
    type: "circle",
    source: SITES,
    paint: {
      "circle-radius": ["case", ["get", "selected"], 7, 6],
      "circle-color": selectedColour(SITE),
      "circle-stroke-color": SITE_OUTLINE,
      "circle-stroke-width": 2,
    },
  })
  m.addLayer({
    id: "site-label",
    type: "symbol",
    source: SITES,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
      "text-anchor": "left",
      "text-offset": [0.9, 0],
      "text-optional": true,
    },
    paint: { "text-color": selectedColour("#e6e6e6"), "text-halo-color": "#161616", "text-halo-width": 1.4 },
  })
  m.addLayer({
    id: "measure-line",
    type: "line",
    source: MEASURE,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 1.5] },
  })
  m.addLayer({
    id: "measure-point",
    type: "circle",
    source: MEASURE,
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": "#161616", "circle-stroke-width": 1.5 },
  })
  m.addLayer({
    id: "measure-label",
    type: "symbol",
    source: MEASURE,
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 12 },
    paint: { "text-color": "#ffffff", "text-halo-color": "#161616", "text-halo-width": 1.6 },
  })
}

// ---- Keeping the layers in step with the project ----------------------------

/** The object drawn highlighted: the active object, or the source of the active result. */
function highlighted(): string | null {
  const d = project.get().data
  const item = findItem(d, selection.get().id)
  if (!item) return null
  return isResult(item) ? item.sourceId : item.id
}

function syncAll(): void {
  const m = map
  if (!m || !m.getSource(SITES)) return
  const d = project.get().data
  const o = overlays.get()
  const hi = highlighted()

  const sites: Feature[] = d.sites
    .filter((s) => !s.hidden)
    .map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: { id: s.id, name: o.siteLabels ? s.name : "", selected: s.id === hi },
    }))
  m.getSource<GeoJSONSource>(SITES)?.setData({ type: "FeatureCollection", features: sites })

  const visibleAreas = o.areas ? d.areas.filter((a) => !a.hidden) : []
  m.getSource<GeoJSONSource>(AREAS)?.setData({
    type: "FeatureCollection",
    features: visibleAreas.map((a) => ({
      type: "Feature",
      geometry: a.polygon,
      properties: { id: a.id, selected: a.id === hi },
    })),
  })
  m.getSource<GeoJSONSource>(AREA_LABELS)?.setData({
    type: "FeatureCollection",
    features: o.siteLabels
      ? visibleAreas.map((a) => {
          const c = ringCentre(a.polygon)
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [c.lon, c.lat] },
            properties: { id: a.id, name: a.name, selected: a.id === hi },
          }
        })
      : [],
  })

  syncTerrain(m)
}

/** One image layer per visible terrain result, newest on top, all under the areas. */
function syncTerrain(m: MapLibreMap): void {
  const d = project.get().data
  const wanted = overlays.get().layers
    ? d.results.filter((r): r is TerrainResult => r.kind === "terrain" && !r.hidden && !findItem(d, r.sourceId)?.hidden)
    : []
  const wantedIds = new Set(wanted.map(terrainLayerId))

  for (const layer of m.getStyle().layers ?? []) {
    if (layer.id.startsWith(TERRAIN_PREFIX) && !wantedIds.has(layer.id)) {
      m.removeLayer(layer.id)
      if (m.getSource(layer.id)) m.removeSource(layer.id)
    }
  }
  for (const r of wanted) {
    const id = terrainLayerId(r)
    const e = r.data.extent
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [e.lon_min, e.lat_max],
      [e.lon_max, e.lat_max],
      [e.lon_max, e.lat_min],
      [e.lon_min, e.lat_min],
    ]
    if (!m.getSource<ImageSource>(id)) {
      m.addSource(id, { type: "image", url: r.data.overlay_url, coordinates })
      m.addLayer(
        {
          id,
          type: "raster",
          source: id,
          // Nearest, so the 30 m cells read as cells: the layer is data, and
          // smoothing would draw structure the elevation model lacks.
          paint: { "raster-opacity": r.opacity, "raster-resampling": "nearest" },
        },
        "area-fill"
      )
    } else {
      m.setPaintProperty(id, "raster-opacity", r.opacity)
    }
  }
}

function syncMeasure(): void {
  const src = map?.getSource<GeoJSONSource>(MEASURE)
  if (!src) return
  const pts = measure.get()
  const hover = cursor.get()
  const features: Feature[] = pts.map((p) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    properties: {},
  }))
  // While only the start is placed, the line follows the pointer.
  const end = pts[1] ?? (pts.length === 1 && hover && activeTool.get() === "measure" ? { lon: hover.lng, lat: hover.lat } : null)
  if (pts[0] && end) {
    const km = distanceKm(pts[0], end)
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [pts[0].lon, pts[0].lat],
          [end.lon, end.lat],
        ],
      },
      properties: { label: km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km` },
    })
  }
  src.setData({ type: "FeatureCollection", features })
}

// ---- Tools --------------------------------------------------------------------

let draw: TerraDraw | null = null

/*
  terra-draw is used for the gesture only. A finished polygon becomes an area
  in the project and is cleared from terra-draw, and the area is drawn from the
  project as an ordinary layer. TERRA kept the finished shape inside terra-draw
  and synchronised the two in both directions, and most of its drawing defects
  were that synchronisation reporting itself as an edit.
*/
function startDraw(m: MapLibreMap): TerraDraw {
  const d = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map: m }),
    modes: [
      new TerraDrawPolygonMode({
        styles: { fillColor: ACTIVE, fillOpacity: 0.12, outlineColor: ACTIVE, outlineWidth: 2 },
      }),
    ],
  })
  d.start()
  d.on("finish", (id) => {
    const feature = d.getSnapshot().find((f) => f.id === id)
    if (feature?.geometry.type === "Polygon") {
      addArea({ type: "Polygon", coordinates: feature.geometry.coordinates })
      // Deferred: the finish is reported from inside terra-draw's own
      // handler, and clearing its store there would change it under the caller.
      queueMicrotask(() => d.clear())
    }
  })
  return d
}

function syncTool(): void {
  const m = map
  if (!m) return
  const tool = activeTool.get()
  if (draw) {
    if (tool === "area") {
      if (draw.getMode() !== "polygon") draw.setMode("polygon")
    } else {
      if (draw.getMode() !== "static") draw.setMode("static")
      if (draw.getSnapshot().length) draw.clear()
    }
  }
  // A double click closes a polygon; it must not also zoom.
  if (tool === "area") m.doubleClickZoom.disable()
  else m.doubleClickZoom.enable()
  if (tool !== "measure") measure.set([])
  m.getCanvas().style.cursor = tool === "select" ? "" : "crosshair"
}

const PICK_LAYERS = ["site-circle", "area-fill"]

/** The site or area under a point, sites first: a site drawn inside an area is the smaller target. */
function pick(m: MapLibreMap, point: { x: number; y: number }): AnyItem | null {
  const pad = 5
  const box: [[number, number], [number, number]] = [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ]
  const layers = PICK_LAYERS.filter((l) => m.getLayer(l))
  const hits = m.queryRenderedFeatures(box, { layers })
  const site = hits.find((f) => f.layer.id === "site-circle")
  const hit = site ?? hits.find((f) => f.layer.id === "area-fill")
  const id = hit?.properties?.id
  return typeof id === "string" ? findItem(project.get().data, id) : null
}

let drag: { id: string; moved: boolean } | null = null
// A drag ends in a click event; that click must not also change the selection.
let swallowClick = false

function onMouseDown(e: MapMouseEvent): void {
  if (activeTool.get() !== "select" || e.originalEvent.button !== 0) return
  const item = pick(e.target, e.point)
  if (item?.kind !== "site") return
  select(item.id)
  drag = { id: item.id, moved: false }
  e.target.dragPan.disable()
  const end = () => {
    e.target.dragPan.enable()
    if (drag?.moved) swallowClick = true
    drag = null
    window.removeEventListener("mouseup", end)
  }
  window.addEventListener("mouseup", end)
}

function onMouseMove(e: MapMouseEvent): void {
  cursor.set({ lng: e.lngLat.lng, lat: e.lngLat.lat })
  const tool = activeTool.get()
  if (drag) {
    if (!drag.moved) {
      beginStep("Move Site")
      drag.moved = true
    }
    const id = drag.id
    mutate((d) => ({
      ...d,
      sites: d.sites.map((s) => (s.id === id ? { ...s, lon: e.lngLat.lng, lat: e.lngLat.lat } : s)),
    }))
    return
  }
  if (tool === "select") {
    e.target.getCanvas().style.cursor = pick(e.target, e.point) ? "pointer" : ""
  } else if (tool === "measure" && measure.get().length === 1) {
    syncMeasure()
  }
}

function onClick(e: MapMouseEvent): void {
  if (swallowClick) {
    swallowClick = false
    return
  }
  const at = { lon: e.lngLat.lng, lat: e.lngLat.lat }
  switch (activeTool.get()) {
    case "select":
      select(pick(e.target, e.point)?.id ?? null)
      return
    case "site":
      void runOperator("SITE_ADD", [at.lat.toFixed(6), at.lon.toFixed(6)])
      return
    case "measure":
      measure.set((pts) => (pts.length >= 2 ? [at] : [...pts, at]))
      return
    case "area":
      // terra-draw handles the click.
      return
  }
}

function onContextMenu(e: MapMouseEvent): void {
  e.preventDefault()
  const item = pick(e.target, e.point)
  const at = { lon: e.lngLat.lng, lat: e.lngLat.lat }
  let items: MenuItem[]
  if (item?.kind === "site") {
    select(item.id)
    items = [
      { type: "op", op: "SOLAR" },
      { type: "op", op: "WIND" },
      { type: "sep" },
      { type: "op", op: "FRAME_SELECTED" },
      { type: "op", op: "RENAME" },
      { type: "op", op: "HIDE" },
      { type: "op", op: "DELETE" },
    ]
  } else if (item?.kind === "area") {
    select(item.id)
    items = [
      { type: "op", op: "TERRAIN" },
      { type: "sep" },
      { type: "op", op: "FRAME_SELECTED" },
      { type: "op", op: "RENAME" },
      { type: "op", op: "HIDE" },
      { type: "op", op: "DELETE" },
    ]
  } else {
    items = [
      {
        type: "action",
        label: "Add Site Here",
        run: () => void runOperator("SITE_ADD", [at.lat.toFixed(6), at.lon.toFixed(6)]),
      },
      { type: "op", op: "TOOL_AREA", label: "Draw Area" },
      { type: "sep" },
      {
        type: "action",
        label: "Copy Coordinates",
        run: () => void navigator.clipboard?.writeText(`${at.lat.toFixed(6)}, ${at.lon.toFixed(6)}`),
      },
      { type: "op", op: "FRAME_ALL" },
      { type: "op", op: "NORTH" },
    ]
  }
  openContextMenu(e.originalEvent, items, item?.name)
}

// ---- View ---------------------------------------------------------------------

/** Runs `action` on the map, reporting false when there is none yet. */
function withMap(action: (m: MapLibreMap) => void): boolean {
  if (!map) return false
  action(map)
  return true
}

export const zoomIn = () => withMap((m) => m.zoomIn())
export const zoomOut = () => withMap((m) => m.zoomOut())
export const resetNorth = () => withMap((m) => m.resetNorthPitch())
export const setBearing = (bearing: number) => withMap((m) => m.setBearing(bearing))

function frame(points: number[][]): boolean {
  return withMap((m) => {
    const b = bounds(points)
    if (!b) {
      m.flyTo({ ...HOME_VIEW, bearing: 0, pitch: 0 })
      return
    }
    if (b[0] === b[2] && b[1] === b[3]) {
      m.flyTo({ center: [b[0], b[1]], zoom: Math.max(m.getZoom(), 11) })
      return
    }
    m.fitBounds(b, { padding: 80, maxZoom: 13, duration: 700 })
  })
}

/** Frame every visible object, or the whole of Brazil when there is none (Home). */
export function frameAll(): boolean {
  const d = project.get().data
  const points = [
    ...d.sites.filter((s) => !s.hidden).map((s) => [s.lon, s.lat]),
    ...d.areas.filter((a) => !a.hidden).flatMap((a) => a.polygon.coordinates[0]),
  ]
  return frame(points)
}

/** Frame one object, or the source of a result. */
export function frameItem(item: AnyItem): boolean {
  const d = project.get().data
  const target = isResult(item) ? findItem(d, item.sourceId) : item
  if (target?.kind === "site") return frame([[target.lon, target.lat]])
  if (target?.kind === "area") return frame(target.polygon.coordinates[0])
  if (item.kind === "terrain") return frame(item.polygon.coordinates[0])
  if (item.kind === "solar" || item.kind === "wind") return frame([[item.site.lon, item.site.lat]])
  return false
}

/** Leave the drawing and measuring gestures: Escape. */
export function cancelGesture(): boolean {
  const tool = activeTool.get()
  if (tool === "select") return false
  setTool("select")
  return true
}

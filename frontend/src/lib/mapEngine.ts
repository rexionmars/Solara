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
import {
  beginStep,
  findItem,
  isResult,
  mutate,
  project,
  type AnyItem,
  type DemandResult,
  type TerrainResult,
} from "./project"
import { runOperator } from "./operators"
import { select, selection } from "./selection"
import { UNNAMED_VOLTAGE, VOLTAGE_COLOUR, loadNetwork, loadPlants, networkRegister, plantRegister } from "./grid"
import { HOME_VIEW, cursor, mapLoaded, mapMounted, mapView, measure, pickedGrid } from "./mapState"
import {
  RADAR_MAXZOOM,
  SATELLITE,
  fieldOf,
  frameAt,
  noteTileFailure,
  refreshRadar,
  refreshSatellite,
  refreshWind,
  weather,
  windAt,
  windDirection,
  windField,
  windProbe,
  type Frame,
} from "./weather"
import { LABEL_SOURCE, WindParticles, drawLabels, drawSpeed, removeLabels, removeSpeed } from "./windLayer"
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

/** The map, once created; for what draws over it from outside this module, as the tied legends. */
export const currentMap = (): MapLibreMap | null => map

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

// The grid store's registers.
const GRID_PLANTS = "grid-plants"
const GRID_LINES = "grid-lines"
const GRID_BUSES = "grid-buses"
const PLANT_OTHER = "grid-plants-other"
const PLANT_METERED = "grid-plants-metered"
const LINE_LAYER = "grid-lines"
const BUS_LAYER = "grid-buses"
const GRID_LAYERS = [LINE_LAYER, BUS_LAYER, PLANT_OTHER, PLANT_METERED]

/** The source and scene object a result's layer is drawn with. */
const terrainLayerId = (r: OverlayResult) => TERRAIN_PREFIX + r.id

/**
 * A result that draws a raster over its area: the terrain layer and the
 * demand layer. They share one sync because they share one rule -- newest on
 * top, all of them under the areas -- and two copies of it drifted in TERRA.
 */
type OverlayResult = TerrainResult | DemandResult

/** Where the layer is and what it covers, whichever product drew it. */
function overlayOf(r: OverlayResult) {
  return r.kind === "terrain" ? r.data : r.data.density
}

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
  m.on("mouseout", () => {
    cursor.set(null)
    windProbe.set(null)
  })

  m.on("load", () => {
    addLayers(m)
    mapLoaded.set(true)
    draw = startDraw(m)
    syncAll()
    project.subscribe(syncAll)
    selection.subscribe(syncAll)
    overlays.subscribe(syncAll)
    plantRegister.subscribe(syncGrid)
    networkRegister.subscribe(syncGrid)
    weather.subscribe(syncWeather)
    windField.subscribe(syncWind)
    measure.subscribe(syncMeasure)
    activeTool.subscribe(syncTool)
    syncTool()
  })

  // A weather tile refused -- RainViewer limits requests per address -- is said on the weather plate, not only in the console.
  m.on("error", (e) => {
    const sourceId = (e as { sourceId?: string }).sourceId
    if (sourceId?.startsWith(RADAR_PREFIX)) noteTileFailure("radar")
    else if (sourceId?.startsWith(SAT_PREFIX)) noteTileFailure("satellite")
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

/** A line's or bus's colour by its voltage, as ANEEL's own network map. */
const voltageColour = (): ExpressionSpecification =>
  ["match", ["get", "kv"], ...VOLTAGE_COLOUR.flatMap(({ kv, colour }) => [kv, colour]), UNNAMED_VOLTAGE] as unknown as ExpressionSpecification

/**
 * The grid registers, under the user's areas and every result layer: they are
 * the ground a question is drawn over, not an answer to it. Styled as TERRA
 * draws them. UNMETERED PLANTS FIRST, so a metered plant standing beside one
 * -- the register cuts arrays into 40 MW pieces a hundred metres apart -- is
 * drawn over it, because it is the one that can be asked about.
 */
function addGridLayers(m: MapLibreMap): void {
  m.addSource(GRID_LINES, { type: "geojson", data: empty() })
  m.addSource(GRID_BUSES, { type: "geojson", data: empty() })
  m.addSource(GRID_PLANTS, { type: "geojson", data: empty() })
  const hidden = { visibility: "none" as const }
  m.addLayer(
    {
      id: LINE_LAYER,
      type: "line",
      source: GRID_LINES,
      layout: hidden,
      paint: {
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          4, ["interpolate", ["linear"], ["coalesce", ["get", "kv"], 230], 230, 0.4, 800, 1.4],
          10, ["interpolate", ["linear"], ["coalesce", ["get", "kv"], 230], 230, 1.1, 800, 3],
        ],
        "line-color": voltageColour(),
        // Out of service is kept, faint: a line being built is still where a connection could go.
        "line-opacity": ["case", ["get", "in_service"], 0.75, 0.28],
      },
    },
    "area-fill"
  )
  m.addLayer(
    {
      id: BUS_LAYER,
      type: "circle",
      source: GRID_BUSES,
      layout: hidden,
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          4, ["interpolate", ["linear"], ["coalesce", ["get", "kv"], 69], 69, 0.8, 800, 2.4],
          10, ["interpolate", ["linear"], ["coalesce", ["get", "kv"], 69], 69, 2, 800, 5],
        ],
        "circle-color": "#0F1620",
        "circle-stroke-width": 1,
        "circle-stroke-color": voltageColour(),
        "circle-opacity": 0.85,
      },
    },
    "area-fill"
  )
  m.addLayer(
    {
      id: PLANT_OTHER,
      type: "circle",
      source: GRID_PLANTS,
      layout: hidden,
      filter: ["!", ["get", "metered"]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 1.4, 11, 2.6, 15, 4],
        "circle-color": "#9AA0A6",
        "circle-opacity": 0.5,
        "circle-stroke-width": 0,
      },
    },
    "area-fill"
  )
  m.addLayer(
    {
      id: PLANT_METERED,
      type: "circle",
      source: GRID_PLANTS,
      layout: hidden,
      filter: ["get", "metered"],
      paint: {
        // Area by capacity: a 400 MW complex and a 5 MW array should not be the same dot.
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          6, ["*", 0.55, ["sqrt", ["max", 1, ["coalesce", ["get", "mw"], 1]]]],
          11, ["*", 1.1, ["sqrt", ["max", 1, ["coalesce", ["get", "mw"], 1]]]],
          15, ["*", 1.9, ["sqrt", ["max", 1, ["coalesce", ["get", "mw"], 1]]]],
        ],
        "circle-color": "#ED8744",
        "circle-opacity": 0.55,
        "circle-stroke-width": 1.2,
        "circle-stroke-color": "#FFD9B8",
        "circle-stroke-opacity": 0.9,
      },
    },
    "area-fill"
  )
}

/**
 * Show the grid layers the overlays ask for, reading each register the first
 * time it is wanted. A register that failed stays empty; the Overlays popover
 * and Settings say why.
 */
function syncGrid(): void {
  const m = map
  if (!m || !m.getLayer(LINE_LAYER)) return
  const o = overlays.get()
  const show = (id: string, on: boolean) => m.setLayoutProperty(id, "visibility", on ? "visible" : "none")
  show(PLANT_METERED, o.gridMetered)
  show(PLANT_OTHER, o.gridRegistered)
  show(LINE_LAYER, o.gridLines)
  show(BUS_LAYER, o.gridBuses)
  if (o.gridMetered || o.gridRegistered) loadPlants()
  if (o.gridLines || o.gridBuses) loadNetwork()

  const plants = plantRegister.get()
  const network = networkRegister.get()
  const plantSource = m.getSource<GeoJSONSource>(GRID_PLANTS)
  const lineSource = m.getSource<GeoJSONSource>(GRID_LINES)
  const busSource = m.getSource<GeoJSONSource>(GRID_BUSES)
  // Set once per register: setData re-tiles the whole collection, which is seconds for the plants.
  if (plants.kind === "ready" && plantSource && loadedPlants !== plants.data) {
    plantSource.setData(plants.data.geojson)
    loadedPlants = plants.data
  }
  if (network.kind === "ready" && lineSource && busSource && loadedNetwork !== network.data) {
    lineSource.setData(network.data.lines)
    busSource.setData(network.data.substations)
    loadedNetwork = network.data
  }
  if (plants.kind !== "ready" && loadedPlants) {
    plantSource?.setData(empty())
    loadedPlants = null
  }
  if (network.kind !== "ready" && loadedNetwork) {
    lineSource?.setData(empty())
    busSource?.setData(empty())
    loadedNetwork = null
  }

  // A caption on a layer that has been hidden describes something no longer drawn.
  const picked = pickedGrid.get()
  if (
    picked &&
    ((picked.kind === "plant" && !(picked.props.metered ? o.gridMetered : o.gridRegistered)) ||
      (picked.kind === "line" && !o.gridLines) ||
      (picked.kind === "bus" && !o.gridBuses))
  ) {
    pickedGrid.set(null)
  }
}

// ---- The weather now ------------------------------------------------------------------

const SAT_PREFIX = "wx-sat-"
const RADAR_PREFIX = "wx-radar-"

/** How often the frame lists are asked for again while a weather overlay is on. */
const WEATHER_REFRESH_MS = 5 * 60_000
let weatherTimer: number | undefined

/** The frames that have been shown, per layer: they keep their layer, so going back is a redraw. */
const visitedFrames: Record<string, Set<string>> = { [SAT_PREFIX]: new Set(), [RADAR_PREFIX]: new Set() }

/**
 * The satellite and radar frames, one raster layer each, only the shown one
 * visible. A frame gets its layer the first time it is shown and keeps it, and
 * a layer at opacity 0 keeps its tiles, so stepping back through frames already
 * seen redraws rather than downloads. Not every frame at once: that is a dozen
 * viewports of tiles in one burst, and RainViewer refuses a burst -- without a
 * CORS header, so the webview reports it as a blocked request rather than as a
 * limit. Under the result layers, the grid and the areas: the weather is the
 * ground's condition, and what was asked about it reads over it.
 */
// ---- The wind field ------------------------------------------------------------------------

/** GFS publishes a forecast hour every three; asking every half hour catches the next one within the hour. */
const WIND_REFRESH_MS = 30 * 60_000
let windTimer: number | undefined
let particles: WindParticles | null = null
let drawnField: object | null = null

/**
 * The wind field: the speed as an image under every other weather layer, the
 * particles over the map, and a label at each of the project's places. The
 * image is rebuilt only when the field changes; the labels follow the project.
 */
function syncWind(): void {
  const m = map
  if (!m || !m.getLayer(LINE_LAYER)) return
  const o = overlays.get()
  const { state } = windField.get()
  if (o.weatherWind && state.kind === "idle") void refreshWind()
  if (o.weatherWind && windTimer === undefined) {
    windTimer = window.setInterval(() => void refreshWind(), WIND_REFRESH_MS)
  } else if (!o.weatherWind && windTimer !== undefined) {
    window.clearInterval(windTimer)
    windTimer = undefined
  }

  const field = o.weatherWind ? fieldOf(state) : null
  if (!field) {
    removeSpeed(m)
    removeLabels(m)
    particles?.destroy()
    particles = null
    drawnField = null
    windProbe.set(null)
    return
  }
  if (drawnField !== field) {
    const layers = m.getStyle().layers ?? []
    const before = layers.find((l) => l.id.startsWith(SAT_PREFIX) || l.id.startsWith(RADAR_PREFIX))?.id ?? LINE_LAYER
    drawSpeed(m, field, 0.85, before)
    drawnField = field
  }
  particles ??= new WindParticles(m)
  particles.setField(field)
  const d = project.get().data
  const places = [
    ...d.sites.filter((s) => !s.hidden).map((s) => ({ lon: s.lon, lat: s.lat })),
    ...d.areas.filter((a) => !a.hidden).map((a) => ringCentre(a.polygon)),
  ]
  drawLabels(m, field, places)
  if (m.getLayer(LABEL_SOURCE) && m.getLayer("site-label")) m.moveLayer(LABEL_SOURCE)
}

function syncWeather(): void {
  const m = map
  if (!m || !m.getLayer(LINE_LAYER)) return
  const o = overlays.get()
  const w = weather.get()

  if (o.weatherSatellite && w.satellite.kind === "idle") void refreshSatellite()
  if (o.weatherRadar && w.radar.kind === "idle") void refreshRadar()
  const on = o.weatherSatellite || o.weatherRadar
  if (on && weatherTimer === undefined) {
    weatherTimer = window.setInterval(() => {
      const now = overlays.get()
      if (now.weatherSatellite) void refreshSatellite()
      if (now.weatherRadar) void refreshRadar()
    }, WEATHER_REFRESH_MS)
  } else if (!on && weatherTimer !== undefined) {
    window.clearInterval(weatherTimer)
    weatherTimer = undefined
  }

  const firstRadar = () => (m.getStyle().layers ?? []).find((l) => l.id.startsWith(RADAR_PREFIX))?.id
  const place = (prefix: string, frames: Frame[], shown: Frame | null, opacity: number, maxzoom: number, before: () => string) => {
    const visited = visitedFrames[prefix]
    if (shown) visited.add(shown.key)
    for (const key of [...visited]) if (!frames.some((f) => f.key === key)) visited.delete(key)
    frames = frames.filter((f) => visited.has(f.key))
    const wanted = new Set(frames.map((f) => prefix + f.key))
    for (const layer of m.getStyle().layers ?? []) {
      if (layer.id.startsWith(prefix) && !wanted.has(layer.id)) {
        m.removeLayer(layer.id)
        if (m.getSource(layer.id)) m.removeSource(layer.id)
      }
    }
    for (const f of frames) {
      const id = prefix + f.key
      const visible = shown?.key === f.key ? opacity : 0
      if (!m.getSource(id)) {
        m.addSource(id, { type: "raster", tiles: [f.tiles], tileSize: 256, maxzoom })
        m.addLayer(
          { id, type: "raster", source: id, paint: { "raster-opacity": visible, "raster-fade-duration": 0 } },
          before()
        )
      } else {
        m.setPaintProperty(id, "raster-opacity", visible)
      }
    }
  }
  const sat = o.weatherSatellite && w.satellite.kind !== "idle" ? w.satellite.frames : []
  const radar = o.weatherRadar && w.radar.kind !== "idle" ? w.radar.frames : []
  // The radar over the clouds: rain is the finer statement, and it is transparent where there is none.
  place(RADAR_PREFIX, radar, frameAt(w.radar, w.at), w.radarOpacity, RADAR_MAXZOOM, () => LINE_LAYER)
  place(SAT_PREFIX, sat, frameAt(w.satellite, w.at), w.satelliteOpacity, SATELLITE[w.product].maxzoom, () => firstRadar() ?? LINE_LAYER)
}

let loadedPlants: object | null = null
let loadedNetwork: object | null = null

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
  // After the areas, because each grid layer is placed beneath them.
  addGridLayers(m)

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
  syncGrid()
  syncWeather()
  syncWind()
}

/** One image layer per visible raster result, newest on top, all under the areas. */
function syncTerrain(m: MapLibreMap): void {
  const d = project.get().data
  const wanted = overlays.get().layers
    ? d.results.filter(
        (r): r is OverlayResult =>
          (r.kind === "terrain" || r.kind === "demand") &&
          !r.hidden &&
          !findItem(d, r.sourceId)?.hidden &&
          // A demand reading over ground the register does not reach drew
          // nothing, and has no layer to place.
          !!overlayOf(r as OverlayResult)
      )
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
    const layer = overlayOf(r)!
    const e = layer.extent
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [e.lon_min, e.lat_max],
      [e.lon_max, e.lat_max],
      [e.lon_max, e.lat_min],
      [e.lon_min, e.lat_min],
    ]
    if (!m.getSource<ImageSource>(id)) {
      m.addSource(id, { type: "image", url: layer.overlay_url, coordinates })
      m.addLayer(
        {
          id,
          type: "raster",
          source: id,
          // Nearest, so the 30 m cells read as cells: the layer is data, and
          // smoothing would draw structure the elevation model lacks.
          paint: { "raster-opacity": r.opacity, "raster-resampling": "nearest" },
        },
        // Over the grid registers and under the areas: a result reads over the ground it was asked about.
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
  const field = overlays.get().weatherWind ? fieldOf(windField.get().state) : null
  const wind = field ? windAt(field, e.lngLat.lng, e.lngLat.lat) : null
  if (field && wind) {
    const dir = windDirection(wind.u, wind.v)
    windProbe.set({ x: e.point.x, y: e.point.y, speed: Math.hypot(wind.u, wind.v), from: dir.from, towardsDeg: dir.towardsDeg, height: field.height_m })
  } else if (windProbe.get()) {
    windProbe.set(null)
  }
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
    const over = pick(e.target, e.point) ?? pickGrid(e.target, e.point, [e.lngLat.lng, e.lngLat.lat])
    e.target.getCanvas().style.cursor = over ? "pointer" : ""
  } else if (tool === "measure" && measure.get().length === 1) {
    syncMeasure()
  }
}

/** The grid feature under the pointer, topmost first: a metered plant, then any plant, a bus, a line. */
function pickGrid(m: MapLibreMap, point: { x: number; y: number }, at: [number, number]): import("./mapState").PickedGrid | null {
  const pad = 4
  const box: [[number, number], [number, number]] = [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ]
  const layers = GRID_LAYERS.filter((l) => m.getLayer(l) && m.getLayoutProperty(l, "visibility") === "visible")
  if (!layers.length) return null
  const hits = m.queryRenderedFeatures(box, { layers })
  const order = [PLANT_METERED, PLANT_OTHER, BUS_LAYER, LINE_LAYER]
  hits.sort((a, b) => order.indexOf(a.layer.id) - order.indexOf(b.layer.id))
  const hit = hits[0]
  if (!hit) return null
  const pointAt = (): [number, number] =>
    hit.geometry.type === "Point" ? (hit.geometry.coordinates as [number, number]) : at
  if (hit.layer.id === LINE_LAYER) return { kind: "line", at, props: hit.properties as never }
  if (hit.layer.id === BUS_LAYER) return { kind: "bus", at: pointAt(), props: hit.properties as never }
  return { kind: "plant", at: pointAt(), props: hit.properties as never }
}

function onClick(e: MapMouseEvent): void {
  if (swallowClick) {
    swallowClick = false
    return
  }
  const at = { lon: e.lngLat.lng, lat: e.lngLat.lat }
  switch (activeTool.get()) {
    case "select": {
      const item = pick(e.target, e.point)
      select(item?.id ?? null)
      // The project's own objects are what a click is for; a grid feature answers only where there is none.
      pickedGrid.set(item ? null : pickGrid(e.target, e.point, [at.lon, at.lat]))
      return
    }
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
      { type: "op", op: "CONNECTION" },
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
  if (item.kind === "terrain" || item.kind === "connection") return frame(item.polygon.coordinates[0])
  if (item.kind === "solar" || item.kind === "wind") return frame([[item.site.lon, item.site.lat]])
  return false
}

/** Leave the drawing and measuring gestures: Escape. */
export function cancelGesture(): boolean {
  const tool = activeTool.get()
  if (tool === "select") {
    if (!pickedGrid.get()) return false
    pickedGrid.set(null)
    return true
  }
  setTool("select")
  return true
}

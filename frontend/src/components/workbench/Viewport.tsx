import { useEffect, useRef } from "react"
import type { FeatureCollection } from "geojson"
import { Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource, type ImageSource } from "maplibre-gl"
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw"
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter"
import { analysis } from "../../lib/analysis"
import { area, finishDrawing } from "../../lib/area"
import { BASEMAP_FIRST_LABEL, BASEMAP_NAME, BASEMAP_STYLE } from "../../lib/basemap"
import { ACCENT } from "../../lib/colors"
import { findCommand, runCommand } from "../../lib/commands"
import { seasonLabel } from "../../lib/energyParams"
import { terrainLayer } from "../../lib/layers"
import { HOME_VIEW, attachMap, mapView, onMapClick } from "../../lib/mapController"
import { placeSite, site } from "../../lib/site"
import { useStore } from "../../lib/store"
import { Legend } from "../energy/Legend"

// The navigation bar, top to bottom. Each entry is a command name.
const NAVIGATION = ["ZOOMIN", "ZOOMOUT", "HOME"]

/*
  MapLibre finds its worker next to its own module, which no longer holds once
  the module is bundled: the dev server answers 404 and the build leaves the
  worker out. Vector tiles are decoded in the worker, so without it the map
  draws its background and nothing else. Vite bundles the worker here instead.
*/
setWorkerUrl(maplibreWorkerUrl)

const AREA_SOURCE = "area"
const TERRAIN_SOURCE = "terrain"

// Above this pitch the map is no longer a plan view.
const PLAN_PITCH_DEG = 0.5

/** The viewport controls in the corner, as desktop CAD labels a viewport. */
function ViewportLabel() {
  const { pitch } = useStore(mapView)
  return (
    <div className="pointer-events-none absolute left-2 top-1.5 text-[12px] text-ink/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]">
      [−][{pitch > PLAN_PITCH_DEG ? "Custom View" : "Top"}][{BASEMAP_NAME}]
    </div>
  )
}

/**
 * A view cube for a map: the TOP face turns with the bearing and tilts with
 * the pitch, inside a compass ring whose N follows north. Pressing it resets
 * both. The coordinate system of every position the application shows sits
 * below it, where CAD shows its UCS.
 */
function ViewCube() {
  const { bearing, pitch } = useStore(mapView)
  const letters: [string, number, number][] = [
    ["N", 50, 14],
    ["E", 86, 53],
    ["S", 50, 91],
    ["W", 14, 53],
  ]
  return (
    <div className="absolute right-4 top-3 flex flex-col items-center gap-2">
      <button type="button" onClick={() => void runCommand("NORTH")} title="North up (NORTH)" className="relative h-24 w-24">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <g style={{ transform: `rotate(${-bearing}deg)`, transformOrigin: "50px 50px" }}>
            <circle cx="50" cy="50" r="38" fill="none" stroke="rgb(38 38 38 / 0.6)" strokeWidth="11" />
            <circle cx="50" cy="50" r="38" fill="none" stroke="rgb(138 138 138 / 0.55)" strokeWidth="1" />
            {letters.map(([l, x, y]) => (
              <text
                key={l}
                x={x}
                y={y}
                textAnchor="middle"
                className={`text-[9px] font-semibold ${l === "N" ? "fill-accent" : "fill-ink/80"}`}
              >
                {l}
              </text>
            ))}
          </g>
        </svg>
        <span
          className="absolute left-1/2 top-1/2 grid h-10 w-10 place-items-center border border-[#8a8a8a] bg-gradient-to-b from-[#f5f5f5] to-[#a3a3a3] text-[9px] font-semibold tracking-wide text-[#262626] shadow-md"
          style={{
            transform: `translate(-50%, -50%) perspective(160px) rotateX(${pitch}deg) rotate(${-bearing}deg)`,
          }}
        >
          TOP
        </span>
      </button>
      <span
        className="rounded-sm bg-chrome/80 px-1.5 text-[10px] text-ink/90 shadow"
        title="Every position shown is in WGS 84 longitude and latitude"
      >
        WGS 84
      </span>
    </div>
  )
}

/** The navigation bar under the view cube. */
function NavigationBar() {
  return (
    <div className="absolute right-[1.85rem] top-[8.5rem] flex flex-col overflow-hidden rounded-sm border border-sunken/70 bg-chrome/75 shadow-lg backdrop-blur">
      {NAVIGATION.map((name) => {
        const cmd = findCommand(name)
        if (!cmd) return null
        const Icon = cmd.icon
        return (
          <button
            key={name}
            type="button"
            onClick={() => void runCommand(name)}
            title={`${cmd.label} (${cmd.name})`}
            className="grid h-8 w-8 place-items-center text-ink/85 hover:bg-hover"
          >
            <Icon size={17} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

/** The prompt shown while a command waits for the map. */
function Hint() {
  const { picking } = useStore(site)
  const { drawing } = useStore(area)
  const text = picking
    ? "Click the map to place the site · Esc cancels"
    : drawing
      ? "Click to add vertices · click the first vertex to close · Esc cancels"
      : null
  if (!text) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-10 flex justify-center">
      <span className="rounded-sm border border-accent/60 bg-raised/90 px-3 py-1.5 text-xs text-ink shadow-lg backdrop-blur">
        {text}
      </span>
    </div>
  )
}

/** The legend of the terrain layer, while it is shown. */
function TerrainLegend() {
  const { terrain } = useStore(analysis)
  const layer = useStore(terrainLayer)
  if (!terrain || !layer.visible) return null
  const t = terrain.result
  return (
    <div className="absolute left-2 top-8 w-64 rounded-sm border border-line bg-raised/90 p-2.5 shadow-lg backdrop-blur">
      <Legend scale={t.scale} unit={t.unit} title={`Solar terrain · ${seasonLabel(t.season)}`} />
    </div>
  )
}

export function Viewport() {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    const map = new MapLibreMap({
      container: el,
      style: BASEMAP_STYLE,
      ...HOME_VIEW,
      attributionControl: { compact: true },
    })
    const detach = attachMap(map)
    // MapLibre follows the window's size, not its container's. Showing or
    // hiding a panel resizes the viewport without resizing the window.
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(el)

    // --- Site: a marker, and a crosshair while SITE waits for a click.
    const markerEl = document.createElement("div")
    markerEl.className = "site-marker"
    const marker = new Marker({ element: markerEl })
    const showSite = () => {
      const { point, picking } = site.get()
      if (point) marker.setLngLat([point.lon, point.lat]).addTo(map)
      else marker.remove()
      map.getCanvas().style.cursor = picking ? "crosshair" : ""
    }
    showSite()
    const unsubscribeSite = site.subscribe(showSite)
    const unsubscribeClick = onMapClick((at) => {
      if (site.get().picking) placeSite({ lon: at.lng, lat: at.lat })
    })

    // --- Sources and layers exist only once the style has loaded.
    let loaded = false
    let draw: TerraDraw | null = null
    let terrainUrl: string | null = null

    const syncArea = () => {
      if (!loaded) return
      const { polygon } = area.get()
      const data: FeatureCollection = {
        type: "FeatureCollection",
        features: polygon ? [{ type: "Feature", geometry: polygon, properties: {} }] : [],
      }
      map.getSource<GeoJSONSource>(AREA_SOURCE)?.setData(data)
    }

    /*
      terra-draw is used for the gesture only. A finished polygon is handed to
      the area store and cleared from terra-draw, and the area is drawn from
      the store as an ordinary layer. TERRA kept the finished shape inside
      terra-draw and synchronised the two in both directions, and most of its
      drawing defects were that synchronisation reporting itself as an edit.
    */
    const syncDrawMode = () => {
      if (!draw) return
      const { drawing } = area.get()
      if (drawing) {
        if (draw.getMode() !== "polygon") draw.setMode("polygon")
        return
      }
      if (draw.getMode() !== "static") draw.setMode("static")
      if (draw.getSnapshot().length) draw.clear()
    }

    const syncTerrain = () => {
      if (!loaded) return
      const t = analysis.get().terrain
      const layer = terrainLayer.get()
      if (!t) {
        if (map.getLayer(TERRAIN_SOURCE)) map.removeLayer(TERRAIN_SOURCE)
        if (map.getSource(TERRAIN_SOURCE)) map.removeSource(TERRAIN_SOURCE)
        terrainUrl = null
        return
      }
      const e = t.result.extent
      const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
        [e.lon_min, e.lat_max],
        [e.lon_max, e.lat_max],
        [e.lon_max, e.lat_min],
        [e.lon_min, e.lat_min],
      ]
      const source = map.getSource<ImageSource>(TERRAIN_SOURCE)
      if (!source) {
        map.addSource(TERRAIN_SOURCE, { type: "image", url: t.result.overlay_url, coordinates })
        map.addLayer(
          {
            id: TERRAIN_SOURCE,
            type: "raster",
            source: TERRAIN_SOURCE,
            // Nearest, so the 30 m cells read as cells: the layer is data,
            // and smoothing would draw structure the elevation model lacks.
            paint: { "raster-opacity": layer.opacity, "raster-resampling": "nearest" },
          },
          "area-fill"
        )
      } else if (terrainUrl !== t.result.overlay_url) {
        source.updateImage({ url: t.result.overlay_url, coordinates })
      }
      terrainUrl = t.result.overlay_url
      map.setLayoutProperty(TERRAIN_SOURCE, "visibility", layer.visible ? "visible" : "none")
      map.setPaintProperty(TERRAIN_SOURCE, "raster-opacity", layer.opacity)
    }

    map.on("load", () => {
      loaded = true
      map.addSource(AREA_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      // Under the basemap's labels, as is the terrain layer inserted below
      // these, so place and road names stay readable over the data.
      map.addLayer(
        {
          id: "area-fill",
          type: "fill",
          source: AREA_SOURCE,
          paint: { "fill-color": ACCENT, "fill-opacity": 0.08 },
        },
        BASEMAP_FIRST_LABEL
      )
      map.addLayer(
        {
          id: "area-line",
          type: "line",
          source: AREA_SOURCE,
          paint: { "line-color": ACCENT, "line-width": 2 },
        },
        BASEMAP_FIRST_LABEL
      )

      draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({
            styles: { fillColor: ACCENT, fillOpacity: 0.12, outlineColor: ACCENT, outlineWidth: 2 },
          }),
        ],
      })
      draw.start()
      draw.on("finish", (id) => {
        const feature = draw?.getSnapshot().find((f) => f.id === id)
        if (feature?.geometry.type === "Polygon") {
          finishDrawing({ type: "Polygon", coordinates: feature.geometry.coordinates })
        }
      })

      syncArea()
      syncDrawMode()
      syncTerrain()
    })

    // Deferred: a finish is reported from inside terra-draw's own handler,
    // and clearing its store there would change it under the caller.
    const unsubscribeArea = area.subscribe(() => {
      syncArea()
      queueMicrotask(syncDrawMode)
    })
    const unsubscribeAnalysis = analysis.subscribe(syncTerrain)
    const unsubscribeLayer = terrainLayer.subscribe(syncTerrain)

    return () => {
      unsubscribeLayer()
      unsubscribeAnalysis()
      unsubscribeArea()
      unsubscribeClick()
      unsubscribeSite()
      // terra-draw's adapter writes into the map's sources, so it stops
      // before the map is removed.
      draw?.stop()
      marker.remove()
      observer.disconnect()
      detach()
      // remove() releases the WebGL context. Without it every remount leaks
      // one, and the webview stops creating contexts after a small number.
      map.remove()
    }
  }, [])

  return (
    <div className="relative min-w-0 flex-1 bg-surface">
      {/*
        The map's container is not positioned itself. MapLibre adds the class
        maplibregl-map to it, and maplibre-gl.css sets that class to
        position: relative. That stylesheet is unlayered and Tailwind's
        utilities live in a cascade layer, so the unlayered rule wins whatever
        the order: an `absolute inset-0` container became relative, lost the
        size inset gave it, and the map drew at zero height. The wrapper takes
        the position, and the container only fills it.
      */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>
      {/* The active viewport's frame, in the accent, as CAD marks the viewport that takes input. */}
      <div className="pointer-events-none absolute inset-0 z-10 ring-1 ring-inset ring-accent/80" aria-hidden="true" />
      <ViewportLabel />
      <ViewCube />
      <NavigationBar />
      <TerrainLegend />
      <Hint />
    </div>
  )
}

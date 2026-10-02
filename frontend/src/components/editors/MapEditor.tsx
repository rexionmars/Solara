import { useEffect, useRef, useState } from "react"
import { CaretDown, CaretRight, House, MagnifyingGlassMinus, MagnifyingGlassPlus, Pause, Play, Stack, Tag } from "@phosphor-icons/react"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import { runConnection, runSolar, runTerrain, runWind } from "../../lib/analysis"
import { BASEMAPS, type BasemapId } from "../../lib/basemap"
import { formatLat, formatLng } from "../../lib/format"
import { distanceKm } from "../../lib/geo"
import { concessions, networkRegister, plantRegister, townDemand } from "../../lib/grid"
import { mountMap, setBearing } from "../../lib/mapEngine"
import { mapView, measure } from "../../lib/mapState"
import { setSiteCoordinate } from "../../lib/objects"
import { findOperator, formatKeys, runOperator } from "../../lib/operators"
import { PRODUCT_NAMES, findItem, isResult, project, renameItem } from "../../lib/project"
import { openRunGraph } from "../../lib/screen"
import { useStore } from "../../lib/store"
import { SERVICE_CREDITS, SERVICES } from "../../lib/services"
import { TOOLS, activeTool, basemap, overlays, type Overlays } from "../../lib/tools"
import {
  SATELLITE,
  ageLabel,
  clockLabel,
  frameAt,
  refreshRadar,
  refreshSatellite,
  setMoment,
  setOpacity,
  setPlaying,
  setSatelliteProduct,
  tilesFailing,
  timelineTimes,
  weather,
  type Frame,
  type LayerFrames,
  type SatelliteProduct,
  WIND_STOPS,
  fieldOf,
  refreshWind,
  setWindHeight,
  windField,
  windProbe,
} from "../../lib/weather"
import { coordinatePrompt, lastOperation, lastOperationOpen, type MenuItem } from "../../lib/ui"
import { StudioHeaderMenu, StudioHeaderPopover, StudioHeaderRule, StudioHeaderToggle } from "../studio/HeaderControls"
import { AreaHeader } from "../studio/StudioArea"
import { btnPrimary } from "../ui/buttons"
import { NumberField, TextField } from "../ui/Fields"
import { OverlayCallouts } from "./OverlayCallouts"
import { ParamFields } from "./ParamFields"

const op = (name: string, label?: string): MenuItem => ({ type: "op", op: name, label })
const sep: MenuItem = { type: "sep" }

const viewMenu = (): MenuItem[] => [op("FRAME_ALL"), op("FRAME_SELECTED"), sep, op("ZOOMIN"), op("ZOOMOUT"), op("NORTH"), sep, op("AREA_MAXIMIZE")]
const selectMenu = (): MenuItem[] => [op("TOOL_SELECT", "Select tool"), op("SELECT_NONE"), sep, op("FRAME_SELECTED")]
const addMenu = (): MenuItem[] => [
  op("TOOL_SITE", "Site, picked on the map"),
  { type: "action", label: "Site at coordinates…", run: () => coordinatePrompt.set(true) },
  op("AREA_PLACE", "Area, from a published boundary…"),
]
const objectMenu = (): MenuItem[] => [
  op("RENAME"),
  op("HIDE"),
  op("UNHIDE_ALL"),
  op("LEGEND"),
  op("DELETE"),
  { type: "heading", label: "Analyze" },
  /*
    ONE ITEM, NOT ONE PER PRODUCT. This menu used to run three of the five
    products straight from the map, which spent a run with none of its inputs
    on screen -- and left the other two unreachable, so right-clicking an area
    read as "this area cannot be asked that". Both are the same defect: a
    request is five or six settings, and the board is where they are all
    visible at once.

    RERUN stays because it is not a request. It repeats one the project
    already holds, with the settings that run recorded.
  */
  { type: "action", label: "Set up a run…", run: () => openRunGraph() },
  op("RERUN"),
]

const OVERLAY_ITEMS: { key: keyof Overlays; label: string }[] = [
  { key: "siteLabels", label: "Names" },
  { key: "areas", label: "Areas" },
  { key: "layers", label: "Result layers" },
  { key: "legend", label: "Legend" },
  { key: "statistics", label: "Credit and scale" },
]

const WEATHER_ITEMS: { key: keyof Overlays; label: string }[] = [
  { key: "weatherSatellite", label: "Clouds, GOES-East satellite" },
  { key: "weatherRadar", label: "Rain, radar" },
  { key: "weatherWind", label: "Wind, GFS model" },
]

/*
  The registers that publish themselves. They are kept apart from the grid
  store's own layers because they fail differently: the store is a database
  this machine either reaches or does not, and these are four services on the
  internet that can each refuse a single view.
*/
const REFERENCE_ITEMS: { key: keyof Overlays; label: string }[] = [
  { key: "nightLights", label: "Nighttime lights, VIIRS" },
  { key: "sigel", label: "Turbines and declared strips, SIGEL" },
  { key: "indigenousLand", label: "Indigenous land, FUNAI" },
  { key: "protectedAreas", label: "Protected areas, ICMBio" },
]

const BASEMAP_ITEMS: { id: BasemapId; label: string }[] = [
  { id: "dark", label: "Streets, dark" },
  { id: "satellite", label: "Imagery, Sentinel-2 cloudless" },
]

const GRID_ITEMS: { key: keyof Overlays; label: string }[] = [
  { key: "gridConcessions", label: "Where each register has data" },
  { key: "gridDemand", label: "Consumption by municipality" },
  { key: "gridMetered", label: "Plants in the record" },
  { key: "gridRegistered", label: "Registered only" },
  { key: "gridLines", label: "Transmission lines" },
  { key: "gridBuses", label: "Substations" },
]

/** A layer's toggle, with what it holds once read, or why it could not be. */
function gridLabel(key: keyof Overlays, label: string): string {
  const plants = plantRegister.get()
  const network = networkRegister.get()
  // Named before the shared branch below, because its state is neither of the
  // two registers that one reads.
  if (key === "gridConcessions") {
    const reach = concessions.get()
    if (reach.kind === "loading") return `${label} (reading…)`
    if (reach.kind === "failed") return `${label} (unavailable)`
    if (reach.kind !== "ready") return label
    const drawn = reach.data.geojson.features.length
    // A holding the load did not bring the sets for is named here rather than
    // left to look like ground outside every register.
    const missing = reach.data.undrawn.length ? `, ${reach.data.undrawn.length} not drawn` : ""
    return `${label} · ${drawn}${missing}`
  }
  /*
    Named before the shared branch too, and for the same reason the reach is:
    its state is the municipal layer's, not the network register's. Read from
    the wrong store it could never say "(unavailable)", so a layer that failed
    every time looked like a layer that simply did nothing when toggled.
  */
  if (key === "gridDemand") {
    const towns = townDemand.get()
    if (towns.kind === "loading") return `${label} (reading…)`
    if (towns.kind === "failed") return `${label} (unavailable)`
    if (towns.kind !== "ready") return label
    return `${label} · ${towns.data.towns.toLocaleString()}`
  }
  const state = key === "gridMetered" || key === "gridRegistered" ? plants : network
  if (state.kind === "loading") return `${label} (reading…)`
  if (state.kind === "failed") return `${label} (unavailable)`
  if (plants.kind === "ready" && key === "gridMetered") return `${label} · ${plants.data.counts.metered.toLocaleString()}`
  if (plants.kind === "ready" && key === "gridRegistered") {
    return `${label} · ${(plants.data.counts.returned - plants.data.counts.metered).toLocaleString()}`
  }
  if (network.kind === "ready" && key === "gridLines") return `${label} · ${network.data.counts.lines_in_service.toLocaleString()} in service`
  if (network.kind === "ready" && key === "gridBuses") return `${label} · ${network.data.counts.substations.toLocaleString()}`
  return label
}

const overlaysMenu = (): MenuItem[] => {
  const o = overlays.get()
  const base = basemap.get()
  return [
    { type: "heading", label: "Overlays" },
    ...OVERLAY_ITEMS.map(
      (it): MenuItem => ({
        type: "action",
        label: it.label,
        checked: o[it.key],
        run: () => overlays.set((cur) => ({ ...cur, [it.key]: !cur[it.key] })),
      })
    ),
    { type: "heading", label: "Ground" },
    ...BASEMAP_ITEMS.map(
      (it): MenuItem => ({
        type: "action",
        label: it.label,
        checked: base === it.id,
        run: () => basemap.set(it.id),
      }),
    ),
    {
      type: "action",
      label: "Hillshade",
      checked: o.hillshade,
      run: () => overlays.set((cur) => ({ ...cur, hillshade: !cur.hillshade })),
    },
    { type: "heading", label: "Weather now (internet)" },
    ...WEATHER_ITEMS.map(
      (it): MenuItem => ({
        type: "action",
        label: it.label,
        checked: o[it.key],
        run: () => overlays.set((cur) => ({ ...cur, [it.key]: !cur[it.key] })),
      })
    ),
    { type: "heading", label: "Published registers (internet)" },
    ...REFERENCE_ITEMS.map(
      (it): MenuItem => ({
        type: "action",
        label: it.label,
        checked: o[it.key],
        run: () => overlays.set((cur) => ({ ...cur, [it.key]: !cur[it.key] })),
      }),
    ),
    { type: "heading", label: "Grid store" },
    ...GRID_ITEMS.map(
      (it): MenuItem => {
        const state = it.key === "gridMetered" || it.key === "gridRegistered" ? plantRegister.get() : networkRegister.get()
        return {
          type: "action",
          label: gridLabel(it.key, it.label),
          checked: o[it.key],
          disabled: state.kind === "failed" && !o[it.key] ? state.message : false,
          run: () => overlays.set((cur) => ({ ...cur, [it.key]: !cur[it.key] })),
        }
      }
    ),
  ]
}

/** A plate floated over the map, as TERRA's reading cards over the globe. */
const PLATE = "pointer-events-auto rounded-sm border shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
const plateStyle = { background: "rgb(var(--p-ink) / 0.92)", borderColor: "rgb(var(--p-line) / 0.4)" }

/** The toolbar, down the area's left edge as Blender's T region. */
function Toolbar() {
  const tool = useStore(activeTool)
  return (
    <>
      {TOOLS.map((t) => {
        const operator = findOperator(t.operator)
        const IconC = operator?.icon
        const on = t.id === tool
        const key = operator?.keys?.[0]
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => void runOperator(t.operator)}
            title={`${t.label}${key ? ` (${formatKeys(key)})` : ""}\n${t.description}`}
            className={`flex size-7 items-center justify-center transition-colors ${
              on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"
            }`}
          >
            {IconC && <IconC className="size-3.5" />}
          </button>
        )
      })}
    </>
  )
}

/** A compass whose N follows north: dragged, it turns the map; pressed, it puts north up. */
function Navigation() {
  const { bearing } = useStore(mapView)
  const drag = useRef<{ x: number; bearing: number; moved: boolean } | null>(null)
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1.5">
      <button
        type="button"
        title="Drag to turn the map · press for north up"
        aria-label="Compass"
        className="relative size-11 cursor-grab rounded-full active:cursor-grabbing"
        style={{ background: "rgb(var(--p-ink) / 0.72)", boxShadow: "inset 0 0 0 1px rgb(var(--p-line) / 0.4)" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, bearing, moved: false }
        }}
        onPointerMove={(e) => {
          const s = drag.current
          if (!s) return
          const dx = e.clientX - s.x
          if (Math.abs(dx) > 2) s.moved = true
          if (s.moved) setBearing(s.bearing - dx * 0.8)
        }}
        onPointerUp={() => {
          const s = drag.current
          drag.current = null
          if (s && !s.moved) void runOperator("NORTH")
        }}
      >
        <svg viewBox="0 0 44 44" className="absolute inset-0" aria-hidden>
          <g style={{ transform: `rotate(${-bearing}deg)`, transformOrigin: "22px 22px" }}>
            <path d="M22 6 L26 22 L22 20 L18 22 Z" fill="rgb(97 167 255)" />
            <path d="M22 38 L26 22 L22 24 L18 22 Z" fill="rgb(145 145 145)" />
            <text x="22" y="5.5" textAnchor="middle" className="fill-[rgb(221_221_221)] font-mono text-[6px]">
              N
            </text>
          </g>
        </svg>
      </button>
      <div className="flex flex-col overflow-hidden rounded-sm border" style={{ background: "rgb(var(--p-ink) / 0.72)", borderColor: "rgb(var(--p-line) / 0.4)" }}>
        {[
          { name: "ZOOMIN", icon: MagnifyingGlassPlus },
          { name: "ZOOMOUT", icon: MagnifyingGlassMinus },
          { name: "FRAME_ALL", icon: House },
        ].map(({ name, icon: IconC }) => {
          const o = findOperator(name)
          return (
            <button
              key={name}
              type="button"
              onClick={() => void runOperator(name)}
              title={o ? `${o.label}${o.keys?.[0] ? ` (${formatKeys(o.keys[0])})` : ""}` : name}
              aria-label={o?.label}
              className="flex size-7 items-center justify-center text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <IconC className="size-3.5" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A run or valid time as the hour it names, in UTC, the way model runs are called. */
const utcHour = (iso: string) => `${iso.slice(11, 13)}Z`

/**
 * The wind field's part of the plate: which height, which run and which hour
 * the field is, and what its colours mean. Modelled, and it says so.
 */
function WindSection({ divided }: { divided: boolean }) {
  const { height, state } = useStore(windField)
  const field = fieldOf(state)
  const gradient = `linear-gradient(to right, ${WIND_STOPS.map(([s, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${(s / 32) * 100}%`).join(", ")})`
  return (
    <div className={divided ? "mt-2 border-t pt-1.5" : "mt-1.5"} style={{ borderColor: "rgb(var(--p-line) / 0.3)" }}>
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-micro text-muted-foreground">Wind</span>
        {([10, 100] as const).map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setWindHeight(h)}
            aria-pressed={height === h}
            title={h === 10 ? "At 10 m, the height stations measure at" : "At 100 m, near a turbine's hub"}
            className={`rounded-sm px-1.5 py-px text-micro transition-colors ${
              height === h ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"
            }`}
          >
            {h} m
          </button>
        ))}
        <span className="ml-auto telemetry text-[9px] text-muted-foreground" title="A forecast from a model run, not a measurement">
          modelled
        </span>
      </div>
      <p className="telemetry mt-1 text-micro text-foreground">
        {field ? (
          <>
            valid {clockLabel(Date.parse(field.valid))}
            <span className="text-muted-foreground">
              {" "}
              · GFS {field.run ? `${utcHour(field.run)} run` : "run unknown"}
            </span>
          </>
        ) : state.kind === "failed" ? (
          <span className="text-muted-foreground">unavailable</span>
        ) : (
          <span className="text-muted-foreground">reading…</span>
        )}
        {state.kind === "loading" && field && <span className="text-muted-foreground"> · updating</span>}
      </p>
      {state.kind === "failed" && (
        <p className="mt-0.5 flex items-start gap-2 text-micro leading-snug text-destructive-quiet">
          <span className="min-w-0 flex-1">{state.message}</span>
          <button type="button" onClick={() => void refreshWind()} className="shrink-0 text-accent hover:underline">
            Retry
          </button>
        </p>
      )}
      <div className="mt-1.5 h-1.5 w-full rounded-[1px]" style={{ background: gradient }} />
      <div className="telemetry mt-0.5 flex justify-between text-[9px] text-muted-foreground">
        <span>0</span>
        <span>8</span>
        <span>16</span>
        <span>24</span>
        <span>32 m/s</span>
      </div>
    </div>
  )
}

/** Speed and direction beside the pointer, while the wind field is drawn. */
function WindReadout() {
  const probe = useStore(windProbe)
  if (!probe) return null
  return (
    <div
      className="pointer-events-none absolute z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-md px-2 py-1 text-body text-foreground shadow-lg"
      style={{ left: probe.x, top: probe.y - 40, background: "rgb(var(--p-ink) / 0.9)" }}
    >
      <span className="telemetry">{probe.speed.toFixed(1)} m/s</span>
      <span className="telemetry text-muted-foreground">{(probe.speed * 3.6).toFixed(0)} km/h</span>
      <span aria-hidden className="inline-block" style={{ transform: `rotate(${probe.towardsDeg}deg)` }}>
        ↑
      </span>
      <span className="telemetry" title="Where the wind comes from">
        {probe.from}
      </span>
      <span className="telemetry text-[9px] text-muted-foreground">{probe.height} m</span>
    </div>
  )
}

/**
 * The weather overlays' timeline: which moment is drawn, how old each layer's
 * frame is, and where the layers come from. Only while one is on.
 *
 * THE AGE IS WRITTEN, NOT IMPLIED. The satellite is published about forty
 * minutes late and the radar about ten, so "now" on this map is two different
 * moments, and each layer says its own.
 */
function WeatherPlate() {
  const o = useStore(overlays)
  const w = useStore(weather)
  const [, tick] = useState(0)
  const times = timelineTimes(w, o.weatherSatellite, o.weatherRadar)
  const index = w.at === null ? times.length - 1 : Math.max(0, times.findIndex((t) => t >= w.at!))

  // Ages are relative to the clock, so they are redrawn as it moves.
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!w.playing) return
    const timer = window.setInterval(() => {
      const s = weather.get()
      const all = timelineTimes(s, overlays.get().weatherSatellite, overlays.get().weatherRadar)
      if (!all.length) return
      const at = s.at === null ? all[all.length - 1] : s.at
      const i = all.findIndex((t) => t > at)
      setMoment(i < 0 ? all[0] : all[i])
    }, 700)
    return () => window.clearInterval(timer)
  }, [w.playing])

  if (!o.weatherSatellite && !o.weatherRadar && !o.weatherWind) return null
  const observed = o.weatherSatellite || o.weatherRadar
  const sat = frameAt(w.satellite, w.at)
  const radar = frameAt(w.radar, w.at)
  const layerLine = (label: string, state: LayerFrames, frame: Frame | null, retry: () => void) => (
    <div className="flex items-baseline gap-2">
      <span className="w-10 shrink-0 text-micro text-muted-foreground">{label}</span>
      {frame ? (
        <span className="telemetry min-w-0 flex-1 truncate text-micro text-foreground">
          {clockLabel(frame.time)} <span className="text-muted-foreground">· {ageLabel(frame.time)}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-micro text-muted-foreground">{state.kind === "failed" ? "unavailable" : "reading…"}</span>
      )}
      {state.kind === "failed" && (
        <button type="button" onClick={retry} title={state.message} className="shrink-0 text-micro text-accent hover:underline">
          Retry
        </button>
      )}
    </div>
  )

  return (
    <div className={`${PLATE} w-72 px-2.5 py-2`} style={plateStyle}>
      <div className="flex items-center gap-1.5">
        <p className="eyebrow !text-[9px] min-w-0 flex-1 truncate">Weather now</p>
        {observed && (
          <span className="telemetry text-[9px] text-muted-foreground" title="Measured by satellite and radar, not modelled">
            observed
          </span>
        )}
      </div>
      {observed && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPlaying(!w.playing)}
            disabled={times.length < 2}
            aria-label={w.playing ? "Pause" : "Play the last two hours"}
            title={w.playing ? "Pause" : "Play the last two hours"}
            className="grid size-6 shrink-0 place-items-center rounded-sm bg-selected text-foreground hover:bg-hover disabled:opacity-40"
          >
            {w.playing ? <Pause className="size-3" weight="fill" /> : <Play className="size-3" weight="fill" />}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, times.length - 1)}
            value={Math.max(0, index)}
            disabled={times.length < 2}
            aria-label="Moment shown"
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const i = Number(e.target.value)
              setPlaying(false)
              setMoment(i >= times.length - 1 ? null : times[i])
            }}
            className="min-w-0 flex-1 accent-[rgb(var(--p-accent))]"
          />
          <button
            type="button"
            onClick={() => {
              setPlaying(false)
              setMoment(null)
            }}
            disabled={w.at === null}
            className="shrink-0 text-micro text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Latest
          </button>
        </div>
      )}
      <div className={observed ? "mt-1.5 flex flex-col gap-0.5" : "hidden"}>
        {o.weatherSatellite && layerLine("Clouds", w.satellite, sat, () => void refreshSatellite())}
        {o.weatherRadar && layerLine("Rain", w.radar, radar, () => void refreshRadar())}
      </div>
      {o.weatherSatellite && (
        <div className="mt-1.5 flex items-center gap-1.5">
          {(Object.keys(SATELLITE) as SatelliteProduct[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSatelliteProduct(p)}
              aria-pressed={w.product === p}
              title={p === "geocolor" ? "True colour by day, infrared by night" : "Infrared day and night: clouds read the same at any hour"}
              className={`rounded-sm px-1.5 py-px text-micro transition-colors ${
                w.product === p ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"
              }`}
            >
              {SATELLITE[p].label}
            </button>
          ))}
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={w.satelliteOpacity}
            aria-label="Cloud layer opacity"
            title="Cloud layer opacity"
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => setOpacity("satellite", Number(e.target.value))}
            className="ml-auto w-16 accent-[rgb(var(--p-accent))]"
          />
        </div>
      )}
      {(["satellite", "radar"] as const).some((l) => (l === "satellite" ? o.weatherSatellite : o.weatherRadar) && tilesFailing(w, l)) && (
        <p className="mt-1.5 text-micro leading-snug" style={{ color: "var(--warning)" }}>
          {o.weatherRadar && tilesFailing(w, "radar")
            ? "Radar tiles are being refused. RainViewer limits requests from one address; the radar comes back once the limit resets, usually within a minute."
            : "Satellite tiles are not loading. The connection or NASA GIBS may be down; the map keeps what it has."}
        </p>
      )}
      {o.weatherRadar && (
        <p className="mt-1.5 text-micro leading-snug text-muted-foreground">
          Radar reaches where Brazil's radars do: dense in the South and Southeast, sparse inland in the Northeast. No colour where there is no
          radar is not no rain.
        </p>
      )}
      {o.weatherWind && <WindSection divided={observed} />}
      <p className="mt-1.5 flex flex-wrap gap-x-1.5 text-[9px] text-muted-foreground">
        {o.weatherSatellite && (
          <button type="button" onClick={() => BrowserOpenURL("https://earthdata.nasa.gov/gibs")} className="hover:text-foreground hover:underline">
            NASA GIBS · NOAA GOES-East
          </button>
        )}
        {o.weatherRadar && (
          <button type="button" onClick={() => BrowserOpenURL("https://www.rainviewer.com")} className="hover:text-foreground hover:underline">
            RainViewer
          </button>
        )}
        {o.weatherWind && (
          <button type="button" onClick={() => BrowserOpenURL("https://www.unidata.ucar.edu/software/tds/")} className="hover:text-foreground hover:underline">
            NOAA GFS · UCAR THREDDS
          </button>
        )}
      </p>
    </div>
  )
}

/** The distance being measured, while the Measure tool holds two points or one and the pointer. */
function MeasurePlate() {
  const pts = useStore(measure)
  const tool = useStore(activeTool)
  if (tool !== "measure") return null
  const km = pts.length === 2 ? distanceKm(pts[0], pts[1]) : null
  return (
    <div className={`${PLATE} px-2.5 py-2`} style={plateStyle}>
      <p className="eyebrow !text-[9px]">Measure</p>
      <p className="telemetry text-emphasis text-foreground">
        {km === null ? (pts.length ? "press the end point" : "press the start point") : km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km`}
      </p>
    </div>
  )
}

/**
 * Adjust Last Operation, as Blender's redo panel: the last site added or
 * analysis run, with its fields. A site's fields edit it in place; an
 * analysis's fields are the settings, and Run again replaces its result.
 */
function RedoPlate() {
  const last = useStore(lastOperation)
  const open = useStore(lastOperationOpen)
  const d = useStore(project).data
  if (!last) return null
  const target = findItem(d, last.target)
  if (!target) return null
  const source = isResult(target) ? findItem(d, target.sourceId) : null
  const again = async () => {
    if (!isResult(target) || !source) return
    const id =
      target.kind === "terrain" || target.kind === "connection"
        ? source.kind === "area" &&
          (await (target.kind === "terrain" ? runTerrain(source, target.id) : runConnection(source, target.id)))
        : source.kind === "site" && (await (target.kind === "solar" ? runSolar(source, target.id) : runWind(source, target.id)))
    if (id) lastOperation.set({ ...last, target: id })
  }
  return (
    <div className={`${PLATE} w-72 overflow-hidden`} style={plateStyle}>
      <button
        type="button"
        onClick={() => lastOperationOpen.set(!open)}
        aria-expanded={open}
        title={`Adjust last operation (${formatKeys("F9")})`}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-meta text-foreground hover:bg-hover"
      >
        {open ? <CaretDown className="size-2.5" /> : <CaretRight className="size-2.5" />}
        {last.label}
      </button>
      {open && (
        <div className="panel-scroll flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto border-t px-2 pb-2 pt-1.5" style={{ borderColor: "var(--hairline)" }}>
          {target.kind === "site" && (
            <>
              <TextField value={target.name} onCommit={(v) => renameItem(target.id, v)} ariaLabel="Name" />
              <NumberField
                label="Latitude"
                inlineLabel
                allowEmpty={false}
                value={target.lat}
                step={0.001}
                unit="°"
                onChange={(v) => v !== undefined && setSiteCoordinate(target.id, "lat", v)}
                validate={(v) => (Math.abs(v) <= 90 ? null : "Between -90 and 90")}
              />
              <NumberField
                label="Longitude"
                inlineLabel
                allowEmpty={false}
                value={target.lon}
                step={0.001}
                unit="°"
                onChange={(v) => v !== undefined && setSiteCoordinate(target.id, "lon", v)}
                validate={(v) => (Math.abs(v) <= 180 ? null : "Between -180 and 180")}
              />
            </>
          )}
          {isResult(target) && (
            <>
              <ParamFields group={target.kind} />
              <button type="button" className={btnPrimary} onClick={() => void again()} aria-disabled={!source} title={source ? undefined : "Its source has been deleted"}>
                Run {PRODUCT_NAMES[target.kind].toLowerCase()} again
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const ENGINE_CREDIT = { label: "MapLibre", href: "https://maplibre.org" }

/**
 * The zoom and the credit at the map's foot, as TERRA writes them under the
 * globe. The credit follows what is actually drawn: the ground in use, and
 * every published register switched on. A licence is owed by whoever is
 * being shown, not by whoever could be.
 */
function Foot() {
  const { zoom } = useStore(mapView)
  const o = useStore(overlays)
  const base = useStore(basemap)
  if (!o.statistics) return null
  const ground = BASEMAPS[base]
  const credits = [
    ENGINE_CREDIT,
    ...ground.credits,
    ...SERVICES.filter((s) => o[s.key]).map((s) => SERVICE_CREDITS[s.key]),
  ]
  return (
    <p className="telemetry pointer-events-auto absolute bottom-1.5 left-2 flex flex-wrap items-center gap-x-1.5 text-[9px] text-foreground/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]">
      <span>z{zoom.toFixed(1)}</span>
      {credits.map((c, i) => (
        <span key={c.label} className="flex items-center gap-1.5">
          {i === 1 ? "|" : ""}
          {/* A button calling BrowserOpenURL: an anchor with a blank target opens nothing in this webview. */}
          <button type="button" onClick={() => BrowserOpenURL(c.href)} className="cursor-pointer hover:text-foreground hover:underline">
            {c.label}
          </button>
        </span>
      ))}
      <span className="text-muted-foreground">· {ground.label}</span>
      {/* Past the last zoom the tiles carry, the map is drawing the same pixels larger. Say so rather than let it read as detail. */}
      {zoom > ground.maxZoom && <span className="text-muted-foreground">· stretched past z{ground.maxZoom}</span>}
    </p>
  )
}

export function MapEditor() {
  const container = useRef<HTMLDivElement>(null)
  const o = useStore(overlays)
  const view = useStore(mapView)

  useEffect(() => {
    const el = container.current
    if (!el) return
    return mountMap(el)
  }, [])

  return (
    <>
      <AreaHeader
        menus={
          <>
            <StudioHeaderMenu label="View" items={viewMenu} />
            <StudioHeaderMenu label="Select" items={selectMenu} />
            <StudioHeaderMenu label="Add" items={addMenu} />
            <StudioHeaderMenu label="Object" items={objectMenu} />
          </>
        }
        centre={
          <span className="telemetry header-label text-[9px] text-muted-foreground">
            {formatLat(view.lat, 3)} {formatLng(view.lng, 3)}
          </span>
        }
        options={
          <>
            <StudioHeaderToggle
              icon={Tag}
              label="Names"
              on={o.siteLabels}
              onToggle={() => overlays.set((c) => ({ ...c, siteLabels: !c.siteLabels }))}
              title="Draw the names of sites and areas"
            />
            <StudioHeaderRule />
            <StudioHeaderPopover icon={Stack} label="Overlays" items={overlaysMenu} align="end" />
          </>
        }
        toolbar={<Toolbar />}
      />
      <div className="relative min-h-0 flex-1" style={{ background: "var(--s-field)" }}>
        {/*
          The map's element is moved in and out of this container (mapEngine):
          one MapLibre instance for the application, never torn down on a
          workspace switch.
        */}
        <div ref={container} className="absolute inset-0" />
        <OverlayCallouts />
        <div className="pointer-events-none absolute inset-0">
          <WindReadout />
          <div className="absolute right-2 top-2">
            <Navigation />
          </div>
          {/* Clear of the floating tool plate, which now sits at this corner. */}
          <div className="absolute left-12 top-2 flex flex-col items-start gap-2">
            <MeasurePlate />
          </div>
          <div className="absolute bottom-7 right-2">
            <WeatherPlate />
          </div>
          <div className="absolute bottom-7 left-2">
            <RedoPlate />
          </div>
          <Foot />
        </div>
      </div>
    </>
  )
}

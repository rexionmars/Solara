import { useEffect, useRef, useState } from "react"
import { CaretDown, CaretRight, Pause, Play, Stack } from "@phosphor-icons/react"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import { runConnection, runSolar, runTerrain, runWind } from "../../lib/analysis"
import { BASEMAPS, IMAGERY_TILES, type BasemapId } from "../../lib/basemap"
import { formatLat, formatLng } from "../../lib/format"
import { distanceKm } from "../../lib/geo"
import { concessions, networkRegister, plantRegister, townDemand } from "../../lib/grid"
import { mountMap } from "../../lib/mapEngine"
import { mapView, measure } from "../../lib/mapState"
import { setSiteCoordinate } from "../../lib/objects"
import { formatKeys } from "../../lib/operators"
import { PRODUCT_NAMES, findItem, isResult, project, renameItem } from "../../lib/project"
import { useStore } from "../../lib/store"
import { SERVICE_CREDITS, SERVICES } from "../../lib/services"
import { activeTool, basemap, overlays, type Overlays } from "../../lib/tools"
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
import { lastOperation, lastOperationOpen, weatherPlateOpen } from "../../lib/ui"
import { AreaHeader } from "../studio/StudioArea"
import { btnPrimary } from "../ui/buttons"
import { NumberField, TextField } from "../ui/Fields"
import { AddressSearch } from "./AddressSearch"
import { OverlayCallouts } from "./OverlayCallouts"
import { ParamFields } from "./ParamFields"

/*
  THE HEADER CARRIES NO MENUS. It had View, Select, Add and Object, and every
  entry of them is a button of the ribbon's Map tab now, in the open: a menu
  under a ribbon that already shows its contents is the same command twice,
  and the one that has to be opened is the one nobody reaches for. What stays
  on the header is what is about the VIEW: where the map is, and what is drawn.
*/

export const OVERLAY_ITEMS: { key: keyof Overlays; label: string }[] = [
  { key: "siteLabels", label: "Names" },
  { key: "areas", label: "Areas" },
  { key: "layers", label: "Result layers" },
  { key: "legend", label: "Legend" },
  { key: "statistics", label: "Credit and scale" },
]

export const WEATHER_ITEMS: { key: keyof Overlays; label: string }[] = [
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
export const REFERENCE_ITEMS: { key: keyof Overlays; label: string }[] = [
  { key: "nightLights", label: "Nighttime lights, VIIRS" },
  { key: "sigel", label: "Turbines and declared strips, SIGEL" },
  { key: "indigenousLand", label: "Indigenous land, FUNAI" },
  { key: "protectedAreas", label: "Protected areas, ICMBio" },
]

export const BASEMAP_ITEMS: { id: BasemapId; label: string }[] = [
  { id: "dark", label: "Streets, dark" },
  { id: "satellite", label: "Imagery, Sentinel-2 cloudless" },
]

export const GRID_ITEMS: { key: keyof Overlays; label: string }[] = [
  { key: "gridConcessions", label: "Where each register has data" },
  { key: "gridDemand", label: "Consumption by municipality" },
  { key: "gridMetered", label: "Plants in the record" },
  { key: "gridRegistered", label: "Registered only" },
  { key: "gridLines", label: "Transmission lines" },
  { key: "gridBuses", label: "Substations" },
]

/**
 * What a grid layer holds once read, or why it could not be: the note beside
 * its name in the outliner. Empty for a layer with nothing to say yet.
 *
 * Each layer reads its OWN store's state. Read from the wrong one, a layer
 * that failed every time could never say "unavailable", and looked like a
 * layer that simply did nothing when switched on.
 */
export function layerNote(key: keyof Overlays): { text: string; failed?: string } {
  const plants = plantRegister.get()
  const network = networkRegister.get()
  if (key === "gridConcessions") {
    const reach = concessions.get()
    if (reach.kind === "loading") return { text: "reading…" }
    if (reach.kind === "failed") return { text: "unavailable", failed: reach.message }
    if (reach.kind !== "ready") return { text: "" }
    // A holding the load did not bring the sets for is named here rather than
    // left to look like ground outside every register.
    const missing = reach.data.undrawn.length ? `, ${reach.data.undrawn.length} not drawn` : ""
    return { text: `${reach.data.geojson.features.length}${missing}` }
  }
  if (key === "gridDemand") {
    const towns = townDemand.get()
    if (towns.kind === "loading") return { text: "reading…" }
    if (towns.kind === "failed") return { text: "unavailable", failed: towns.message }
    return { text: towns.kind === "ready" ? towns.data.towns.toLocaleString() : "" }
  }
  if (key !== "gridMetered" && key !== "gridRegistered" && key !== "gridLines" && key !== "gridBuses") return { text: "" }
  const state = key === "gridMetered" || key === "gridRegistered" ? plants : network
  if (state.kind === "loading") return { text: "reading…" }
  if (state.kind === "failed") return { text: "unavailable", failed: state.message }
  if (plants.kind === "ready" && key === "gridMetered") return { text: plants.data.counts.metered.toLocaleString() }
  if (plants.kind === "ready" && key === "gridRegistered") {
    return { text: (plants.data.counts.returned - plants.data.counts.metered).toLocaleString() }
  }
  if (network.kind === "ready" && key === "gridLines") return { text: `${network.data.counts.lines_in_service.toLocaleString()} in service` }
  if (network.kind === "ready" && key === "gridBuses") return { text: network.data.counts.substations.toLocaleString() }
  return { text: "" }
}

/*
  THE MAP'S LAYERS ARE SWITCHED IN ONE PLACE, THE OUTLINER. They were also a
  popover on this header and four groups of the ribbon: the same eye three
  times, and three places to ask what is on the map. The outliner's tree holds
  THINGS -- the project's and the map's -- and the ribbon holds verbs. The
  ground is the exception that stays on the map, as the tile at its corner,
  because it is chosen by looking at it.
*/

/** A plate floated over the map, as TERRA's reading cards over the globe. */
const PLATE = "pointer-events-auto rounded-sm border shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
const plateStyle = { background: "rgb(var(--p-ink) / 0.92)", borderColor: "rgb(var(--p-line) / 0.4)" }

/*
  NO COMMAND FLOATS OVER THE MAP. It carried a tool plate, a magnifier and a
  compass with zoom and home, and every one of them is a button of the ribbon's
  Map tab: the same command twice, a hand's width apart. The ribbon is where
  commands are. What is left over the map is what is ABOUT the map and belongs
  on it: the ground's tile, the readings' plates, the credit.
*/

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
 *
 * RETRACTED, IT STILL SAYS THE HOUR. The plate folds to its heading to give the
 * map back, and the layers stay drawn, so the heading keeps each layer's hour
 * beside it: what is on the map is never left without its time.
 */
function WeatherPlate() {
  const o = useStore(overlays)
  const w = useStore(weather)
  const wind = fieldOf(useStore(windField).state)
  const open = useStore(weatherPlateOpen)
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

  const hours = [
    o.weatherSatellite && `Clouds ${sat ? clockLabel(sat.time) : "–"}`,
    o.weatherRadar && `Rain ${radar ? clockLabel(radar.time) : "–"}`,
    o.weatherWind && `Wind ${wind ? clockLabel(Date.parse(wind.valid)) : "–"}`,
  ].filter(Boolean)

  return (
    <div className={`${PLATE} w-72 overflow-hidden`} style={plateStyle}>
      <button
        type="button"
        onClick={() => weatherPlateOpen.set(!open)}
        aria-expanded={open}
        title={open ? "Retract" : "Expand"}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-hover"
      >
        {open ? <CaretDown className="size-2.5 shrink-0 text-muted-foreground" /> : <CaretRight className="size-2.5 shrink-0 text-muted-foreground" />}
        <span className={`eyebrow !text-[9px] ${open ? "min-w-0 flex-1 truncate" : "shrink-0"}`}>Weather now</span>
        {open
          ? observed && (
              <span className="telemetry text-[9px] text-muted-foreground" title="Measured by satellite and radar, not modelled">
                observed
              </span>
            )
          : (
              <span className="telemetry min-w-0 flex-1 truncate text-right text-[9px] text-muted-foreground">{hours.join(" · ")}</span>
            )}
      </button>
      {open && (
        <div className="px-2.5 pb-2">
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
      )}
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

/** The imagery tile holding a point, at a whole zoom the service carries. */
function imageryTile(lng: number, lat: number, zoom: number): string {
  const z = Math.max(1, Math.min(BASEMAPS.satellite.maxZoom, Math.floor(zoom)))
  const n = 2 ** z
  const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180
  const x = Math.floor((((lng + 180) / 360) % 1) * n)
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  return IMAGERY_TILES.replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x))
}

/** The street ground in small: its own inks, and no place in particular. */
function StreetsSwatch() {
  return (
    <svg viewBox="0 0 64 64" className="absolute inset-0 size-full" aria-hidden>
      <rect width="64" height="64" fill="#171717" />
      <path d="M-2 46 C 14 40, 22 52, 40 44 S 60 30, 66 34 L 66 66 L -2 66 Z" fill="#0a0a0a" />
      <g fill="none" stroke="#373737" strokeWidth="1">
        <path d="M8 -2 L 14 30 L 6 44" />
        <path d="M30 -2 L 26 18 L 34 40" />
        <path d="M-2 22 L 26 18 L 66 26" />
        <path d="M44 -2 L 48 22 L 40 44" />
      </g>
      <path d="M-2 10 C 20 16, 40 4, 66 12" fill="none" stroke="#525252" strokeWidth="2" />
    </svg>
  )
}

/**
 * The ground, switched from the map itself: a tile at the map's corner that
 * shows the OTHER ground and takes the map to it when pressed.
 *
 * IT SHOWS WHERE IT LEADS, NOT WHERE THE MAP IS. A switch that pictured the
 * ground in use would have to be read as a state and then inverted; pictured
 * as its destination it is read as a door. The imagery's picture is the tile
 * under the map's centre, so it is a preview of this place. The street
 * ground is drawn, since a vector map has no tile to borrow.
 */
function BasemapSwitch() {
  const ground = useStore(basemap)
  const { lng, lat, zoom } = useStore(mapView)
  const to: BasemapId = ground === "dark" ? "satellite" : "dark"
  const label = to === "satellite" ? "Imagery" : "Streets"
  return (
    <button
      type="button"
      onClick={() => basemap.set(to)}
      title={`Switch the ground to ${BASEMAP_ITEMS.find((b) => b.id === to)?.label ?? label}`}
      aria-label={`Switch the ground to ${label}`}
      className="pointer-events-auto relative size-16 shrink-0 overflow-hidden rounded-md border-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-[filter] hover:brightness-125"
      style={{ borderColor: "rgb(var(--p-text) / 0.85)", background: "var(--s-field)" }}
    >
      {to === "satellite" ? (
        <span
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${imageryTile(lng, lat, zoom)}")` }}
          aria-hidden
        />
      ) : (
        <StreetsSwatch />
      )}
      <span
        className="absolute inset-x-0 bottom-0 flex items-center gap-1 px-1.5 pb-1 pt-3 text-meta text-white"
        style={{ background: "linear-gradient(to top, rgb(0 0 0 / 0.75), transparent)" }}
      >
        <Stack className="size-3 shrink-0" />
        {label}
      </span>
    </button>
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
  const view = useStore(mapView)

  useEffect(() => {
    const el = container.current
    if (!el) return
    return mountMap(el)
  }, [])

  return (
    <>
      <AreaHeader
        centre={
          <span className="telemetry header-label text-[9px] text-muted-foreground">
            {formatLat(view.lat, 3)} {formatLng(view.lng, 3)}
          </span>
        }
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
          {/* The address field, while Locate has it open, and the measure's figure while that tool is on. */}
          <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-2">
            <AddressSearch />
            <MeasurePlate />
          </div>
          <div className="absolute bottom-7 right-2">
            <WeatherPlate />
          </div>
          <div className="absolute bottom-7 left-2 flex items-end gap-2">
            <BasemapSwitch />
            <RedoPlate />
          </div>
          <Foot />
        </div>
      </div>
    </>
  )
}

import { useEffect } from "react"
import { WindField as WindFieldBinding } from "../../wailsjs/go/main/App"
import type { weather as weatherModels } from "../../wailsjs/go/models"
import { errorMessage } from "./errors"
import { mapView } from "./mapState"
import { createStore, useStore } from "./store"

/**
 * The weather as it is now: clouds from GOES-East, rain from radar, and the
 * conditions at a site from a short-range model.
 *
 * OBSERVED AND MODELLED ARE NOT THE SAME CLAIM, and every surface that shows
 * these says which it is. The satellite and the radar are measurements, late
 * by how long their producers take to publish them. Open-Meteo's "current" is
 * the first step of a forecast: it is what a model expects this quarter hour
 * to be, not what an instrument read.
 *
 * Everything here needs the internet, unlike the rest of the application,
 * which reads a local store or a cache. A source that cannot be reached is a
 * state with its reason, never a thrown error.
 */

// ---- The satellite ---------------------------------------------------------------------

export type SatelliteProduct = "geocolor" | "infrared"

/**
 * NASA GIBS serves GOES-East's ABI as web map tiles every ten minutes. GeoColor
 * is true colour by day and infrared by night; band 13 is infrared throughout,
 * so clouds read the same at noon and at midnight.
 */
export const SATELLITE: Record<SatelliteProduct, { layer: string; matrix: string; maxzoom: number; label: string }> = {
  geocolor: { layer: "GOES-East_ABI_GeoColor", matrix: "GoogleMapsCompatible_Level7", maxzoom: 7, label: "Colour" },
  infrared: { layer: "GOES-East_ABI_Band13_Clean_Infrared", matrix: "GoogleMapsCompatible_Level6", maxzoom: 6, label: "Infrared" },
}

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"

export function satelliteTiles(product: SatelliteProduct, time: string): string {
  const s = SATELLITE[product]
  return `${GIBS}/${s.layer}/default/${time}/${s.matrix}/{z}/{y}/{x}.png`
}

/** How far back the timeline reaches, in frames ten minutes apart. */
export const FRAMES = 12
const STEP_MS = 10 * 60_000

// ---- The radar -------------------------------------------------------------------------

/**
 * RainViewer's composite of the national radars it receives: the last two
 * hours, ten minutes apart. Its coverage in Brazil is the radars', which are
 * dense in the South and Southeast and sparse inland in the Northeast, so an
 * empty radar map there is an absence of radar, not an absence of rain.
 */
const RAINVIEWER = "https://api.rainviewer.com/public/weather-maps.json"
/** Past this zoom RainViewer serves a placeholder; the map scales the last real tiles up instead. */
export const RADAR_MAXZOOM = 7

export function radarTiles(host: string, path: string): string {
  // 256 px tiles, colour scheme 2 (universal blue), smoothed, snow shown.
  return `${host}${path}/256/{z}/{x}/{y}/2/1_1.png`
}

// ---- The timeline ----------------------------------------------------------------------

export type Frame = { time: number; key: string; tiles: string }

export type LayerFrames =
  | { kind: "idle" }
  | { kind: "loading"; frames: Frame[] }
  | { kind: "ready"; frames: Frame[]; checked: number }
  | { kind: "failed"; message: string; frames: Frame[] }

export type WeatherState = {
  satellite: LayerFrames
  radar: LayerFrames
  product: SatelliteProduct
  /** The moment shown, as a time; null follows the newest frame. */
  at: number | null
  playing: boolean
  satelliteOpacity: number
  radarOpacity: number
  /** When tiles of a layer last failed to load, so the plate can say the layer is being refused. */
  tileFailedAt: { satellite: number | null; radar: number | null }
}

export const weather = createStore<WeatherState>({
  satellite: { kind: "idle" },
  radar: { kind: "idle" },
  product: "geocolor",
  at: null,
  playing: false,
  satelliteOpacity: 0.75,
  radarOpacity: 0.8,
  tileFailedAt: { satellite: null, radar: null },
})

/**
 * A tile of a layer failed. Throttled to one store change a few seconds, since
 * a refused viewport fails a dozen tiles at once.
 */
export function noteTileFailure(layer: "satellite" | "radar"): void {
  const last = weather.get().tileFailedAt[layer]
  if (last !== null && Date.now() - last < 5000) return
  weather.set((w) => ({ ...w, tileFailedAt: { ...w.tileFailedAt, [layer]: Date.now() } }))
}

/** Whether a layer's tiles have been failing within the last minute. */
export const tilesFailing = (w: WeatherState, layer: "satellite" | "radar", now = Date.now()) =>
  w.tileFailedAt[layer] !== null && now - w.tileFailedAt[layer]! < 60_000

const framesOf = (s: LayerFrames): Frame[] => (s.kind === "idle" ? [] : s.frames)

/** The frame of a layer shown at `at`: the newest one not after it, else its oldest. */
export function frameAt(s: LayerFrames, at: number | null): Frame | null {
  const frames = framesOf(s)
  if (!frames.length) return null
  if (at === null) return frames[frames.length - 1]
  let best: Frame | null = null
  for (const f of frames) if (f.time <= at) best = f
  return best ?? frames[0]
}

/** Every moment the timeline can stop at: the union of both layers' frames, oldest first. */
export function timelineTimes(s: WeatherState, satelliteOn: boolean, radarOn: boolean): number[] {
  const times = new Set<number>()
  if (satelliteOn) for (const f of framesOf(s.satellite)) times.add(f.time)
  if (radarOn) for (const f of framesOf(s.radar)) times.add(f.time)
  return [...times].sort((a, b) => a - b)
}

/**
 * The satellite's frames. GIBS publishes the newest time in a header of any
 * tile asked for at time "default", so one small tile says where the timeline
 * ends; the frames before it are ten minutes apart by the product's cadence.
 */
export async function refreshSatellite(): Promise<void> {
  const product = weather.get().product
  weather.set((w) => ({ ...w, satellite: { kind: "loading", frames: framesOf(w.satellite) } }))
  try {
    const s = SATELLITE[product]
    const res = await fetch(`${GIBS}/${s.layer}/default/default/${s.matrix}/0/0/0.png`, { cache: "no-store" })
    if (!res.ok) throw new Error(`GIBS answered ${res.status}`)
    const latest = res.headers.get("layer-time-actual")
    const end = latest ? Date.parse(latest) : NaN
    if (!Number.isFinite(end)) throw new Error("GIBS did not say which time it holds")
    const frames: Frame[] = []
    for (let i = FRAMES - 1; i >= 0; i--) {
      const time = end - i * STEP_MS
      const iso = new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z")
      frames.push({ time, key: `${product}-${time}`, tiles: satelliteTiles(product, iso) })
    }
    // A product switched while this was in flight has its own refresh coming.
    if (weather.get().product !== product) return
    weather.set((w) => ({ ...w, satellite: { kind: "ready", frames, checked: Date.now() } }))
  } catch (e) {
    // The frames already drawn stay: a missed refresh does not take the clouds off the map.
    weather.set((w) => ({ ...w, satellite: { kind: "failed", message: networkReason(e), frames: framesOf(w.satellite) } }))
  }
}

export async function refreshRadar(): Promise<void> {
  weather.set((w) => ({ ...w, radar: { kind: "loading", frames: framesOf(w.radar) } }))
  try {
    const res = await fetch(RAINVIEWER, { cache: "no-store" })
    if (!res.ok) throw new Error(`RainViewer answered ${res.status}`)
    const body = (await res.json()) as { host?: string; radar?: { past?: { time: number; path: string }[] } }
    const past = body.radar?.past ?? []
    if (!body.host || !past.length) throw new Error("RainViewer listed no radar frames")
    const frames = past.map((p) => ({ time: p.time * 1000, key: `radar-${p.time}`, tiles: radarTiles(body.host!, p.path) }))
    weather.set((w) => ({ ...w, radar: { kind: "ready", frames, checked: Date.now() } }))
  } catch (e) {
    weather.set((w) => ({ ...w, radar: { kind: "failed", message: networkReason(e), frames: framesOf(w.radar) } }))
  }
}

export function setSatelliteProduct(product: SatelliteProduct): void {
  if (weather.get().product === product) return
  // Idle, and the map asks for the new product's frames while the overlay is on.
  weather.set((w) => ({ ...w, product, satellite: { kind: "idle" } }))
}

export function setMoment(at: number | null): void {
  weather.set((w) => ({ ...w, at }))
}

export function setPlaying(playing: boolean): void {
  weather.set((w) => ({ ...w, playing }))
}

export function setOpacity(layer: "satellite" | "radar", value: number): void {
  weather.set((w) => (layer === "satellite" ? { ...w, satelliteOpacity: value } : { ...w, radarOpacity: value }))
}

/** A fetch that failed, in words: the webview reports no connection as a bare TypeError. */
function networkReason(e: unknown): string {
  const msg = errorMessage(e)
  return /failed to fetch|load failed|networkerror|network connection/i.test(msg) ? "no connection to the internet" : msg
}

/** Minutes between a frame and now, as a reader wants to see the lag. */
export function ageLabel(time: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - time) / 60_000))
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  return `${h} h ${String(min % 60).padStart(2, "0")} min ago`
}

export const clockLabel = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

// ---- Conditions at a place ---------------------------------------------------------------

/** Open-Meteo's forecast endpoint: free for non-commercial use, with attribution. */
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast"

export type Now = {
  /** The quarter hour the values stand for, as ISO local time at the place. */
  time: string
  timezone: string
  temperatureC: number | null
  cloudCoverPct: number | null
  ghi: number | null
  dni: number | null
  dhi: number | null
  wind10: number | null
  windDirection10: number | null
  gust10: number | null
  wind80: number | null
  wind120: number | null
  /** Today's irradiation, modelled for the whole day, in kWh/m². */
  todayKwhM2: number | null
  /** The next 24 hours, hourly. */
  hours: { time: string; ghi: number | null; wind120: number | null; cloudPct: number | null }[]
  fetched: number
}

export type NowState = { kind: "loading"; last: Now | null } | { kind: "ready"; now: Now } | { kind: "failed"; message: string; last: Now | null }

const CURRENT = [
  "temperature_2m",
  "cloud_cover",
  "shortwave_radiation",
  "direct_normal_irradiance",
  "diffuse_radiation",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "wind_speed_80m",
  "wind_speed_120m",
]

export function nowUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: CURRENT.join(","),
    hourly: "shortwave_radiation,wind_speed_120m,cloud_cover",
    forecast_hours: "24",
    daily: "shortwave_radiation_sum",
    forecast_days: "1",
    timezone: "auto",
    wind_speed_unit: "ms",
  })
  return `${OPEN_METEO}?${q}`
}

type OpenMeteoReply = {
  timezone?: string
  current?: Record<string, number | string | null>
  hourly?: { time?: string[]; shortwave_radiation?: (number | null)[]; wind_speed_120m?: (number | null)[]; cloud_cover?: (number | null)[] }
  daily?: { shortwave_radiation_sum?: (number | null)[] }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

/** Open-Meteo's reply as this application names things. Daily irradiation arrives in MJ/m². */
export function parseNow(body: OpenMeteoReply, fetched = Date.now()): Now {
  const c = body.current ?? {}
  const h = body.hourly ?? {}
  const mj = num(body.daily?.shortwave_radiation_sum?.[0])
  return {
    time: String(c.time ?? ""),
    timezone: body.timezone ?? "",
    temperatureC: num(c.temperature_2m),
    cloudCoverPct: num(c.cloud_cover),
    ghi: num(c.shortwave_radiation),
    dni: num(c.direct_normal_irradiance),
    dhi: num(c.diffuse_radiation),
    wind10: num(c.wind_speed_10m),
    windDirection10: num(c.wind_direction_10m),
    gust10: num(c.wind_gusts_10m),
    wind80: num(c.wind_speed_80m),
    wind120: num(c.wind_speed_120m),
    todayKwhM2: mj === null ? null : mj / 3.6,
    hours: (h.time ?? []).map((time, i) => ({
      time,
      ghi: num(h.shortwave_radiation?.[i]),
      wind120: num(h.wind_speed_120m?.[i]),
      cloudPct: num(h.cloud_cover?.[i]),
    })),
    fetched,
  }
}

/** One entry per place, rounded to about a kilometre: the model's cells are coarser than that. */
const nows = createStore<Record<string, NowState>>({})
const placeKey = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`
/** The model advances a quarter hour at a time; asking sooner returns the same values. */
const FRESH_MS = 10 * 60_000

export async function refreshNow(lat: number, lon: number, force = false): Promise<void> {
  const key = placeKey(lat, lon)
  const prior = nows.get()[key]
  const last = prior?.kind === "ready" ? prior.now : prior?.kind === "failed" || prior?.kind === "loading" ? prior.last : null
  if (prior?.kind === "loading") return
  if (!force && last && Date.now() - last.fetched < FRESH_MS) return
  nows.set((all) => ({ ...all, [key]: { kind: "loading", last } }))
  try {
    const res = await fetch(nowUrl(lat, lon), { cache: "no-store" })
    if (!res.ok) {
      const reason = ((await res.json().catch(() => null)) as { reason?: string } | null)?.reason
      throw new Error(reason ? `Open-Meteo: ${reason}` : `Open-Meteo answered ${res.status}`)
    }
    const now = parseNow((await res.json()) as OpenMeteoReply)
    nows.set((all) => ({ ...all, [key]: { kind: "ready", now } }))
  } catch (e) {
    nows.set((all) => ({ ...all, [key]: { kind: "failed", message: networkReason(e), last } }))
  }
}

/** The conditions at a place, fetched when first shown and kept fresh while shown. */
export function useNow(lat: number, lon: number): NowState | undefined {
  const all = useStore(nows)
  // Rounded as the cache is, so a site dragged across the map asks once per cell it settles in, not once per frame.
  const rlat = Number(lat.toFixed(2))
  const rlon = Number(lon.toFixed(2))
  useEffect(() => {
    const first = window.setTimeout(() => void refreshNow(rlat, rlon), 500)
    const timer = window.setInterval(() => void refreshNow(rlat, rlon), FRESH_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [rlat, rlon])
  return all[placeKey(rlat, rlon)]
}

export const nowOf = (s: NowState | undefined): Now | null =>
  !s ? null : s.kind === "ready" ? s.now : s.last

// ---- The wind field ----------------------------------------------------------------------

/**
 * GFS's wind over South America at one height, read by the sidecar (it arrives
 * as NetCDF). Modelled: a forecast for this hour from a run a few hours old.
 * The grid is half a degree, west to east and north to south.
 */
export type WindHeight = 10 | 100

export type WindFieldState =
  | { kind: "idle" }
  | { kind: "loading"; field: weatherModels.WindField | null }
  | { kind: "ready"; field: weatherModels.WindField; checked: number }
  | { kind: "failed"; message: string; field: weatherModels.WindField | null }

export const windField = createStore<{ height: WindHeight; state: WindFieldState }>({ height: 10, state: { kind: "idle" } })

export const fieldOf = (s: WindFieldState): weatherModels.WindField | null => (s.kind === "idle" ? null : s.field)

/*
  GFS is global; what is asked for is a window of it, sized like the one this
  was first drawn over. Over South America that window is the original one,
  so nothing changes there. Anywhere else it is centred on the map, snapped to
  fifteen degrees so that a small pan asks for the same field again and finds
  it in the cache.
*/
const SOUTH_AMERICA = { west: -95, south: -50, east: -10, north: 15 }
const WINDOW = { lon: 85, lat: 65 }

/** The window of the model the map is over, or [] for the default, South America. */
export function windRegion(lng: number, lat: number): number[] {
  if (lng >= SOUTH_AMERICA.west + 15 && lng <= SOUTH_AMERICA.east - 15 && lat >= SOUTH_AMERICA.south + 10 && lat <= SOUTH_AMERICA.north - 5) return []
  const snap = (v: number) => Math.round(v / 15) * 15
  const west = Math.min(Math.max(snap(lng) - WINDOW.lon / 2, -180), 180 - WINDOW.lon)
  const south = Math.min(Math.max(snap(lat) - WINDOW.lat / 2, -85), 85 - WINDOW.lat)
  return [west, south, west + WINDOW.lon, south + WINDOW.lat]
}

/** The window the field on screen was read over, as a key: null before any was. */
let windRead: string | null = null
export const windRegionRead = () => windRead

export async function refreshWind(): Promise<void> {
  const height = windField.get().height
  const view = mapView.get()
  const region = windRegion(view.lng, view.lat)
  windRead = region.join(",")
  const prior = fieldOf(windField.get().state)
  windField.set((w) => ({ ...w, state: { kind: "loading", field: prior } }))
  try {
    const field = await WindFieldBinding(height, region)
    // A height switched while this was in flight has its own refresh coming.
    if (windField.get().height !== height) return
    windField.set((w) => ({ ...w, state: { kind: "ready", field, checked: Date.now() } }))
  } catch (e) {
    windField.set((w) => ({ ...w, state: { kind: "failed", message: errorMessage(e), field: prior?.height_m === height ? prior : null } }))
  }
}

export function setWindHeight(height: WindHeight): void {
  if (windField.get().height === height) return
  // Idle, and the map asks for the new height's field while the overlay is on.
  windField.set({ height, state: { kind: "idle" } })
}

/** The wind at a place, bilinear between the four grid points around it; null outside the grid or where a corner is missing. */
export function windAt(f: weatherModels.WindField, lon: number, lat: number): { u: number; v: number } | null {
  const x = (lon - f.lon0) / f.dlon
  const y = (f.lat0 - lat) / f.dlat
  if (!(x >= 0 && y >= 0 && x <= f.nx - 1 && y <= f.ny - 1)) return null
  const i = Math.min(Math.floor(x), f.nx - 2)
  const j = Math.min(Math.floor(y), f.ny - 2)
  const fx = x - i
  const fy = y - j
  const at = (a: (number | null)[], ii: number, jj: number) => a[jj * f.nx + ii]
  const pick = (a: (number | null)[]) => {
    const c00 = at(a, i, j)
    const c10 = at(a, i + 1, j)
    const c01 = at(a, i, j + 1)
    const c11 = at(a, i + 1, j + 1)
    if (c00 == null || c10 == null || c01 == null || c11 == null) return null
    return (c00 * (1 - fx) + c10 * fx) * (1 - fy) + (c01 * (1 - fx) + c11 * fx) * fy
  }
  const u = pick(f.u)
  const v = pick(f.v)
  return u === null || v === null ? null : { u, v }
}

/**
 * Speed to colour, dark violet for calm through cyan and green to yellow and
 * red for a gale, the order the wind maps readers know use. Stops in m/s.
 */
export const WIND_STOPS: readonly [number, [number, number, number]][] = [
  [0, [45, 38, 110]],
  [3, [62, 76, 170]],
  [6, [58, 128, 200]],
  [9, [72, 186, 200]],
  [12, [118, 206, 140]],
  [15, [214, 224, 104]],
  [20, [244, 168, 60]],
  [25, [226, 86, 58]],
  [32, [170, 36, 92]],
]

export function windColour(speed: number): [number, number, number] {
  if (speed <= WIND_STOPS[0][0]) return WIND_STOPS[0][1]
  for (let k = 1; k < WIND_STOPS.length; k++) {
    const [s1, c1] = WIND_STOPS[k]
    if (speed <= s1) {
      const [s0, c0] = WIND_STOPS[k - 1]
      const t = (speed - s0) / (s1 - s0)
      return [0, 1, 2].map((n) => Math.round(c0[n] + (c1[n] - c0[n]) * t)) as [number, number, number]
    }
  }
  return WIND_STOPS[WIND_STOPS.length - 1][1]
}

const POINTS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

/**
 * Where the wind comes FROM, as a meteorologist names it (u, v blow towards
 * east and north), and the bearing it blows TOWARDS, which is what an arrow
 * on a map draws.
 */
export function windDirection(u: number, v: number): { from: string; fromDeg: number; towardsDeg: number } {
  const towards = (Math.atan2(u, v) * 180) / Math.PI
  const towardsDeg = (towards + 360) % 360
  const fromDeg = (towardsDeg + 180) % 360
  return { from: POINTS16[Math.round(fromDeg / 22.5) % 16], fromDeg, towardsDeg }
}

/** The wind under the pointer, for the readout beside it; null when the pointer is off the field. */
export const windProbe = createStore<{ x: number; y: number; speed: number; from: string; towardsDeg: number; height: number } | null>(null)

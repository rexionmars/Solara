import type { GeoJSONSource, ImageSource, Map as MapLibreMap } from "maplibre-gl"
import type { weather as weatherModels } from "../../wailsjs/go/models"
import { windAt, windColour, windDirection } from "./weather"

type Field = weatherModels.WindField

/**
 * The wind field drawn as the wind maps draw it: the speed as a colour under
 * everything, and particles carried along the direction, leaving short trails.
 */

// ---- The speed, as an image --------------------------------------------------------------

const rad = (d: number) => (d * Math.PI) / 180
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))
const latOfMercY = (y: number) => (Math.atan(Math.sinh(y)) * 180) / Math.PI

/**
 * The speed over the grid's extent as a PNG, sampled row by row in the map's
 * own projection. An image source is stretched linearly between its corners in
 * Web Mercator, so an image made in latitude steps would put the south of the
 * continent a few hundred kilometres off where the wind actually is.
 */
export function speedImage(f: Field, width = 640): { url: string; corners: [[number, number], [number, number], [number, number], [number, number]] } {
  const west = f.lon0
  const east = f.lon0 + (f.nx - 1) * f.dlon
  const north = f.lat0
  const south = f.lat0 - (f.ny - 1) * f.dlat
  const top = mercY(north)
  const bottom = mercY(south)
  const height = Math.max(2, Math.round((width * (top - bottom)) / rad(east - west)))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  const img = ctx.createImageData(width, height)
  for (let py = 0; py < height; py++) {
    const lat = latOfMercY(top + ((py + 0.5) / height) * (bottom - top))
    for (let px = 0; px < width; px++) {
      const lon = west + ((px + 0.5) / width) * (east - west)
      const w = windAt(f, lon, lat)
      const k = (py * width + px) * 4
      if (!w) continue
      const [r, g, b] = windColour(Math.hypot(w.u, w.v))
      img.data[k] = r
      img.data[k + 1] = g
      img.data[k + 2] = b
      img.data[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return {
    url: canvas.toDataURL("image/png"),
    corners: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  }
}

export const SPEED_SOURCE = "wx-wind-speed"
export const LABEL_SOURCE = "wx-wind-labels"

export function drawSpeed(m: MapLibreMap, f: Field, opacity: number, before: string): void {
  const { url, corners } = speedImage(f)
  const source = m.getSource<ImageSource>(SPEED_SOURCE)
  if (source) {
    source.updateImage({ url, coordinates: corners })
    m.setPaintProperty(SPEED_SOURCE, "raster-opacity", opacity)
    return
  }
  m.addSource(SPEED_SOURCE, { type: "image", url, coordinates: corners })
  m.addLayer(
    { id: SPEED_SOURCE, type: "raster", source: SPEED_SOURCE, paint: { "raster-opacity": opacity, "raster-resampling": "linear", "raster-fade-duration": 0 } },
    before
  )
}

export function removeSpeed(m: MapLibreMap): void {
  if (m.getLayer(SPEED_SOURCE)) m.removeLayer(SPEED_SOURCE)
  if (m.getSource(SPEED_SOURCE)) m.removeSource(SPEED_SOURCE)
}

// ---- Labels at the project's places --------------------------------------------------------

const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"]

/** The arrow a wind blowing towards `deg` is drawn with. */
export const arrowTowards = (deg: number) => ARROWS[Math.round(deg / 45) % 8]

/** Speed and an arrow at each site and area, where the reader's own question is. */
export function drawLabels(m: MapLibreMap, f: Field | null, places: { lon: number; lat: number }[]): void {
  const features = !f
    ? []
    : places.flatMap((p) => {
        const w = windAt(f, p.lon, p.lat)
        if (!w) return []
        const speed = Math.hypot(w.u, w.v)
        return [
          {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
            properties: { label: `${speed.toFixed(1)} ${arrowTowards(windDirection(w.u, w.v).towardsDeg)}` },
          },
        ]
      })
  const data = { type: "FeatureCollection" as const, features }
  const source = m.getSource<GeoJSONSource>(LABEL_SOURCE)
  if (source) {
    source.setData(data)
    return
  }
  m.addSource(LABEL_SOURCE, { type: "geojson", data })
  m.addLayer({
    id: LABEL_SOURCE,
    type: "symbol",
    source: LABEL_SOURCE,
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-anchor": "top",
      "text-offset": [0, 0.9],
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#ffffff", "text-halo-color": "rgba(20, 22, 60, 0.9)", "text-halo-width": 2 },
  })
}

export function removeLabels(m: MapLibreMap): void {
  if (m.getLayer(LABEL_SOURCE)) m.removeLayer(LABEL_SOURCE)
  if (m.getSource(LABEL_SOURCE)) m.removeSource(LABEL_SOURCE)
}

// ---- The particles -------------------------------------------------------------------------

/** Pixels a particle travels per frame per m/s: 10 m/s crosses about 90 px a second. */
const PX_PER_MS = 0.15
/** How much of a trail survives each frame; lower is shorter. */
const TRAIL_KEEP = 0.92
/** One particle per this many square CSS pixels. */
const AREA_PER_PARTICLE = 320

type Particle = { x: number; y: number; age: number; life: number }

/**
 * Particles carried by the field, on a canvas laid over the map and under its
 * markers. They move in screen pixels, sampled at their geographic position
 * each frame, so they follow the map through zoom without being re-seeded.
 * While the map moves the trails are cleared and the particles wait: a trail
 * drawn in the old view would streak across the new one.
 *
 * Reduced motion draws the same streaks once, still, instead of animating.
 */
export class WindParticles {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private particles: Particle[] = []
  private field: Field | null = null
  private frame = 0
  private moving = false
  private readonly still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  private readonly observer: ResizeObserver

  constructor(private readonly map: MapLibreMap) {
    this.canvas = document.createElement("canvas")
    this.canvas.setAttribute("aria-hidden", "true")
    Object.assign(this.canvas.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none" })
    const container = map.getCanvasContainer()
    container.insertBefore(this.canvas, map.getCanvas().nextSibling)
    this.ctx = this.canvas.getContext("2d")!
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(map.getContainer())
    map.on("movestart", this.onMoveStart)
    map.on("moveend", this.onMoveEnd)
    this.resize()
  }

  setField(field: Field | null): void {
    if (field === this.field) return
    this.field = field
    this.seed()
    if (this.still) this.drawStill()
    else if (!this.frame) this.frame = requestAnimationFrame(this.step)
  }

  destroy(): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.observer.disconnect()
    this.map.off("movestart", this.onMoveStart)
    this.map.off("moveend", this.onMoveEnd)
    this.canvas.remove()
  }

  private get size() {
    const c = this.map.getContainer()
    return { w: c.clientWidth, h: c.clientHeight }
  }

  private resize(): void {
    const { w, h } = this.size
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.round(w * dpr))
    this.canvas.height = Math.max(1, Math.round(h * dpr))
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.seed()
    if (this.still) this.drawStill()
  }

  private spawn(p?: Particle): Particle {
    const { w, h } = this.size
    const q = p ?? { x: 0, y: 0, age: 0, life: 0 }
    q.x = Math.random() * w
    q.y = Math.random() * h
    q.age = 0
    q.life = 40 + Math.floor(Math.random() * 60)
    return q
  }

  private seed(): void {
    const { w, h } = this.size
    const count = Math.min(5000, Math.max(600, Math.round((w * h) / AREA_PER_PARTICLE)))
    this.particles = Array.from({ length: count }, () => {
      const p = this.spawn()
      // Staggered, so the first frames do not all expire together.
      p.age = Math.floor(Math.random() * p.life)
      return p
    })
    this.clear()
  }

  private clear(): void {
    const { w, h } = this.size
    this.ctx.clearRect(0, 0, w, h)
  }

  private onMoveStart = () => {
    this.moving = true
    this.clear()
  }

  private onMoveEnd = () => {
    this.moving = false
    this.seed()
    if (this.still) this.drawStill()
  }

  /** Advance one particle, drawing its segment into the current path; false when it has to be re-seeded. */
  private advance(p: Particle): boolean {
    const f = this.field
    if (!f) return false
    const { w, h } = this.size
    const at = this.map.unproject([p.x, p.y])
    const wind = windAt(f, at.lng, at.lat)
    if (!wind || p.age++ > p.life) return false
    const nx = p.x + wind.u * PX_PER_MS
    const ny = p.y - wind.v * PX_PER_MS
    if (nx < 0 || ny < 0 || nx > w || ny > h) return false
    this.ctx.moveTo(p.x, p.y)
    this.ctx.lineTo(nx, ny)
    p.x = nx
    p.y = ny
    return true
  }

  private step = () => {
    this.frame = requestAnimationFrame(this.step)
    if (this.moving || !this.field) return
    const { w, h } = this.size
    const ctx = this.ctx
    ctx.globalCompositeOperation = "destination-in"
    ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_KEEP})`
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = "source-over"
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const p of this.particles) if (!this.advance(p)) this.spawn(p)
    ctx.stroke()
  }

  private drawStill(): void {
    if (!this.field) return
    this.clear()
    const ctx = this.ctx
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)"
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const p of this.particles.slice(0, Math.round(this.particles.length / 4))) {
      p.age = 0
      p.life = 1000
      for (let i = 0; i < 14 && this.advance(p); i++);
    }
    ctx.stroke()
  }
}

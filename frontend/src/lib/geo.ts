const EARTH_RADIUS_KM = 6378.137

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Area enclosed by a longitude/latitude ring on the sphere, in km², by the
 * method of Chamberlain and Duquette (2007), "Some algorithms for polygons on
 * a sphere", as the geojson-area package implements it. Good to a fraction of
 * a per cent at field scale, which is what the properties panel reports.
 */
function ringAreaKm2(ring: number[][]): number {
  let total = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i]
    const [lon2, lat2] = ring[i + 1]
    total += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)))
  }
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2)
}

/** Area of a GeoJSON polygon, outer ring less its holes, in km². */
export function polygonAreaKm2(p: { coordinates: number[][][] }): number {
  const [outer, ...holes] = p.coordinates
  if (!outer) return 0
  return Math.max(0, ringAreaKm2(outer) - holes.reduce((sum, h) => sum + ringAreaKm2(h), 0))
}

/** Great-circle distance between two positions, in km, on the same sphere as the areas. */
export function distanceKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The vertex mean of a polygon's outer ring: where its label goes, not its centre of mass. */
export function ringCentre(p: { coordinates: number[][][] }): { lon: number; lat: number } {
  const ring = p.coordinates[0] ?? []
  // The ring repeats its first vertex at the end; count it once.
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring
  const n = Math.max(1, pts.length)
  return {
    lon: pts.reduce((s, c) => s + c[0], 0) / n,
    lat: pts.reduce((s, c) => s + c[1], 0) / n,
  }
}

/** [west, south, east, north] of a set of positions, or null for none. */
export function bounds(points: number[][]): [number, number, number, number] | null {
  if (!points.length) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [lon, lat] of points) {
    w = Math.min(w, lon)
    s = Math.min(s, lat)
    e = Math.max(e, lon)
    n = Math.max(n, lat)
  }
  return [w, s, e, n]
}

/**
 * Whether a point falls inside a polygon's outer ring, by ray casting.
 *
 * The outer ring only: the shapes this is asked about are administrative
 * boundaries taken as one ring, and a hole in one would be a lake, which is
 * still inside the municipality that surrounds it.
 *
 * Longitudes are compared as given. Brazil is far from the antimeridian, so
 * no ring here crosses it and the naive comparison holds.
 */
export function pointInPolygon(lon: number, lat: number, p: { coordinates: number[][][] }): boolean {
  const ring = p.coordinates[0]
  if (!ring || ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The middle of a feature's coordinates, whatever its geometry: enough to ask which region holds it. */
export function centroidOf(geometry: { type: string; coordinates: unknown }): { lon: number; lat: number } | null {
  let sx = 0
  let sy = 0
  let n = 0
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      sx += c[0] as number
      sy += c[1] as number
      n++
      return
    }
    for (const part of c) walk(part)
  }
  walk(geometry.coordinates)
  return n ? { lon: sx / n, lat: sy / n } : null
}

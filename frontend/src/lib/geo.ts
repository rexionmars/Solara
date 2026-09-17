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

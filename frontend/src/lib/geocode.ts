/**
 * Where an address is, for the map's search: a name typed, a short list of
 * places it could be, and the point and extent of each.
 *
 * PHOTON, NOT NOMINATIM. Both read OpenStreetMap. Nominatim's public service
 * forbids searching while the reader types and asks for a User-Agent a
 * webview cannot set; Photon, which komoot runs over the same data, is built
 * for exactly that and answers any origin. It is a free service with no
 * availability promise, so the caller waits for a pause in the typing and
 * asks for a handful of places, not a page.
 *
 * THIS FINDS A PLACE TO LOOK AT, NOT GROUND TO READ. What comes back is
 * whatever OpenStreetMap's contributors have mapped, which is the reason an
 * area never comes from a geocoder (places.ts). A point is another matter: a
 * site is a point the reader chooses, and an address is a fair way to choose.
 */

const PHOTON = "https://photon.komoot.io/api/"

export type Found = {
  id: string
  name: string
  /** The rest of the address, widest last: district, city, state, country. */
  detail: string
  lon: number
  lat: number
  /** West, north, east, south, where the place has an outline of its own. */
  extent?: [number, number, number, number]
}

type PhotonFeature = {
  properties: Record<string, string | number | number[] | undefined>
  geometry: { coordinates: [number, number] }
}

/** "-4.76, -42.61" and "-4.76 -42.61": latitude then longitude, as the Add Site operator reads them. */
export function asCoordinates(text: string): Found | null {
  const m = text.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1].replace(",", "."))
  const lon = Number(m[2].replace(",", "."))
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { id: "coordinates", name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, detail: "Latitude, longitude", lon, lat }
}

export async function searchAddress(
  query: string,
  near: { lng: number; lat: number },
  signal?: AbortSignal
): Promise<Found[]> {
  const url = new URL(PHOTON)
  url.searchParams.set("q", query)
  url.searchParams.set("limit", "6")
  // Places near what the map is showing come first; nothing is excluded.
  url.searchParams.set("lat", near.lat.toFixed(4))
  url.searchParams.set("lon", near.lng.toFixed(4))
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`The address service answered ${res.status}`)
  const body = (await res.json()) as { features?: PhotonFeature[] }
  return (body.features ?? []).map((f, i) => {
    const p = f.properties
    const text = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "")
    const street = [text("street"), text("housenumber")].filter(Boolean).join(", ")
    const name = text("name") || street || text("city") || text("state") || text("country")
    const rest = [text("name") ? street : "", text("district"), text("city"), text("state"), text("country")]
    const extent = Array.isArray(p.extent) && p.extent.length === 4 ? (p.extent as [number, number, number, number]) : undefined
    return {
      id: `${text("osm_type")}${p.osm_id ?? i}`,
      name,
      // A part is said once: a city found by its own name is not also "in" itself.
      detail: rest.filter((part, at) => part && part !== name && rest.indexOf(part) === at).join(" · "),
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      extent,
    }
  })
}

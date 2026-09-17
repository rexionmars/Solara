import { formatLat, formatLng } from "./format"
import { polygonAreaKm2 } from "./geo"
import { allNames, commit, mapItem, newId, uniqueName, type Polygon } from "./project"
import { note } from "./reports"
import { select } from "./selection"
import { lastOperation } from "./ui"

/** Creating and editing the scene objects. Each is one undo step. */

export function validLonLat(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

export function addSite(lon: number, lat: number, name = "Site"): string {
  const id = newId()
  commit("Add Site", (d) => ({
    ...d,
    sites: [...d.sites, { kind: "site", id, name: uniqueName(name, allNames(d)), lon, lat, hidden: false }],
  }))
  select(id)
  note(`Site added at ${formatLat(lat)}  ${formatLng(lon)}.`)
  return id
}

export function addArea(polygon: Polygon, name = "Area"): string {
  const id = newId()
  commit("Add Area", (d) => ({
    ...d,
    areas: [...d.areas, { kind: "area", id, name: uniqueName(name, allNames(d)), polygon, hidden: false }],
  }))
  select(id)
  // Drawing is not adjustable afterwards, so the panel no longer describes the last operation.
  lastOperation.set(null)
  const vertices = polygon.coordinates[0].length - 1
  note(`Area added: ${vertices} vertices, ${polygonAreaKm2(polygon).toFixed(2)} km².`)
  return id
}

export function setSiteCoordinate(id: string, axis: "lon" | "lat", value: number): void {
  commit("Move Site", (d) => mapItem(d, id, (o) => (o.kind === "site" && o[axis] !== value ? { ...o, [axis]: value } : o)), true)
}

export function setResultOpacity(id: string, opacity: number): void {
  commit(
    "Layer Opacity",
    (d) => mapItem(d, id, (o) => (o.kind === "terrain" && o.opacity !== opacity ? { ...o, opacity } : o)),
    true
  )
}

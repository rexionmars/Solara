import type { FeatureCollection } from "geojson"
import type { Polygon } from "./project"

/**
 * Brazil's administrative boundaries, as areas a product can be read over.
 *
 * WHY A CATALOGUE AND NOT A DRAWING. A drawn polygon is ground nobody
 * published: it crosses the boundary of whatever register answers the
 * question, at a size nothing checked, and the reading that comes back is
 * about the part the register happened to reach. The demand reading over a
 * hand-drawn area of central Ceará counted 73,993 units and covered 7.4 percent
 * of the ground it was asked about, and said only which register it had read.
 *
 * An administrative boundary carries what a drawing cannot: it is published, it
 * is the same shape for everyone, and it is the shape the official figures are
 * computed on -- so a reading over it can be set beside a published number.
 * IBGE's malhas service is the register those figures are drawn on, which is
 * why the geometry comes from there rather than from a general geocoder that
 * returns whatever its contributors have outlined.
 *
 * QUALITY IS `maxima`, WHICH IS WHERE THIS PARTS FROM TERRA. TERRA takes
 * `intermediaria` because the finest mesh is megabytes against its 10 m
 * rasters. Measured here it is not: Natal comes back with 14 vertices at
 * minima, 34 at intermediaria and 150 at maxima, and the whole of Ceara at
 * maxima is 24 kB. A 34-vertex outline of a city misplaces its edge by about a
 * kilometre, which is the cell of the demand layer, so the coarser mesh would
 * be deciding which cells are inside the city. The finest costs nothing at
 * this scale and is the boundary the published figures are drawn on.
 *
 * MUNICIPALITIES ARE THE FLOOR. The service refuses to subdivide a
 * municipality, so a neighbourhood waits for a source of its own rather than
 * being approximated from one that does not have it.
 */

const LOCALIDADES = "https://servicodados.ibge.gov.br/api/v1/localidades"
const MALHAS = "https://servicodados.ibge.gov.br/api/v3/malhas"
const GEOJSON = "application/vnd.geo+json"

export type PlaceLevel = "estados" | "municipios"

/** One entry of the catalogue: what to show, and what to ask the mesh for. */
export type Boundary = {
  /** IBGE's own code, which is what the malhas service is keyed on. */
  id: number
  name: string
  level: PlaceLevel
  /** The state a municipality is in; the state's own initials for a state. */
  uf: string
}

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`IBGE answered ${res.status}`)
  return (await res.json()) as T
}

/*
  The whole catalogue, held for the session as the PROMISE rather than the
  value: two cards mounting together make one request between them rather than
  two that race. It is 27 states and 5,570 municipalities, which is one request
  each and about a megabyte -- small enough to search locally, and searching
  locally is what lets the field answer while it is typed.
*/
let catalogueOnce: Promise<Boundary[]> | null = null

export function catalogue(): Promise<Boundary[]> {
  catalogueOnce ??= Promise.all([
    read<{ id: number; sigla: string; nome: string }[]>(`${LOCALIDADES}/estados?orderBy=nome`),
    read<{ id: number; nome: string; microrregiao?: { mesorregiao?: { UF?: { sigla?: string } } } }[]>(
      `${LOCALIDADES}/municipios?orderBy=nome`
    ),
  ])
    .then(([states, towns]) => [
      ...states.map((s): Boundary => ({ id: s.id, name: s.nome, level: "estados", uf: s.sigla })),
      ...towns.map((t): Boundary => ({
        id: t.id,
        name: t.nome,
        level: "municipios",
        uf: t.microrregiao?.mesorregiao?.UF?.sigla ?? "",
      })),
    ])
    .catch((e) => {
      // Not held: a failed catalogue must be asked for again rather than
      // remembered as empty for the rest of the session.
      catalogueOnce = null
      throw e
    })
  return catalogueOnce
}

/** Accents off and case folded, so "Sao Goncalo" finds "São Gonçalo". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()

/**
 * The entries a typed query names, states before municipalities and a whole
 * word before a word it is only inside of.
 */
export function search(all: Boundary[], query: string, limit = 12): Boundary[] {
  const q = fold(query)
  if (q.length < 2) return []
  const scored: { place: Boundary; rank: number }[] = []
  for (const place of all) {
    const name = fold(place.name)
    const at = name.indexOf(q)
    if (at < 0 && fold(place.uf) !== q) continue
    const rank =
      (place.level === "estados" ? 0 : 2) + (at === 0 || fold(place.uf) === q ? 0 : 1) + name.length / 1000
    scored.push({ place, rank })
  }
  scored.sort((a, b) => a.rank - b.rank)
  return scored.slice(0, limit).map((s) => s.place)
}

/**
 * The outline of one entry, as a single polygon.
 *
 * A municipality with islands comes back as a MultiPolygon, and the products
 * here take one ring: the largest part is kept and the reading says the area
 * it was read over, so the ground that was left out is the ground the figure
 * is not about. Keeping every part would need the whole chain -- clip, grid,
 * within -- to carry holes and islands, which is a change to make when a
 * reading needs it rather than in passing here.
 */
export async function outline(place: Boundary, signal?: AbortSignal): Promise<{ polygon: Polygon; parts: number }> {
  const fc = await read<{ features?: { geometry?: { type: string; coordinates: unknown } }[] }>(
    `${MALHAS}/${place.level}/${place.id}?formato=${encodeURIComponent(GEOJSON)}&qualidade=maxima`,
    signal
  )
  const geom = fc.features?.[0]?.geometry
  if (!geom) throw new Error(`IBGE holds no outline for ${place.name}`)

  if (geom.type === "Polygon") {
    return { polygon: { type: "Polygon", coordinates: geom.coordinates as number[][][] }, parts: 1 }
  }
  if (geom.type === "MultiPolygon") {
    const parts = geom.coordinates as number[][][][]
    let best = parts[0]
    let bestArea = -1
    for (const part of parts) {
      const a = Math.abs(ringArea(part[0]))
      if (a > bestArea) {
        bestArea = a
        best = part
      }
    }
    return { polygon: { type: "Polygon", coordinates: best }, parts: parts.length }
  }
  throw new Error(`IBGE returned a ${geom.type} for ${place.name}`)
}

/** Twice the signed area of a ring, in square degrees: enough to rank parts. */
function ringArea(ring: number[][]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  }
  return sum
}


/**
 * Every municipality of one state, as one mesh.
 *
 * The service answers a state's subdivisions in a single request -- 167
 * features and 368 kB for Rio Grande do Norte -- which is what makes a
 * choropleth of consumption possible without 5,570 requests. Each feature
 * carries `codarea`, IBGE's municipality code, which is the code the BDGD
 * writes on every consumer unit: the shape joins the figure without a name
 * match.
 */
export async function stateMesh(uf: string, signal?: AbortSignal): Promise<FeatureCollection> {
  return read<FeatureCollection>(
    `${MALHAS}/estados/${uf}?formato=${encodeURIComponent(GEOJSON)}&qualidade=maxima&intrarregiao=municipio`,
    signal
  )
}

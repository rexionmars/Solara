import type { FeatureCollection } from "geojson"
import { StoreBoundary, StoreBoundaryList, WorldBoundary, WorldCountries, WorldLevels, WorldPlaces } from "../../wailsjs/go/main/App"
import type { Polygon } from "./project"

/**
 * Administrative boundaries, as areas a product can be read over: Brazil's
 * from IBGE, or any country's from a store prepared to the contract, which
 * carries its own (solara.boundary).
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

/** One entry of the catalogue: what to show, and what to ask the source for its outline. */
export type Boundary = {
  /** IBGE's own code, which the malhas service is keyed on; or the store's id for the boundary. */
  id: number | string
  name: string
  /** "estados" or "municipios" from IBGE; the level's number, as text, from a store. */
  level: string
  /** What is written beside the name: the state's initials from IBGE, the parent's name from a store. */
  uf: string
  /** What a boundary one level down names as its `group`. */
  key: string
  /** The `key` of the boundary this one is inside, or "" at the top level. */
  group: string
  source: "ibge" | "store" | "world"
  /** The country a boundary of the world catalogue belongs to, as ISO 3166-1 alpha-3. */
  iso?: string
}

/** Which catalogue to read: IBGE's, the world's, or the boundaries of the store connected at this address. */
export type CatalogueFrom = "ibge" | "world" | { store: string }

/** A level of a catalogue, in the order they nest: the first is the widest ground. */
export type CatalogueLevel = { id: string; label: string; plural: string }

/** Everything a catalogue card needs: where it reads, its levels, and every entry of them. */
export type Catalogue = {
  source: "ibge" | "store" | "world"
  label: string
  levels: CatalogueLevel[]
  places: Boundary[]
  /**
   * For a catalogue too large to list whole: the levels and the boundaries
   * under one top-level entry, read when that entry is chosen. The world has
   * 230 countries and no reason to read the subdivisions of any but the one
   * being looked at.
   */
  expand?: {
    levels(top: Boundary): Promise<CatalogueLevel[]>
    places(top: Boundary, level: string): Promise<Boundary[]>
  }
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
      ...states.map((s): Boundary => ({ id: s.id, name: s.nome, level: "estados", uf: s.sigla, key: s.sigla, group: "", source: "ibge" })),
      ...towns.map((t): Boundary => {
        const uf = t.microrregiao?.mesorregiao?.UF?.sigla ?? ""
        return { id: t.id, name: t.nome, level: "municipios", uf, key: String(t.id), group: uf, source: "ibge" }
      }),
    ])
    .catch((e) => {
      // Not held: a failed catalogue must be asked for again rather than
      // remembered as empty for the rest of the session.
      catalogueOnce = null
      throw e
    })
  return catalogueOnce
}

const IBGE_LEVELS: CatalogueLevel[] = [
  { id: "estados", label: "State", plural: "states" },
  { id: "municipios", label: "Municipality", plural: "municipalities" },
]

/*
  The catalogue of a store prepared to the contract, kept per store: another
  store connected is another list, and the one before it must not answer for it.
*/
let storeOnce: { key: string; list: Promise<Catalogue> } | null = null

/** A level's name as the word a search field uses: "Province" to "provinces". */
const plural = (name: string) => {
  const n = name.toLowerCase()
  return n.endsWith("y") ? `${n.slice(0, -1)}ies` : `${n}s`
}

function storeCatalogue(key: string): Promise<Catalogue> {
  if (storeOnce?.key === key) return storeOnce.list
  const list = StoreBoundaryList()
    .then(
      (held): Catalogue => ({
        source: "store",
        label: "Store",
        levels: held.levels.map((l) => ({ id: String(l.level), label: l.name, plural: plural(l.name) })),
        places: held.places.map((p) => ({
          id: p.id,
          name: p.name,
          level: String(p.level),
          uf: p.parent_name ?? "",
          key: p.id,
          group: p.parent_id ?? "",
          source: "store",
        })),
      })
    )
    .catch((e) => {
      storeOnce = null
      throw e
    })
  storeOnce = { key, list }
  return list
}

/*
  The world's catalogue: the countries at once, and a country's levels and
  boundaries when it is chosen. Held as promises for the session, like IBGE's;
  the sidecar keeps the files themselves on disk between sessions.
*/
let worldOnce: Promise<Catalogue> | null = null
const worldLevels = new Map<string, Promise<CatalogueLevel[]>>()
const worldPlaces = new Map<string, Promise<Boundary[]>>()

function forgetOnFailure<K, V>(held: Map<K, Promise<V>>, key: K, made: Promise<V>): Promise<V> {
  held.set(key, made)
  made.catch(() => held.delete(key))
  return made
}

function worldCatalogue(): Promise<Catalogue> {
  worldOnce ??= WorldCountries()
    .then(
      (held): Catalogue => ({
        source: "world",
        label: "World",
        levels: [{ id: "country", label: "Country", plural: "countries" }],
        places: held.countries.map((c) => ({
          id: c.iso3,
          name: c.name,
          level: "country",
          uf: c.iso3,
          key: c.iso3,
          group: "",
          source: "world",
          iso: c.iso3,
        })),
        expand: {
          levels: (top) =>
            worldLevels.get(top.key) ??
            forgetOnFailure(
              worldLevels,
              top.key,
              WorldLevels(top.key).then((levels) =>
                levels.map((l) => {
                  // The source names a level only sometimes; otherwise it is its number.
                  const label = l.level === 0 ? "Whole country" : l.name || `Level ${l.level}`
                  return { id: String(l.level), label, plural: l.level === 0 ? "the country" : plural(label) }
                })
              )
            ),
          places: (top, level) => {
            const key = `${top.key}/${level}`
            return (
              worldPlaces.get(key) ??
              forgetOnFailure(
                worldPlaces,
                key,
                WorldPlaces(top.key, Number(level)).then((places) =>
                  places.map((p) => ({
                    id: p.id,
                    // Sources write names in capitals as often as not; a list of them shouts.
                    name: p.name === p.name.toUpperCase() ? titled(p.name) : p.name,
                    level,
                    uf: top.key,
                    key: p.id,
                    group: top.key,
                    source: "world" as const,
                    iso: top.key,
                  }))
                )
              )
            )
          },
        },
      })
    )
    .catch((e) => {
      worldOnce = null
      throw e
    })
  return worldOnce
}

const titled = (s: string) => s.toLowerCase().replace(/(^|[\s\-'(])\p{L}/gu, (m) => m.toUpperCase())

/**
 * The catalogue a card reads: the store's own boundaries when the connected
 * store carries them, IBGE's for Brazil, the world's otherwise.
 *
 * Which of the three is the grid module's to decide (catalogueSource), and is
 * passed in rather than read here because that module already reads this one.
 */
export function catalogueOf(from: CatalogueFrom): Promise<Catalogue> {
  if (from === "world") return worldCatalogue()
  if (from !== "ibge") return storeCatalogue(from.store)
  return catalogue().then((places) => ({ source: "ibge", label: "IBGE", levels: IBGE_LEVELS, places }))
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
  let geom: { type: string; coordinates: unknown } | undefined
  if (place.source === "store") {
    geom = (await StoreBoundary(String(place.id))).geometry
  } else if (place.source === "world") {
    // A country is its own level 0, whose one boundary is the country.
    const whole = place.level === "country"
    const level = whole ? 0 : Number(place.level)
    const id = whole ? (await WorldPlaces(place.iso ?? "", 0))[0]?.id : String(place.id)
    geom = id === undefined ? undefined : (await WorldBoundary(place.iso ?? "", level, id)).geometry
  } else {
    const fc = await read<{ features?: { geometry?: { type: string; coordinates: unknown } }[] }>(
      `${MALHAS}/${place.level}/${place.id}?formato=${encodeURIComponent(GEOJSON)}&qualidade=maxima`,
      signal
    )
    geom = fc.features?.[0]?.geometry
  }
  const from = place.source === "store" ? "The store" : place.source === "world" ? "geoBoundaries" : "IBGE"
  if (!geom) throw new Error(`${from} holds no outline for ${place.name}`)

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
  throw new Error(`${from} returned a ${geom.type} for ${place.name}`)
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

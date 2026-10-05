import { createStore } from "./store"

/**
 * The wires of the run graph that are the reader's to make and cut, kept in
 * this browser.
 *
 * A wire here is "from>to" between two cards. Two kinds are the reader's: a
 * catalogue's, which decides where a boundary goes, and the grid store's,
 * which decides what reads the store -- the Map's layers, and the Run of a
 * product that takes one. Every other wire is the shape of a request and is
 * not here: a run reads its record whether or not a line is drawn.
 *
 * A STORE'S WIRE DOES WHAT IT SHOWS. Cut from the Map, the store's layers are
 * not drawn; cut from the Run, a product that reads the store is not run. A
 * wire that could be cut and changed nothing would be a drawing of a choice
 * rather than a choice.
 *
 * Held here, and not in the editor that draws them, because the map and the
 * run have to read them too.
 */

const STORE_LINKS = ["store>run", "store>mapdraw"]
const DEFAULT_LINKS = ["catalogue>area", "catalogue2>region", ...STORE_LINKS]

// v2 since the store's wires joined the catalogue's: a list kept before then
// knows nothing of them, and read as it stands would cut both.
const KEY = "terra-energy.graph.links.v2"
const KEY_BEFORE = "terra-energy.graph.links"

function read(): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "null")
    if (Array.isArray(kept)) return kept
    const before = JSON.parse(localStorage.getItem(KEY_BEFORE) ?? "null")
    if (Array.isArray(before)) return [...before, ...STORE_LINKS]
  } catch {
    // An unreadable list is no list; the wires are as a board first draws them.
  }
  return DEFAULT_LINKS
}

export const graphLinks = createStore<string[]>(read())

export function setGraphLink(link: string, on: boolean): void {
  graphLinks.set((prev) => {
    const next = on ? (prev.includes(link) ? prev : [...prev, link]) : prev.filter((l) => l !== link)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* a convenience: the wires are as the board first drew them next time */
    }
    return next
  })
}

/** Whether the grid store's card is wired to the Run card, or to the Map's. */
export const storeFeeds = (to: "run" | "mapdraw", links: readonly string[] = graphLinks.get()): boolean => links.includes(`store>${to}`)

// ---- The request's own wires, which the reader may cut ---------------------------------

/*
  EVERY WIRE CAN BE CUT, AND EACH CUT MEANS SOMETHING. A board whose wires
  could not be touched read as a picture of a graph and not as one: the reader
  pulled at a wire, nothing happened, and nothing said why. So the wires that
  are the shape of a request are the reader's too, with a consequence each:

    a setting's wire (Record, Array, Reach, ...)  cut, the run does not take
        that card's value and the engine applies its own default;
    the ground's or the product's wire             cut, there is nothing to run
        and the Run card says which wire is missing;
    the Region's or the Layer's wire to the Map    cut, the layer is drawn over
        every ground the register reaches, unscoped.

  Kept as CUTS and not as links, because wired is how a board starts: an empty
  list is every wire in place, on every product, including one added later.
*/

/** The product a run wire belongs to, or "map" for the map band's. */
export type WireScope = "solar" | "wind" | "terrain" | "connection" | "demand" | "ground" | "map"

const CUTS_KEY = "terra-energy.graph.cuts.v1"

function readCuts(): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(CUTS_KEY) ?? "[]")
    return Array.isArray(kept) ? kept : []
  } catch {
    return []
  }
}

export const graphCuts = createStore<string[]>(readCuts())

const cutKey = (from: string, to: string, scope: WireScope) => `${from}>${to}@${scope}`

export const isCut = (from: string, to: string, scope: WireScope, cuts: readonly string[] = graphCuts.get()): boolean =>
  cuts.includes(cutKey(from, to, scope))

export function setCut(from: string, to: string, scope: WireScope, cut: boolean): void {
  const key = cutKey(from, to, scope)
  graphCuts.set((prev) => {
    const next = cut ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key)
    try {
      localStorage.setItem(CUTS_KEY, JSON.stringify(next))
    } catch {
      /* a convenience: every wire is back in place next time */
    }
    return next
  })
}

/** The settings each card carries to the run, per product: what a cut wire withholds. */
const CARD_FIELDS: Record<Exclude<WireScope, "map">, Record<string, readonly string[]>> = {
  solar: { record: ["hourlyYears"], radiation: ["climatologyYears"], array: ["surfaceAzimuth"], performance: ["performanceRatio"] },
  wind: { record: ["recordYears", "recordMaxFloorMS"], turbine: ["hubHeightM", "calmThresholdMS"], roughness: ["roughnessLowM", "roughnessHighM"] },
  terrain: { record: ["hourlyYears"], season: ["season"] },
  connection: { reach: ["searchRadiusKm"] },
  demand: { ceiling: ["yieldCeilingKWhKWp"], cell: ["cellKm"] },
  ground: { slope: ["slopeMaxDeg"], flood: ["handMinM"] },
}

/**
 * A product's settings as the run takes them: without the fields of any card
 * whose wire to Run is cut, so the engine applies its default for those.
 */
export function wiredSettings<T extends object>(product: Exclude<WireScope, "map">, settings: T): T {
  const out = { ...settings } as Record<string, unknown>
  for (const [card, fields] of Object.entries(CARD_FIELDS[product])) {
    if (isCut(card, "run", product)) for (const f of fields) delete out[f]
  }
  return out as T
}

/** Why a product cannot be run for a wire that is cut, or null when its ground and product are wired. */
export function wiresBlock(product: Exclude<WireScope, "map">): string | null {
  const ground = product === "solar" || product === "wind" ? "site" : "area"
  if (isCut(ground, "run", product)) return `The ${ground === "site" ? "Site" : "Area"} card is not wired to Run: pull its socket onto the Run card`
  if (isCut("product", "run", product)) return "The Product card is not wired to Run: pull its socket onto the Run card"
  return null
}

/** Whether the Map still takes the Region's scope: both its Region and its Layer wire in place. */
export const mapScoped = (): boolean => !isCut("region", "mapdraw", "map") && !isCut("layer", "mapdraw", "map")

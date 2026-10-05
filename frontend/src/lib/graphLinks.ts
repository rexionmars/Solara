import { createStore } from "./store"

/**
 * The wires of the run graph that are the reader's to make and cut, kept in
 * this browser.
 *
 * A wire here is "from>to" between two cards. Two kinds are the reader's: a
 * catalogue's, which decides where a boundary goes, and the grid store's to
 * the Map, which decides whether the store's layers are drawn.
 *
 * A WIRE THAT ENDS AT RUN IS NOT THE READER'S TO CUT. A run is started from
 * Properties and reads every input listed there; the graph draws that and
 * decides none of it. While a cut here could block a run or withhold a
 * setting, a run started in Properties failed for a reason on another screen.
 * So the store's wire to Run is always in place, and no cut of a wire into
 * Run is kept.
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
    // A list kept while the store's wire to Run could be cut may lack it.
    if (Array.isArray(kept)) return kept.includes("store>run") ? kept : [...kept, "store>run"]
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

/** Whether the grid store's card is wired to the Map's. */
export const storeFeeds = (to: "mapdraw", links: readonly string[] = graphLinks.get()): boolean => links.includes(`store>${to}`)

// ---- The map band's wires, which the reader may cut ------------------------------------

/*
  A CUT MEANS SOMETHING OR IS NOT OFFERED. The Region's or the Layer's wire to
  the Map, cut, draws the layer over every ground the register reaches,
  unscoped. A wire into Run cannot be cut (see the head of this file), and the
  board says so when the reader pulls at one.

  Kept as CUTS and not as links, because wired is how a board starts: an empty
  list is every wire in place, on every product, including one added later.
*/

/** The product a run wire belongs to, or "map" for the map band's. */
export type WireScope = "solar" | "wind" | "terrain" | "connection" | "demand" | "ground" | "map"

const CUTS_KEY = "terra-energy.graph.cuts.v1"

function readCuts(): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(CUTS_KEY) ?? "[]")
    // Cuts of a wire into Run, kept from when those blocked a run, are dropped.
    return Array.isArray(kept) ? kept.filter((k) => typeof k === "string" && !k.includes(">run@")) : []
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

/** Whether the Map still takes the Region's scope: both its Region and its Layer wire in place. */
export const mapScoped = (): boolean => !isCut("region", "mapdraw", "map") && !isCut("layer", "mapdraw", "map")

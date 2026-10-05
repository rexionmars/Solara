import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowsClockwise, ChartBar, CheckSquare, CircleNotch, CodeSimple, Eye, Fan, FlowArrow, Mountains, Play, PlugsConnected, Stop, Sun, Warning, type Icon } from "../../lib/icons"
import { lastFailure, running } from "../../lib/analysis"
import { errorMessage } from "../../lib/errors"
import { frameItem, framePolygon } from "../../lib/mapEngine"
import { addArea } from "../../lib/objects"
import { availableLayers, productBlocked, productOffered } from "../../lib/capabilities"
import { graphCuts, graphLinks, isCut, setCut, setGraphLink, type WireScope } from "../../lib/graphLinks"
import { catalogueOf, outline, search, type Boundary, type Catalogue, type CatalogueLevel } from "../../lib/places"
import { note, reports } from "../../lib/reports"
import { defaults } from "../../lib/defaults"
import { formatLat, formatLng } from "../../lib/format"
import { polygonAreaKm2 } from "../../lib/geo"
import { RUN_OPERATOR, runOperator, useOperator } from "../../lib/operators"
import {
  FALLBACK_SEASONS,
  CONNECTION_FIELDS, DEMAND_FIELDS, GROUND_FIELDS,
  SOLAR_FIELDS,
  TERRAIN_FIELDS,
  WIND_FIELDS,
  fieldError,
  seasonLabel,
  setParam,
  windSettingsError,
  type Group,
  type NumberField as FieldDef,
} from "../../lib/params"
import { catalogueSource, checkGridStore, concessions, dsnSourceLabel, gridStore, loadReach, reachByArea, reachSaid, storeReachable, storeReport, townDemand } from "../../lib/grid"
import { PRODUCT_NAMES, PRODUCT_SUMMARY, isAreaProduct, project, type Polygon, type Product } from "../../lib/project"
import {
  defaultPlaces,
  inputState,
  runComparison,
  runGraph,
  isMapNode,
  type Place,
  type RunNodeId,
} from "../../lib/runGraph"
import { MAP_LAYERS, REGION_AWARE, clipFeatures, layerMeta, mapGraph, resolveRegion, setMapGraph, type MapLayerKey } from "../../lib/mapGraph"
import { overlays } from "../../lib/tools"
import { STATE_COLOUR, STATE_NOTE, reading, subject, supplied, type RunValue } from "../../lib/runValue"
import { areaStates, setAreaState, showResult } from "../../lib/screen"
import { activeArea, activeSite, select, selection } from "../../lib/selection"
import { useStore } from "../../lib/store"
import { NodeCanvas, type CanvasApi, type CanvasBoard, type CanvasEdge, type CanvasNode, type CanvasSection, type CanvasTab, type EdgeState } from "../studio/NodeCanvas"
import { StudioHeaderMenu } from "../studio/HeaderControls"
import { AreaHeader } from "../studio/StudioArea"
import { fieldInput } from "../ui/buttons"
import { btnGhostDense, btnIcon } from "../ui/buttons"
import { StoreConnectionForm, StoreHoldings } from "../energy/StoreConnection"
import { NumberField, Select } from "../ui/Fields"
import { ConsoleBody } from "./ConsoleBody"

/**
 * The run graph, as TERRA's board: one product's request laid out as cards,
 * each card one part of it, wired into the card that runs it.
 *
 * THE CARDS ARE THE SETTINGS, not a picture of them. A field on a card is the
 * project's setting, the same one Properties edits, so the graph is a second
 * way in rather than a second copy.
 *
 * THE WIRES ARE THE ANSWER'S PROVENANCE. Each says whether the reading on
 * screen read what its card holds now; see NodeCanvas for the five states.
 */

const PRODUCT_ICON: Record<Product, Icon> = { solar: Sun, terrain: Mountains, wind: Fan, connection: PlugsConnected, demand: ChartBar, ground: CheckSquare }
/*
  Every product the graph can lay out, which is every product: INPUTS in
  runGraph.ts names the cards of each one, and a product missing from HERE is
  a product whose request cannot be set up at all -- the Product select, the
  View menu and the fallback on line 298 all read this list.
*/
const PRODUCTS: Product[] = ["solar", "terrain", "wind", "connection", "demand", "ground"]

const OPERATOR = RUN_OPERATOR

const EDGE_NOTE = STATE_NOTE
const NOTE_COLOUR = STATE_COLOUR

/*
  A node's header says which part of a request it is, and its socket what
  kind of value it sends, as Blender colours a node by its category and a
  socket by its type. Both are declared in index.css, under the node editor.
*/
const kindOf = (v: RunValue) => subject(v) ?? "value"
const headOf = (v: RunValue) => `var(--node-head-${kindOf(v)})`
const socketOf = (v: RunValue) => `var(--node-socket-${kindOf(v)})`

// ---- Card positions, kept per product in this browser ----------------------------

// v2: the inputs became one column; positions kept from the two-column board would scatter them.
const PLACES_KEY = "terra-energy.graph.places.v2"

function readPlaces(): Partial<Record<Product, Record<string, Place>>> {
  try {
    return JSON.parse(localStorage.getItem(PLACES_KEY) ?? "{}") ?? {}
  } catch {
    return {}
  }
}

function useKeptPlaces(product: Product) {
  const [all, setAll] = useState(readPlaces)
  const write = (next: Partial<Record<Product, Record<string, Place>>>) => {
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify(next))
    } catch {
      /* a convenience: the cards fall back to their columns */
    }
    return next
  }
  const move = useCallback(
    (id: string, place: Place) => setAll((prev) => write({ ...prev, [product]: { ...prev[product], [id]: place } })),
    [product]
  )
  const reset = () => setAll((prev) => write({ ...prev, [product]: {} }))
  return [all[product] ?? {}, move, reset] as const
}

// ---- Cards taken off the board, kept per product in this browser -----------------

const REMOVED_KEY = "terra-energy.graph.removed"
/** The map's cards are on every board, so what is taken off that band is taken off all of them. */
type RemovedKey = Product | "map"

function readRemoved(): Partial<Record<RemovedKey, string[]>> {
  try {
    return JSON.parse(localStorage.getItem(REMOVED_KEY) ?? "{}") ?? {}
  } catch {
    return {}
  }
}

/**
 * Which cards are off the board.
 *
 * TAKING A CARD OFF CHANGES NO SETTING. The project holds the setting, and
 * Properties edits the same one, so a card is a way in and removing it closes
 * that way and nothing else: the run still reads the input, and the Run card
 * says with what on the row the wire used to land on.
 */
function useRemoved(product: Product) {
  const [all, setAll] = useState(readRemoved)
  const set = (ids: readonly string[], keyOf: (id: string) => RemovedKey, off: boolean) =>
    setAll((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        const key = keyOf(id)
        const rest = (next[key] ?? []).filter((x) => x !== id)
        next[key] = off ? [...rest, id] : rest
      }
      try {
        localStorage.setItem(REMOVED_KEY, JSON.stringify(next))
      } catch {
        /* a convenience: the cards are all back next time */
      }
      return next
    })
  return [new Set([...(all[product] ?? []), ...(all.map ?? [])]), set] as const
}

// ---- The wires the reader makes, kept in this browser ----------------------------

/*
  A CATALOGUE'S WIRE IS THE READER'S, and the only kind that is. Every other
  wire is the shape of a request -- a run reads its record whether or not a
  line is drawn -- so cutting one would draw a freedom that does not exist. A
  catalogue supplies ground to whichever card its wire lands on, and that IS a
  choice: onto Area the boundary becomes an area of the project, onto Region it
  scopes the map's layer and leaves nothing behind. Cut, the card supplies
  nothing and says so.
*/
const SOURCES: readonly string[] = ["catalogue", "catalogue2"]
const GROUNDS: readonly string[] = ["area", "region"]
/** The cards whose wires are the reader's: the catalogues, and the grid store (graphLinks.ts). */
const LINKED: readonly string[] = [...SOURCES, "store"]

// ---- Card parts --------------------------------------------------------------------

const FIELDS: Record<Group, FieldDef<string>[]> = {
  solar: SOLAR_FIELDS,
  wind: WIND_FIELDS,
  terrain: TERRAIN_FIELDS,
  connection: CONNECTION_FIELDS,
  demand: DEMAND_FIELDS,
  ground: GROUND_FIELDS,
}

/** A project setting, in a card: the drag field Properties uses, with its name inside it. */
/**
 * The boundary catalogue: a state or a municipality, taken from what IBGE
 * publishes, made the area a run is read over.
 *
 * THIS IS THE ONLY SOURCE OF AN AREA, since the drawing tool was removed. A
 * hand-drawn polygon is ground nobody published: it crosses whatever boundary
 * the register answering the question ends at, and the reading comes back
 * about the part that register happened to reach -- over an area of central
 * Ceara the demand register covered 7.4 percent of it and said only which
 * register it had read.
 *
 * A STATE IS BOTH A CHOICE AND A FILTER, which is why there are two tabs and
 * not three controls. Choosing a municipality without naming a state first is
 * a list of 5,570; the state row narrows that list and is itself what is taken
 * when the tab is State. Carried over from TERRA's CatalogueCard, which says
 * the same.
 */
/**
 * `to` is where the card's wires land, and so what taking a boundary DOES.
 *
 * Onto Area the boundary is added to the project, which is right for a run: a
 * product is run over an area and the project has to own it. Onto Region it is
 * handed to `onRegion`, which scopes a layer and leaves nothing behind. Wired
 * to neither, the card has nowhere to send a boundary and takes none.
 */
function CatalogueCard({
  to,
  onRegion,
}: {
  to: readonly string[]
  onRegion: (picked: { name: string; polygon: Polygon }) => void
}) {
  // The store's own boundaries when it carries them, IBGE's for Brazil, the
  // world's otherwise; asked again when another store is connected.
  const from = catalogueSource(useStore(gridStore))
  const fromKey = typeof from === "string" ? from : `store:${from.store}`
  const [cat, setCat] = useState<Catalogue | null>(null)
  const [level, setLevel] = useState<string | null>(null)
  const [state, setState] = useState<Boundary | null>(null)
  // Under a catalogue that is read a country at a time: the chosen country's
  // levels, and each level's boundaries once it has been asked for.
  const [sub, setSub] = useState<{ levels: CatalogueLevel[]; places: Record<string, Boundary[]> } | null>(null)
  const [query, setQuery] = useState("")
  const [taking, setTaking] = useState<number | string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setCat(null)
    setState(null)
    setSub(null)
    setLevel(null)
    setFailed(null)
    catalogueOf(from).then(
      (c) => live && setCat(c),
      (e) => live && setFailed(errorMessage(e))
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKey])

  const lazy = cat?.expand
  const levels = [...(cat?.levels ?? []), ...(lazy && sub ? sub.levels : [])]
  const at = level ?? levels[0]?.id ?? ""
  const top = cat?.levels[0]?.id
  // A level under a chosen country is read the first time its tab is opened.
  const wanted = lazy && state && at !== top && sub && !sub.places[at] ? at : null
  useEffect(() => {
    if (!wanted || !lazy || !state) return
    let live = true
    lazy.places(state, wanted).then(
      (places) => live && setSub((cur) => (cur ? { ...cur, places: { ...cur.places, [wanted]: places } } : cur)),
      (e) => live && setFailed(errorMessage(e))
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, state?.key])

  const all = cat?.places ?? null
  // The boundary chosen one level up narrows this level's list; chosen any
  // further up, or not at all, the whole level is listed.
  const above = levels[levels.findIndex((l) => l.id === at) - 1]?.id
  const rows =
    lazy && at !== top
      ? (sub?.places[at] ?? null)
      : !all
        ? null
        : all.filter((p) => p.level === at && (!state || state.level !== above || p.group === state.key))
  const plural = levels.find((l) => l.id === at)?.plural ?? "boundaries"

  const shown = !rows ? null : query.trim() ? search(rows, query, 40) : rows

  /** Choose a country of a catalogue read a country at a time: its levels become the tabs. */
  const open = async (place: Boundary) => {
    if (!lazy) return
    setTaking(place.id)
    setFailed(null)
    try {
      const found = await lazy.levels(place)
      setState(place)
      setSub({ levels: found, places: {} })
      setQuery("")
      // Its first subdivision where it has one, which is what a reader came for.
      setLevel((found.find((l) => l.id !== "0") ?? found[0])?.id ?? null)
    } catch (e) {
      setFailed(errorMessage(e))
    } finally {
      setTaking(null)
    }
  }

  const take = async (place: Boundary) => {
    setTaking(place.id)
    setFailed(null)
    try {
      const { polygon, parts } = await outline(place)
      const name = place.uf && place.level !== levels[0]?.id ? `${place.name} (${place.uf})` : place.name
      if (parts > 1) {
        // One ring, so the islands and exclaves of this boundary are not in
        // it. Said here rather than left for the reading to be quietly short.
        note(`${place.name} is published in ${parts} parts; the largest is the ground taken, the rest are not in it.`)
      }
      // Under a country-at-a-time catalogue the country stays the one chosen.
      if (!lazy && place.level !== levels[levels.length - 1]?.id) setState(place)
      if (to.includes("region")) {
        onRegion({ name, polygon })
        framePolygon(polygon)
      }
      if (to.includes("area")) {
        const id = addArea(polygon, name)
        frameItem({ kind: "area", id, name: place.name, polygon, hidden: false })
      }
    } catch (e) {
      setFailed(errorMessage(e))
    } finally {
      setTaking(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex gap-1">
        {levels.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setLevel(id)
              setQuery("")
            }}
            className={`h-5 rounded-[3px] px-1.5 text-micro ${
              at === id ? "bg-selected text-foreground" : "text-muted-foreground hover:bg-hover"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        className={`${fieldInput} !h-6 !text-meta`}
        placeholder={
          !all || !rows
            ? "Reading the catalogue…"
            : state && (lazy ? at !== top : state.level === above)
              ? `Search in ${lazy ? state.name : state.uf || state.name}`
              : `Search ${plural}`
        }
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={!all}
      />

      {/* A fixed window on the list: a card as tall as a country's provinces pushes the rest of the board off the screen. */}
      <div className="panel-scroll max-h-[220px] min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {shown?.map((p) => (
          <button
            key={`${p.level}-${p.id}`}
            type="button"
            disabled={taking !== null || (!to.length && !(lazy && p.level === top))}
            onClick={() => void (lazy && p.level === top ? open(p) : take(p))}
            className="flex w-full items-baseline justify-between gap-2 rounded-[3px] px-1 py-0.5 text-left hover:bg-hover disabled:opacity-40"
          >
            <span className="truncate text-meta text-foreground">{p.name}</span>
            <span className="shrink-0 telemetry text-micro text-muted-foreground">
              {taking === p.id ? "reading…" : p.uf}
            </span>
          </button>
        ))}
        {shown && !shown.length ? (
          <p className="px-1 py-0.5 text-micro text-muted-foreground">Nothing by that name.</p>
        ) : null}
      </div>

      {failed ? <p className="text-micro text-destructive-quiet">{failed}</p> : null}
      {!to.length ? <Muted>Not wired. Pull this card's socket onto Area or Region to send a boundary there.</Muted> : null}
    </div>
  )
}

function Param({ group, field, label }: { group: Group; field: string; label: string }) {
  const values = useStore(project).data.settings[group] as Record<string, number | undefined>
  const d = useStore(defaults)
  const f = FIELDS[group].find((x) => x.key === field)
  if (!f) return null
  return (
    <div className="flex" title={f.description}>
      <NumberField
        label={label}
        inlineLabel
        value={values[f.key]}
        fallback={d ? f.defaultOf(d) : undefined}
        step={f.step ?? (f.integer ? 1 : 0.1)}
        decimals={f.integer ? 0 : undefined}
        unit={f.unit}
        validate={(v) => fieldError(f, v)}
        onChange={(v) => setParam(group, f.key, v)}
      />
    </div>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-micro leading-relaxed text-muted-foreground">{children}</p>
}

// ---- The editor ----------------------------------------------------------------------

export function RunGraphEditor({ areaId }: { areaId: string }) {
  const d = useStore(project).data
  useStore(selection)
  const engine = useStore(defaults)
  const run = useStore(running)
  const failure = useStore(lastFailure)
  const stored = useStore(areaStates)[areaId]?.product as Product | undefined
  const site = activeSite()
  const area = activeArea()
  // Only what the connected store could answer: a product it never could is
  // not on the list, and a stored choice of one falls back to what is.
  const storeNow = useStore(gridStore)
  const offered = PRODUCTS.filter((p) => productOffered(p, storeNow))
  const product: Product = stored && offered.includes(stored) ? stored : area ? "terrain" : "solar"
  const source = isAreaProduct(product) ? area : site
  const map = useStore(mapGraph)
  const shown = useStore(overlays)
  const reachLayer = useStore(concessions)
  const townLayer = useStore(townDemand)

  const regionArea = resolveRegion(map.region, d.areas)

  /*
    WHAT THE MAP REALLY DREW, counted through the same cut the map used.

    The card used to say "Drawn, clipped to Piaui" whichever ground was
    chosen. Piaui is served by neither register in the store, so the clip
    returned nothing and the card reported a drawing of it. A caption that
    cannot be wrong is the whole reason this counts instead of asserting.
  */
  const drawnNote = ((): string => {
    if (!shown[map.layer]) return "Not drawn. The layer is configured but the map is not showing it."
    if (!REGION_AWARE.includes(map.layer)) {
      return regionArea
        ? `Drawn everywhere. This layer does not read the region yet, so ${regionArea.name} is not applied to it.`
        : "Drawn wherever its register has data."
    }
    const state = map.layer === "gridConcessions" ? reachLayer : townLayer
    if (state.kind === "loading") return "Reading the register…"
    if (state.kind === "failed") return `The register did not answer: ${state.message}`
    if (state.kind !== "ready") return "Not read yet."
    const all = state.data.geojson
    const kept = clipFeatures(all, regionArea?.polygon ?? null).features.length
    const what = map.layer === "gridConcessions" ? "register" : "municipality"
    const plural = kept === 1 ? what : `${what.replace(/y$/, "ie")}s`
    if (!regionArea) return `Drawn everywhere: ${all.features.length} ${all.features.length === 1 ? what : `${what.replace(/y$/, "ie")}s`}.`
    if (kept === 0) {
      return `Nothing to draw. No ${what} in the store falls inside ${regionArea.name}, so the map shows the region and no data over it.`
    }
    return `Drawn: ${kept} of ${all.features.length} ${plural}, clipped to ${regionArea.name}.`
  })()
  const store = useStore(gridStore)
  const report = storeReport(store)
  const logged = useStore(reports)
  // The store is asked about once, when a board first needs its card.
  useEffect(() => {
    // The map band reads the grid store on every board, so it is always asked.
    if (gridStore.get().kind === "unknown") void checkGridStore()
  }, [product])
  const busy = !!run && run.product === product && run.sourceId === source?.id
  const { poll } = useOperator(OPERATOR[product])

  /*
    HOW MUCH OF THIS GROUND THE REGISTER COVERS, on the card that runs it.

    It is a fact about the Area and the Grid store together, and in a fan-in
    graph the two meet at the run card and nowhere else -- so it is said here
    rather than on either input, which would claim a wire that is not drawn.

    Only the consumption reading asks it. The other products read sources that
    cover the country, so a share of the ground would always be 100 and say
    nothing. Measured before the run, by the same function the reading
    reports, and consulted where the decision to press is taken.
  */
  const probe = useStore(reachByArea)[area?.id ?? ""]?.state
  useEffect(() => {
    if (product === "demand" && area) loadReach(area.id, area.polygon)
  }, [product, area?.id, area?.polygon])
  const coverage = product === "demand" && area ? reachSaid(area.name, probe) : null

  const [places, move, resetPlaces] = useKeptPlaces(product)
  const [gone, setRemoved] = useRemoved(product)
  const links = useStore(graphLinks)
  const setLink = setGraphLink
  // The request's own wires the reader has cut (graphLinks.ts): every wire is cuttable.
  const cuts = useStore(graphCuts)
  // The header's menus act on the board, which holds its own selection.
  const board = useRef<CanvasApi | null>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const onMeasure = useCallback((id: string, h: number) => {
    setHeights((prev) => (Math.abs((prev[id] ?? 0) - h) < 0.5 ? prev : { ...prev, [id]: h }))
  }, [])

  const graph = runGraph(product)
  const removedKey = (id: string): Product | "map" => (graph.nodes.find((n) => n.id === id)?.band ? "map" : product)
  const onBoard = (id: string) => graph.nodes.some((n) => n.id === id) && !gone.has(id)
  // The request's own wires, and the reader's in place of the catalogue's two.
  const made = links.map((l) => l.split(">") as [RunNodeId, RunNodeId])
  // Only the wires with a card at both ends: a card off the board sends nothing along one.
  // A store's wire is drawn only onto a card that reads the store on this board.
  const takesStore = (to: RunNodeId) => graph.edges.some(([f, t]) => f === "store" && t === to)
  const scopeOf = (to: RunNodeId): WireScope => (to === "mapdraw" || graph.nodes.find((n) => n.id === to)?.band ? "map" : product)
  const wired = [...graph.edges.filter(([from, to]) => !LINKED.includes(from) && !isCut(from, to, scopeOf(to), cuts)), ...made].filter(
    ([from, to]) => onBoard(from) && onBoard(to) && (from !== "store" || takesStore(to))
  )
  /** Where a catalogue's wires land, among the cards on this board. */
  const landsOn = (id: RunNodeId) => wired.filter(([from]) => from === id).map(([, to]) => to)
  const toRegion = (p: { name: string; polygon: Polygon }) => setMapGraph({ region: { kind: "place", name: p.name, polygon: p.polygon } })
  const fallback = defaultPlaces(graph, heights)
  // Connected is not enough: the wire is good only if this store can answer this product.
  const compared = runComparison(d, product, source, storeReachable(store) && !productBlocked(product, store), engine, failure, {
    // The map band is on every board, so its cards are in every table.
    region: regionArea ? { label: regionArea.name, at: JSON.stringify(regionArea.polygon.coordinates) } : null,
    mapLayer: layerMeta(map.layer).label,
  })
  const { values, last, lastValues } = compared
  // The catalogue cards say where they read: the store's own boundaries, or IBGE's.
  const reads = catalogueSource(store)
  const catalogueLabel = reads === "ibge" ? "IBGE" : reads === "world" ? "World" : "Store"
  values.catalogue = { kind: "choice", label: catalogueLabel }
  values.catalogue2 = { kind: "choice", label: catalogueLabel }
  const pct = run?.progress === null || !run ? null : Math.round(Math.max(0, Math.min(100, run.progress)))

  const sourcePicker = (kind: "site" | "area") => {
    const list = kind === "site" ? d.sites : d.areas
    const chosen = kind === "site" ? site : area
    return (
      <>
        {list.length ? (
          <Select
            value={chosen?.id ?? ""}
            ariaLabel={kind === "site" ? "Site" : "Area"}
            onChange={(id) => select(id || null)}
            options={[
              ...(chosen ? [] : [{ value: "", label: kind === "site" ? "Choose a site" : "Choose an area" }]),
              ...list.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        ) : (
          <Muted>{kind === "site" ? "No site in the project yet." : "No area in the project yet."}</Muted>
        )}
        {chosen?.kind === "site" && (
          <span className="telemetry text-micro text-muted-foreground">
            {formatLat(chosen.lat, 4)} {formatLng(chosen.lon, 4)}
          </span>
        )}
        {chosen?.kind === "area" && (
          <span className="telemetry text-micro text-muted-foreground">{polygonAreaKm2(chosen.polygon).toFixed(2)} km²</span>
        )}
        {kind === "site" ? (
          <button
            type="button"
            className={`${btnGhostDense} !h-6 self-start`}
            onClick={() => void runOperator("TOOL_SITE")}
            title="Click the map to add a site (P)"
          >
            Place a site
          </button>
        ) : (
          // No button: an area comes from the catalogue card wired into this
          // one, which is the only ground a run is made over.
          <span className="text-micro text-muted-foreground">From the catalogue card</span>
        )}
      </>
    )
  }

  const seasons = engine?.terrain.seasons?.length ? engine.terrain.seasons : FALLBACK_SEASONS
  const roughnessError = windSettingsError(d.settings.wind)

  const body: Record<RunNodeId, ReactNode> = {
    catalogue: <CatalogueCard to={landsOn("catalogue")} onRegion={toRegion} />,
    site: sourcePicker("site"),
    area: sourcePicker("area"),
    /*
      THE MAP'S THREE CARDS. The ground, what is read over it, and the screen.
      They edit the same stores the Overlays popover does, so this is a second
      way in and not a second copy -- the same rule the product cards follow.
    */
    /*
      The map band's catalogue does NOT add an area. A region is a filter, and
      a filter that leaves an object behind every time it is tried is how the
      map ended up with three states outlined on it and nothing to manage them.
    */
    catalogue2: <CatalogueCard to={landsOn("catalogue2")} onRegion={toRegion} />,
    region: (
      <>
        <Select
          value={map.region?.kind === "area" ? map.region.id : map.region ? "__place" : ""}
          ariaLabel="Region"
          onChange={(v) => {
            // "__place" is the boundary the card already holds; choosing it again is a no-op.
            if (v === "__place") return
            setMapGraph({ region: v ? { kind: "area", id: v } : null })
          }}
          options={[
            { value: "", label: "Everywhere the register reaches" },
            ...(map.region?.kind === "place" ? [{ value: "__place", label: `${map.region.name} (from the catalogue)` }] : []),
            ...d.areas.map((a) => ({ value: a.id, label: `${a.name} (area)` })),
          ]}
        />
        {regionArea ? (
          <div className="flex items-center gap-2">
            <span className="telemetry text-micro text-muted-foreground">{polygonAreaKm2(regionArea.polygon).toFixed(0)} km²</span>
            <button
              type="button"
              className={`${btnGhostDense} !h-5 ml-auto`}
              onClick={() => setMapGraph({ region: null })}
              title="Draw the layer everywhere again"
            >
              Clear
            </button>
          </div>
        ) : (
          <Muted>Unscoped: the layer is drawn wherever its register has data.</Muted>
        )}
        <Muted>
          {map.region?.kind === "place"
            ? "Taken from the catalogue and held by this graph only. It is not an area of the project and leaves nothing behind."
            : "Pick a boundary in the Catalogue card, or scope to an area the project already has."}
        </Muted>
      </>
    ),
    layer: (
      <>
        <Select
          value={map.layer}
          ariaLabel="Layer"
          onChange={(v) => setMapGraph({ layer: v as MapLayerKey })}
          options={availableLayers(MAP_LAYERS, store).map((l) => ({ value: l.key, label: l.label }))}
        />
        <Muted>{layerMeta(map.layer).what}</Muted>
      </>
    ),
    mapdraw: (
      <>
        <label className="flex items-center gap-1.5 text-micro text-foreground">
          <input
            type="checkbox"
            checked={shown[map.layer]}
            onChange={(e) => overlays.set((c) => ({ ...c, [map.layer]: e.target.checked }))}
            className="size-3 accent-[var(--accent)]"
          />
          Drawn on the map
        </label>
        <Muted>{drawnNote}</Muted>
      </>
    ),
    ceiling: <Param group="demand" field="yieldCeilingKWhKWp" label="Ceiling" />,
    cell: <Param group="demand" field="cellKm" label="Cell" />,
    record:
      product === "wind" ? (
        <>
          <Param group="wind" field="recordYears" label="Years" />
          <Param group="wind" field="recordMaxFloorMS" label="Max floor" />
        </>
      ) : (
        <Param group={product} field="hourlyYears" label="Hourly" />
      ),
    radiation: <Param group="solar" field="climatologyYears" label="Climatology" />,
    product: (
      <>
        <Select
          value={product}
          ariaLabel="Product"
          onChange={(v) => setAreaState(areaId, { product: v as Product })}
          options={offered.map((p) => ({ value: p, label: PRODUCT_NAMES[p] }))}
        />
        {/* What the chosen product is, under the control that chooses it --
            the layer card's shape, and the only place on the board that has to
            answer "what does this one do". */}
        <Muted>{PRODUCT_SUMMARY[product]}</Muted>
      </>
    ),
    array: <Param group="solar" field="surfaceAzimuth" label="Azimuth" />,
    store: (
      <>
        <div className="flex items-center gap-1.5">
          <span
            className={`size-1.5 shrink-0 rounded-full ${store.kind === "checking" ? "animate-pulse bg-accent" : report?.reachable ? "bg-success" : "bg-muted-foreground/50"}`}
          />
          <span className="telemetry text-meta text-foreground">
            {store.kind === "checking"
              ? "checking"
              : report
                ? report.reachable
                  ? "connected"
                  : report.dsn_source === "none"
                    ? "not connected"
                    : report.coverage?.store?.profile === "none"
                      ? "not a store"
                      : "unreachable"
                : store.kind === "failed"
                  ? "not checked"
                  : "unknown"}
          </span>
          {report?.dsn_source === "TERRA_BR_DSN" && <span className="truncate text-micro text-muted-foreground">{dsnSourceLabel(report.dsn_source)}</span>}
          <button
            type="button"
            className={`${btnIcon} ml-auto !size-5`}
            disabled={store.kind === "checking"}
            onClick={() => void checkGridStore(true)}
            title="Ask the connected store again"
            aria-label="Check the grid store again"
          >
            <ArrowsClockwise className="size-3" />
          </button>
        </div>
        {report?.dsn && (
          <span className="telemetry selectable truncate text-micro text-muted-foreground" title={report.dsn}>
            {report.dsn}
          </span>
        )}
        {((report?.unreachable && report.dsn_source !== "none") || store.kind === "failed") && (
          <p className="line-clamp-3 text-micro leading-snug text-muted-foreground" title={report?.unreachable ?? (store.kind === "failed" ? store.message : "")}>
            {report?.unreachable ?? (store.kind === "failed" ? store.message : "")}
          </p>
        )}
        <StoreHoldings dense />
        {/* The connection itself: nothing reaches the run, or the map, that did not come through here. */}
        <StoreConnectionForm dense />
      </>
    ),
    reach: <Param group="connection" field="searchRadiusKm" label="Radius" />,
    slope: <Param group="ground" field="slopeMaxDeg" label="At most" />,
    flood: <Param group="ground" field="handMinM" label="At least" />,
    performance: <Param group="solar" field="performanceRatio" label="Ratio" />,
    season: (
      <Select
        value={d.settings.terrain.season ?? ""}
        ariaLabel="Season"
        onChange={(v) => setParam("terrain", "season", v || undefined)}
        options={[
          { value: "", label: `Default (${engine ? seasonLabel(engine.terrain.season) : "engine"})` },
          ...seasons.map((id) => ({ value: id, label: seasonLabel(id) })),
        ]}
      />
    ),
    turbine: (
      <>
        <Param group="wind" field="hubHeightM" label="Hub" />
        <Param group="wind" field="calmThresholdMS" label="Calm below" />
      </>
    ),
    roughness: (
      <>
        <Param group="wind" field="roughnessLowM" label="Low" />
        <Param group="wind" field="roughnessHighM" label="High" />
        {roughnessError && (
          <p className="text-micro leading-snug" style={{ color: "var(--warning)" }}>
            {roughnessError}.
          </p>
        )}
      </>
    ),
    run: (
      <div className="flex flex-col gap-1.5">
        {coverage && (
          <p className="text-micro leading-snug" style={coverage.low ? { color: "var(--warning)" } : undefined}>
            {coverage.said}
          </p>
        )}
        <button
          type="button"
          onClick={() => poll === true && void runOperator(OPERATOR[product])}
          aria-disabled={poll !== true || undefined}
          title={poll === true ? `Run ${PRODUCT_NAMES[product].toLowerCase()}` : poll}
          className={`flex w-full items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-meta transition-colors focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring ${
            poll !== true || busy ? "cursor-not-allowed bg-control text-muted-foreground" : "bg-accent font-semibold text-accent-foreground hover:opacity-90"
          }`}
        >
          {busy ? <CircleNotch className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Run {PRODUCT_NAMES[product].toLowerCase()}
        </button>

        {busy && run && (
          <div className="flex flex-col gap-1">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="telemetry shrink-0 text-[9px] tabular-nums text-muted-foreground">{pct === null ? "…" : `${pct}%`}</span>
              <span className="min-w-0 flex-1 truncate text-meta text-foreground" title={run.message}>
                {run.message || "Running"}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-line-strong/30">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${pct ?? 0}%` }}
                role="progressbar"
                aria-valuenow={pct ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${PRODUCT_NAMES[product]} progress`}
              />
            </div>
            <button type="button" className={`${btnGhostDense} !h-6`} onClick={() => void runOperator("CANCEL")}>
              <Stop className="size-3" />
              Cancel
            </button>
          </div>
        )}

        {!busy && poll !== true && <Muted>{poll}.</Muted>}

        {!busy && last && !last.ok && (
          <p className="flex items-start gap-1 text-micro leading-snug text-destructive-quiet">
            <Warning className="mt-px size-3 shrink-0" />
            The last attempt failed. Reports has the reason.
          </p>
        )}

        {!busy && last?.ok && last.resultId && (
          <button type="button" className={`${btnGhostDense} !h-6`} onClick={() => showResult(last.resultId!, product)}>
            <Eye className="size-3" />
            Show the reading
          </button>
        )}
      </div>
    ),
  }

  const state = (from: RunNodeId): EdgeState => {
    const value = values[from]
    if (!supplied(value)) return "missing"
    /*
      A MAP WIRE HAS NOTHING TO BE STALE AGAINST. The five states describe a
      reading against the run that produced it; the map has no run -- what its
      cards hold IS what is drawn, the moment they hold it. So a supplied card
      reads "read", and the one state that still means something is "missing":
      a layer with no register behind it.
    */
    if (isMapNode(from)) return "read"
    // The store's card feeding the map is a map wire like the others.
    if (from === "store" && graph.nodes.find((n) => n.id === "store")?.band) return "read"
    return inputState(value, last, lastValues?.[from] ?? null, busy)
  }

  const nodes: CanvasNode[] = graph.nodes.filter((spec) => !gone.has(spec.id)).map((spec) => {
    const common = { id: spec.id, place: places[spec.id] ?? fallback[spec.id], h: heights[spec.id] ?? spec.h, children: body[spec.id] }
    if (spec.id === "run" || spec.id === "mapdraw") {
      return {
        ...common,
        title: spec.label,
        head: "var(--node-head-run)",
        // Only the wires that end here: the catalogue's ends at the ground card.
        inputs: graph.edges
          .filter(([, to]) => to === spec.id)
          .map(([from]) => {
          const st = state(from)
          // No card, no wire: the row says what the input IS, since nothing else on the board does now.
          const off = gone.has(from)
          // A wire the reader cut: the card is there and sends nothing here.
          const cut = !off && !wired.some(([f, t]) => f === from && t === spec.id)
          return {
            id: from,
            label: graph.nodes.find((n) => n.id === from)?.label ?? from,
            colour: socketOf(values[from]),
            note: off ? reading(values[from]) || EDGE_NOTE.missing : cut ? "not wired" : EDGE_NOTE[st],
            noteColour: off || cut ? undefined : NOTE_COLOUR[st],
          }
        }),
      }
    }
    // The area card receives the catalogue's wire, so it carries an input row
    // for it to land on. Its own output goes on to the run card as before.
    // A row for every wire that lands here, and for the catalogue's even while cut: the socket is what a wire is pulled back onto.
    const incoming = [...graph.edges, ...wired.filter(([from, to]) => !graph.edges.some(([f, t]) => f === from && t === to))].filter(
      ([, to]) => to === spec.id
    )
    const value = values[spec.id]
    return {
      ...common,
      title: spec.label,
      head: headOf(value),
      output: { id: "out", label: reading(value) || "none", colour: socketOf(value) },
      // Every card's socket pulls: a wire that was cut is put back by pulling it again.
      connectable: true,
      inputs: incoming.length
        ? incoming.map(([from]) => ({
            id: from,
            label: graph.nodes.find((n) => n.id === from)?.label ?? from,
            colour: socketOf(values[from]),
            note: supplied(value) ? "" : "empty",
            noteColour: undefined,
          }))
        : undefined,
    }
  })

  const edges: CanvasEdge[] = wired.map(([from, to]) => ({
    from,
    to,
    socket: from,
    colour: socketOf(values[from]),
    state: state(from),
    removable: true,
  }))

  const labelOf = (id: RunNodeId) => graph.nodes.find((n) => n.id === id)?.label ?? id

  /*
    THE LIST IS THE BOARD'S BANDS, named by what each one is about: the
    product being set up, and the map. A card scrolled off the canvas is still
    in the list, which is the only place the whole board is stated at once.
  */
  const sections: CanvasSection[] = [...new Set(graph.nodes.map((n) => n.band))]
    .sort((a, b) => a - b)
    .map((band) => ({
      id: `band-${band}`,
      label: band === 0 ? PRODUCT_NAMES[product] : "Map",
      ids: graph.nodes.filter((n) => n.band === band && !gone.has(n.id)).map((n) => n.id),
    }))
    .filter((section) => section.ids.length)

  const removed = graph.nodes
    .filter((n) => gone.has(n.id))
    .map((n) => ({ id: n.id, title: n.label, head: n.id === "run" || n.id === "mapdraw" ? "var(--node-head-run)" : headOf(values[n.id]) }))

  const bandLabel = (band: number) => (band === 0 ? PRODUCT_NAMES[product] : "Map")

  /*
    WHY EACH WIRE IS THE COLOUR IT IS. The canvas says the state; this says
    what it was decided from -- what the card holds now, beside what the
    reading on screen was made with. A map wire has no run behind it, so the
    column for it is not drawn at all rather than filled with dashes.

    A ROW IS A WAY BACK TO ITS CARD: clicking takes the card on the board,
    double-clicking frames it. A list that names a card you then have to hunt
    for is a list that has sent you away from the board.
  */
  const tally: Record<EdgeState, number> = { missing: 0, pending: 0, reading: 0, read: 0, failed: 0 }
  for (const e of edges) tally[e.state]++
  const counted = (
    [
      ["missing", "not set"],
      ["pending", "pending"],
      ["reading", "reading"],
      ["read", "read"],
      ["failed", "in error"],
    ] as const
  )
    .filter(([k]) => tally[k])
    .map(([k, word]) => `${tally[k]} ${word}`)
    .join(" · ")
  const why = !last
    ? `${PRODUCT_NAMES[product].toLowerCase()} has not been run ${source ? `${product === "terrain" ? "over" : "at"} ${source.name}` : "here"} yet`
    : last.ok
      ? null
      : "the last attempt failed; Reports has the reason"

  const showRead = !!last?.ok
  const grid = showRead
    ? "10px minmax(120px, 200px) minmax(90px, 240px) minmax(90px, 240px) 60px"
    : "10px minmax(120px, 200px) minmax(90px, 280px) 60px"
  const head = "truncate text-[9px] uppercase tracking-wide text-muted-foreground"

  const wires = (board: CanvasBoard) => (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline gap-1.5 px-2.5 pb-1 pt-2">
        <span className="text-meta text-foreground">{edges.length} wires</span>
        <span className="truncate text-micro text-muted-foreground">
          {counted}
          {why ? ` · ${why}` : ""}
        </span>
      </div>
      <div className="grid shrink-0 items-center gap-2 px-2.5 pb-1" style={{ gridTemplateColumns: grid }}>
        <span />
        <span className={head}>Wire</span>
        <span className={head}>The card holds</span>
        {showRead && <span className={head}>The reading read</span>}
        <span className={`${head} text-right`}>State</span>
      </div>
      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto pb-1.5">
        {[...new Set(graph.nodes.map((n) => n.band))].sort((a, b) => a - b).map((band) => {
          const here = wired.filter(([from]) => graph.nodes.find((n) => n.id === from)?.band === band)
          if (!here.length) return null
          return (
            <div key={band}>
              <div className="px-2.5 pb-px pt-1.5">
                <span className={head}>{bandLabel(band)}</span>
              </div>
              {here.map(([from, to]) => {
                const st = state(from)
                const on = board.picked.has(from)
                const now = reading(values[from])
                const read = isMapNode(from) || !lastValues ? "" : reading(lastValues[from])
                return (
                  <button
                    key={`${from}-${to}`}
                    type="button"
                    onClick={() => board.select([from])}
                    onDoubleClick={() => board.frame(new Set([from]))}
                    title={`${labelOf(from)} — click to take the card, double-click to frame it`}
                    className={`grid w-full items-center gap-2 px-2.5 py-[3px] text-left text-meta ${on ? "bg-selected" : "hover:bg-hover"}`}
                    style={{ gridTemplateColumns: grid }}
                  >
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full"
                      style={
                        st === "missing"
                          ? { background: "transparent", boxShadow: `inset 0 0 0 1px ${socketOf(values[from])}` }
                          : { background: socketOf(values[from]), opacity: st === "pending" ? 0.5 : 1 }
                      }
                    />
                    <span className="truncate text-foreground">
                      {labelOf(from)} <span className="text-muted-foreground">→ {labelOf(to)}</span>
                    </span>
                    <span className="telemetry truncate text-micro text-muted-foreground" title={now}>
                      {now || "nothing"}
                    </span>
                    {showRead && (
                      <span className="telemetry truncate text-micro text-muted-foreground" title={read}>
                        {read || "—"}
                      </span>
                    )}
                    <span className="truncate text-right text-micro" style={{ color: NOTE_COLOUR[st] ?? "var(--muted-foreground)" }}>
                      {EDGE_NOTE[st]}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )

  const tabs: CanvasTab[] = [
    // What is in the way of a run, counted: a card nobody has filled in.
    { id: "wires", label: "Wires", icon: FlowArrow, badge: tally.missing, hug: true, body: wires },
    {
      id: "console",
      label: "Console",
      icon: CodeSimple,
      badge: logged.filter((l) => l.level === "warning" || l.level === "error").length,
      body: <ConsoleBody />,
    },
  ]

  return (
    <>
      <AreaHeader
        menus={
          <>
            <StudioHeaderMenu
              label="View"
              items={() => [
                ...offered.map((p) => ({
                  type: "action" as const,
                  label: PRODUCT_NAMES[p],
                  icon: PRODUCT_ICON[p],
                  checked: p === product,
                  run: () => setAreaState(areaId, { product: p }),
                })),
                { type: "sep" as const },
                { type: "action" as const, label: "Frame all", shortcut: "Home", run: () => board.current?.frame() },
                { type: "action" as const, label: "Put the nodes back in columns", run: resetPlaces },
              ]}
            />
            {/* One of each card, so what can be added is what was taken off. */}
            <StudioHeaderMenu
              label="Add"
              items={() =>
                removed.length
                  ? removed.map((n) => ({ type: "action" as const, label: n.title, run: () => setRemoved([n.id], removedKey, false) }))
                  : [{ type: "action" as const, label: "Every card is on the board", disabled: "Nothing has been taken off this board", run: () => {} }]
              }
            />
            <StudioHeaderMenu
              label="Node"
              items={() => {
                const wire = board.current?.wire()
                const cards = board.current?.picked().length ?? 0
                return [
                  {
                    type: "action" as const,
                    label: wire ? "Remove wire" : cards > 1 ? `Remove ${cards} cards` : "Remove",
                    shortcut: "X",
                    disabled: !wire && !cards && "Select a card or a wire first",
                    run: () => board.current?.remove(),
                  },
                  { type: "sep" as const },
                  {
                    type: "action" as const,
                    label: "Put the removed cards back",
                    disabled: !removed.length && "Nothing has been taken off this board",
                    run: () => setRemoved(removed.map((n) => n.id), removedKey, false),
                  },
                ]
              }}
            />
          </>
        }
        centre={
          <span className="header-label truncate text-meta text-muted-foreground">
            {PRODUCT_NAMES[product]}
            {source ? ` ${product === "terrain" ? "over" : "at"} ${source.name}` : ""}
          </span>
        }
      />
      <NodeCanvas
        api={board}
        nodes={nodes}
        edges={edges}
        onMove={move}
        onMeasure={onMeasure}
        onRemove={(ids) => setRemoved(ids, removedKey, true)}
        onRestore={(id, place) => {
          if (place) move(id, place)
          setRemoved([id], removedKey, false)
        }}
        removed={removed}
        onConnect={(from, to) => {
          if (SOURCES.includes(from) && GROUNDS.includes(to)) setLink(`${from}>${to}`, true)
          else if (SOURCES.includes(from)) note("A catalogue supplies ground: its wire lands on an Area or a Region card.")
          // One of the request's own wires, cut before and pulled back onto the card it belongs on.
          else if (!LINKED.includes(from) && graph.edges.some(([f, t]) => f === from && t === to)) setCut(from, to, scopeOf(to as RunNodeId), false)
          else if (!LINKED.includes(from)) {
            const home = graph.edges.find(([f]) => f === from)?.[1]
            note(home ? `That card's value goes to the ${labelOf(home)} card: its wire lands there.` : "That card sends nothing along a wire.")
          }
          else if (from === "store" && takesStore(to as RunNodeId)) setLink(`store>${to}`, true)
          else if (from === "store") {
            note(
              takesStore("run")
                ? "The store feeds the Map and this product's Run: its wire lands on one of those two cards."
                : "The store feeds the Map. This product's run does not read a store, so its Run card takes no wire from it."
            )
          }
        }}
        onDisconnect={(from, to) => (LINKED.includes(from) ? setLink(`${from}>${to}`, false) : setCut(from, to, scopeOf(to as RunNodeId), true))}
        sections={sections}
        tabs={tabs}
      />
    </>
  )
}

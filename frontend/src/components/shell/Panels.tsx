import { useEffect, type ReactNode } from "react"
import { Crosshair, MapPin, Pentagon } from "../../lib/icons"
import { frameItem } from "../../lib/mapEngine"
import { PRODUCT_NAMES, findItem, isResult, project, resultsOf, type Product } from "../../lib/project"
import { reports } from "../../lib/reports"
import { hoveredArea } from "../../lib/screen"
import { select, useActiveItem } from "../../lib/selection"
import { closePanel, openPanel, reportsSeen, resultProduct } from "../../lib/shell"
import { useStore } from "../../lib/store"
import { basemap, overlays } from "../../lib/tools"
import { coordinatePrompt } from "../../lib/ui"
import { BASEMAP_ITEMS } from "../editors/MapEditor"
import { GeoPackageControl } from "../editors/GeoPackageControl"
import { OutlinerEditor } from "../editors/OutlinerEditor"
import { AreaBody, SiteBody } from "../editors/PropertiesEditor"
import { ReadingEditor } from "../editors/ReadingEditor"
import { ReportsEditor } from "../editors/ReportsEditor"
import { btnGhostDense } from "../ui/buttons"
import { OperatorButton } from "../ui/Fields"
import { AreaHeader } from "./HeaderHosts"
import { ShellPanel } from "./ShellPanel"

const PRODUCTS: Product[] = ["solar", "wind", "terrain", "connection", "demand", "ground"]

/**
 * The keys of an editor answer while the pointer is over it: Delete and F2 in
 * a list of the project's things, as they did over the studio's outliner.
 */
function KeyScope({ id, editor, children }: { id: string; editor: "outliner" | "map"; children: ReactNode }) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onMouseEnter={() => hoveredArea.set({ id, editor })}
      onMouseLeave={() => {
        if (hoveredArea.get().id === id) hoveredArea.set({ id: null, editor: null })
      }}
    >
      {children}
    </div>
  )
}

/** The three ways a site or an area arrives, which every empty answer offers. */
function PlaceActions() {
  return (
    <>
      <OperatorButton name="TOOL_SITE" label="Place a site" />
      <OperatorButton name="AREA_PLACE" label="Area from a place…" />
      <button type="button" className={btnGhostDense} onClick={() => coordinatePrompt.set(true)}>
        <Crosshair className="size-3" />
        At coordinates…
      </button>
    </>
  )
}

/** The project's sites and areas, each with the results read at it. */
export function PlacesPanel() {
  return (
    <ShellPanel crumbs={[{ label: "Sites and areas" }]} onClose={closePanel} footer={<PlaceActions />}>
      <KeyScope id="shell:places" editor="outliner">
        <OutlinerEditor areaId="shell:places" scope="project" />
      </KeyScope>
    </ShellPanel>
  )
}

/**
 * What can be computed at the site or area in hand: each product with what it
 * reads, its settings and its run, as the studio's Properties offered them.
 */
export function ProductsPanel() {
  const d = useStore(project).data
  const active = useActiveItem()
  const source = isResult(active) ? findItem(d, active.sourceId) : active
  const place = source && (source.kind === "site" || source.kind === "area") ? source : null
  return (
    <ShellPanel crumbs={place ? [{ label: "Products" }, { label: place.name }] : [{ label: "Products" }]} onClose={closePanel}>
      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
        {place?.kind === "site" ? <SiteBody site={place} /> : place?.kind === "area" ? <AreaBody area={place} /> : <NoPlace />}
      </div>
    </ShellPanel>
  )
}

/** Nothing in hand: which places there are to choose, and how to make one. */
function NoPlace() {
  const d = useStore(project).data
  const take = (id: string) => {
    select(id)
    const item = findItem(project.get().data, id)
    if (item) frameItem(item)
  }
  const places = [...d.sites, ...d.areas]
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <p className="text-body leading-relaxed text-muted-foreground">
        Solar resource and wind screening are computed at a site; terrain, grid connection, consumption and usable ground over an area. Choose one, or make one.
      </p>
      {places.length > 0 && (
        <ul className="flex flex-col">
          {places.map((o) => {
            const Glyph = o.kind === "site" ? MapPin : Pentagon
            return (
              <li key={o.id}>
                <button type="button" onClick={() => take(o.id)} className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-body text-foreground hover:bg-hover">
                  <Glyph className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  <span className="text-meta text-muted-foreground">{resultsOf(d, o.id).length || ""}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <PlaceActions />
      </div>
    </div>
  )
}

/**
 * The reading of a run, wide, over the map that shows where.
 *
 * Which product: the selected result's, else the one last asked for ("Read
 * it", a finished run, a tab here), else the newest read at the place in hand.
 * The reading itself picks which of that product's results, as it always has.
 */
export function ResultPanel() {
  const d = useStore(project).data
  const active = useActiveItem()
  const asked = useStore(resultProduct)
  const source = isResult(active) ? findItem(d, active.sourceId) : active
  const pool = source ? resultsOf(d, source.id) : d.results
  const kinds = PRODUCTS.filter((p) => (pool.length ? pool : d.results).some((r) => r.kind === p))
  const product: Product | null = isResult(active)
    ? active.kind
    : asked && (kinds.includes(asked) || !pool.length)
      ? asked
      : ((pool.length ? pool : d.results).at(-1)?.kind ?? null)
  const choose = (p: Product) => {
    resultProduct.set(p)
    if (isResult(active) && active.kind !== p) select(active.sourceId)
  }
  return (
    <ShellPanel crumbs={product ? [{ label: "Result" }, { label: PRODUCT_NAMES[product] }] : [{ label: "Result" }]} onClose={closePanel} wide>
      {kinds.length > 1 && product && (
        <div role="tablist" aria-label="Product" className="flex shrink-0 gap-1 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
          {kinds.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={p === product}
              onClick={() => choose(p)}
              className={`h-7 rounded-sm px-2.5 text-body transition-colors ${p === product ? "bg-[rgb(var(--p-surface-raised))] text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"}`}
            >
              {PRODUCT_NAMES[p]}
            </button>
          ))}
        </div>
      )}
      {product ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <ReadingEditor areaId="shell:result" product={product} />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 px-4 py-4">
          <p className="text-body leading-relaxed text-muted-foreground">No result yet. Products lists what can be computed at the site or area in hand, and a finished run opens here.</p>
          <button type="button" className={btnGhostDense} onClick={() => openPanel("products")}>
            Open Products
          </button>
        </div>
      )}
    </ShellPanel>
  )
}

/** The ground under everything, chosen first: a photograph or a drawing, and the relief over it. */
function GroundChoice() {
  const ground = useStore(basemap)
  const o = useStore(overlays)
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
      <p className="text-meta text-muted-foreground">Ground</p>
      <div role="radiogroup" aria-label="Ground" className="flex gap-1">
        {BASEMAP_ITEMS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={ground === b.id}
            onClick={() => basemap.set(b.id)}
            className={`h-7 min-w-0 flex-1 truncate rounded-sm px-2 text-body transition-colors ${ground === b.id ? "bg-[rgb(var(--p-surface-raised))] text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"}`}
          >
            {b.label}
          </button>
        ))}
      </div>
      <label className="flex h-6 items-center gap-2 text-body text-foreground">
        <input type="checkbox" checked={o.hillshade} onChange={(e) => overlays.set((cur) => ({ ...cur, hillshade: e.target.checked }))} className="accent-[rgb(var(--p-accent))]" />
        Relief shading
      </label>
    </div>
  )
}

/** What the map draws: the ground, the registers and the store's layers, the weather, and an opened GeoPackage. */
export function LayersPanel() {
  return (
    <ShellPanel crumbs={[{ label: "Layers" }]} onClose={closePanel}>
      <AreaHeader menus={<GeoPackageControl />} />
      <GroundChoice />
      <KeyScope id="shell:layers" editor="outliner">
        <OutlinerEditor areaId="shell:layers" scope="layers" />
      </KeyScope>
    </ShellPanel>
  )
}

/** What the application has said, kept after each notification leaves. */
export function ActivityPanel() {
  const list = useStore(reports)
  // Seen while open: the rail's mark is for what arrived while the reader looked elsewhere.
  useEffect(() => {
    reportsSeen.set(list[list.length - 1] ?? null)
  }, [list])
  return (
    <ShellPanel crumbs={[{ label: "Activity" }]} onClose={closePanel}>
      <div className="flex min-h-0 flex-1 flex-col">
        <ReportsEditor areaId="shell:activity" />
      </div>
    </ShellPanel>
  )
}

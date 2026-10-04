import { useEffect, useRef, useState } from "react"
import {
  CaretDown,
  CaretRight,
  ChartBar,
  CloudSun,
  Database,
  Eye,
  EyeSlash,
  Fan,
  Folder,
  FolderOpen,
  Globe,
  MapPin,
  Mountains,
  Pentagon,
  PlugsConnected,
  Stack,
  Sun,
  Swatches,
  Warning,
  type Icon,
} from "../../lib/icons"
import { running } from "../../lib/analysis"
import { legendsShown, setLegendShown } from "../../lib/mapState"
import { isResult, project, renameItem, resultsOf, setHidden, staleReason, type AnyItem } from "../../lib/project"
import { areaStates, setAreaState, showResult } from "../../lib/screen"
import { select, selection } from "../../lib/selection"
import { artSrc } from "../../lib/art"
import { useStore } from "../../lib/store"
import { overlays, type Overlays } from "../../lib/tools"
import { openContextMenu, renaming, type MenuItem } from "../../lib/ui"
import { StudioHeaderToggle } from "../studio/HeaderControls"
import { AreaHeader } from "../studio/StudioArea"
import { concessions, networkRegister, plantRegister, townDemand } from "../../lib/grid"
import { GRID_ITEMS, OVERLAY_ITEMS, REFERENCE_ITEMS, WEATHER_ITEMS, layerNote } from "./MapEditor"

/**
 * The project's outliner, as an object explorer: ONE tree, from the project
 * down, holding everything the map can show -- the sites and areas with their
 * results under them, and the map's own layers beside them.
 *
 * ONE TREE AND NOT TWO LISTS. It was a Scene tab and a Results tab, and the
 * layers were in a popover on the map: three places to ask what is on the map.
 * A result is found under what it was read from, a layer under the register it
 * comes from, and a folder says how many it holds.
 *
 * A ROW CARRIES ONLY THE TOGGLE THAT IS BINARY, at the end of it, so the tree's
 * own shape is what is read down the left. Everything with a value attached is
 * edited in Properties, for whichever row is active.
 */

const ICON: Record<AnyItem["kind"], Icon> = { site: MapPin, area: Pentagon, solar: Sun, wind: Fan, terrain: Mountains, connection: PlugsConnected, demand: ChartBar }
const KIND: Record<AnyItem["kind"], string> = { site: "Site", area: "Area", solar: "Solar", wind: "Wind", terrain: "Terrain", connection: "Grid", demand: "Demand" }
/*
  A row's glyph in the colour of what it is, as an object explorer's are: the
  tree is scanned by colour before it is read. The node editor's socket
  colours, so a site is the same green here as on the run graph.
*/
const TINT: Record<AnyItem["kind"], string> = {
  site: "var(--node-socket-source)",
  area: "var(--node-socket-source)",
  solar: "var(--node-socket-when)",
  wind: "var(--node-socket-method)",
  terrain: "var(--node-socket-when)",
  connection: "var(--node-socket-method)",
  demand: "var(--node-socket-method)",
}
const FOLDER_TINT = "var(--warning)"
/** The coloured drawing of each kind of thing, by what it means (lib/art.ts); the same names the ribbon asks for. */
const ART: Record<AnyItem["kind"], string> = { site: "site", area: "area", solar: "solar", wind: "wind", terrain: "terrain", connection: "connection", demand: "demand" }
const GROUP_ART: Record<string, string> = { "g:overlays": "layers", "g:grid": "store", "g:weather": "weather", "g:reference": "basemap" }

/** The map's layers, in the groups the map's own popover offers them in. */
const LAYER_GROUPS: { id: string; label: string; icon: Icon; items: { key: keyof Overlays; label: string }[] }[] = [
  { id: "g:overlays", label: "Overlays", icon: Stack, items: OVERLAY_ITEMS },
  { id: "g:grid", label: "Grid store", icon: Database, items: GRID_ITEMS },
  { id: "g:weather", label: "Weather now", icon: CloudSun, items: WEATHER_ITEMS },
  { id: "g:reference", label: "Published registers", icon: Globe, items: REFERENCE_ITEMS },
]

type Row = {
  /** The row's identity in the tree: an item's id, or a folder's or a layer's own. */
  key: string
  depth: number
  label: string
  icon: Icon
  /** The coloured drawing that stands in for the glyph, where the set on trial has one. */
  art?: string
  tint: string
  expandable: boolean
  open: boolean
  /** How many a folder holds. */
  count?: number
  item?: AnyItem
  layer?: keyof Overlays
  folder?: boolean
}

function itemMenu(item: AnyItem): MenuItem[] {
  const op = (name: string, label?: string): MenuItem => ({ type: "op", op: name, label })
  const common: MenuItem[] = [
    { type: "sep" },
    op("FRAME_SELECTED"),
    op("RENAME"),
    { type: "action", label: item.hidden ? "Show" : "Hide", run: () => setHidden(item.id, !item.hidden) },
    op("DELETE"),
  ]
  if (item.kind === "site") return [op("SOLAR"), op("WIND"), ...common]
  if (item.kind === "area") return [op("TERRAIN"), op("CONNECTION"), ...common]
  return [
    { type: "action", label: "Read it", run: () => showResult(item.id, item.kind) },
    op("RERUN", "Run again"),
    { type: "sep" },
    op("EXPORT_CSV"),
    op("EXPORT_JSON"),
    ...(item.kind === "terrain"
      ? [
          op("EXPORT_GEOTIFF"),
          {
            type: "action" as const,
            label: "Legend on the map",
            icon: Swatches,
            checked: legendsShown.get().has(item.id),
            run: () => setLegendShown(item.id, !legendsShown.get().has(item.id)),
          },
        ]
      : []),
    ...common,
  ]
}

export function OutlinerEditor({ areaId }: { areaId: string }) {
  const { data } = useStore(project)
  const { id: selected } = useStore(selection)
  const editing = useStore(renaming)
  const job = useStore(running)
  const legends = useStore(legendsShown)
  const shown = useStore(overlays)
  // Read so a layer's note is redrawn when its register answers; layerNote reads the stores itself.
  useStore(plantRegister)
  useStore(networkRegister)
  useStore(concessions)
  useStore(townDemand)
  const state = useStore(areaStates)[areaId] ?? {}
  const onlyVisible = !!state.onlyVisible
  // Folders are open until closed, except the layer groups, which are closed until opened.
  const collapsed = new Set((state.collapsed as string[] | undefined) ?? [])
  const opened = new Set((state.opened as string[] | undefined) ?? [])
  const isOpen = (key: string) => (key.startsWith("g:") ? opened.has(key) : !collapsed.has(key))
  const rowRefs = useRef(new Map<string, HTMLElement>())
  const [draft, setDraft] = useState("")
  // Where the keys are, for a row that is not a thing of the project and so cannot be the selection.
  const [cursor, setCursor] = useState<string | null>(null)

  const rows: Row[] = []
  const folder = (key: string, depth: number, label: string, count: number, icon?: Icon): boolean => {
    const open = isOpen(key)
    rows.push({ key, depth, label, icon: icon ?? (open ? FolderOpen : Folder), art: GROUP_ART[key] ?? (open ? "folder-open" : "folder"), tint: FOLDER_TINT, expandable: count > 0, open, count, folder: true })
    return open && count > 0
  }
  const objects = (key: string, label: string, list: readonly (AnyItem & { kind: "site" | "area" })[]) => {
    const kept = list.filter((o) => !onlyVisible || !o.hidden)
    if (!folder(key, 1, label, kept.length)) return
    for (const o of kept) {
      const results = resultsOf(data, o.id).filter((r) => !onlyVisible || !r.hidden)
      const open = isOpen(o.id)
      rows.push({ key: o.id, depth: 2, label: o.name, icon: ICON[o.kind], art: ART[o.kind], tint: TINT[o.kind], expandable: results.length > 0, open, item: o })
      if (!open) continue
      // Newest first: the reading on screen is the one a reader looks for.
      for (const r of [...results].reverse()) {
        rows.push({ key: r.id, depth: 3, label: r.name, icon: ICON[r.kind], art: ART[r.kind], tint: TINT[r.kind], expandable: false, open: false, item: r })
      }
    }
  }
  rows.push({ key: "root", depth: 0, label: data.name, icon: Database, art: "project", tint: "rgb(var(--p-accent))", expandable: true, open: isOpen("root"), folder: true })
  if (isOpen("root")) {
    objects("f:sites", "Sites", data.sites)
    objects("f:areas", "Areas", data.areas)
    const groups = LAYER_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => !onlyVisible || shown[it.key]) })).filter((g) => g.items.length)
    if (folder("f:layers", 1, "Map layers", groups.length)) {
      for (const g of groups) {
        if (!folder(g.id, 2, g.label, g.items.length)) continue
        for (const it of g.items) {
          rows.push({ key: `l:${it.key}`, depth: 3, label: it.label, icon: g.icon, art: GROUP_ART[g.id], tint: "var(--node-socket-value)", expandable: false, open: false, layer: it.key })
        }
      }
    }
  }

  // A folder under the keys does not take the selection away: Properties stays on what it was showing.
  const active = (row: Row) => (cursor ? row.key === cursor : row.item?.id === selected)

  // The row selected elsewhere, on the map, is scrolled to, and the keys go with it.
  useEffect(() => {
    setCursor(null)
    if (selected) rowRefs.current.get(selected)?.scrollIntoView({ block: "nearest" })
  }, [selected])

  useEffect(() => {
    if (editing) {
      const item = rows.find((r) => r.item?.id === editing)?.item
      if (item) setDraft(item.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const toggle = (key: string) => {
    const [name, held] = key.startsWith("g:") ? (["opened", opened] as const) : (["collapsed", collapsed] as const)
    const next = new Set(held)
    if (!next.delete(key)) next.add(key)
    setAreaState(areaId, { [name]: [...next] })
  }

  /** Make a row the one the keys are on: the selection where it is a thing of the project. */
  const take = (row: Row) => {
    setCursor(row.item ? null : row.key)
    if (row.item) select(row.item.id)
  }

  const setLayer = (key: keyof Overlays, on: boolean) => overlays.set((cur) => ({ ...cur, [key]: on }))

  const commitName = (id: string) => {
    renaming.set(null)
    renameItem(id, draft)
    rowRefs.current.get(id)?.focus()
  }

  // The tree's keys: up and down walk the rows, right opens, left closes or steps to the parent.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = rows.findIndex(active)
    const go = (to: Row | undefined) => {
      if (!to) return
      e.preventDefault()
      take(to)
      rowRefs.current.get(to.key)?.focus()
    }
    if (e.key === "ArrowDown") return go(rows[i + 1] ?? rows[0])
    if (e.key === "ArrowUp") return go(rows[Math.max(0, i - 1)])
    if (i < 0) return
    const row = rows[i]
    if ((e.key === "F2" || e.key === "Enter") && row.item) {
      e.preventDefault()
      renaming.set(row.item.id)
    } else if ((e.key === "Enter" || e.key === " ") && row.layer) {
      e.preventDefault()
      setLayer(row.layer, !shown[row.layer])
    } else if (e.key === "ArrowRight" && row.expandable && !row.open) {
      e.preventDefault()
      toggle(row.key)
    } else if (e.key === "ArrowLeft") {
      if (row.expandable && row.open) {
        e.preventDefault()
        toggle(row.key)
      } else if (row.depth > 0) {
        for (let j = i - 1; j >= 0; j--) if (rows[j].depth < row.depth) return go(rows[j])
      }
    }
  }

  const empty = !data.sites.length && !data.areas.length

  return (
    <>
      <AreaHeader
        options={
          <StudioHeaderToggle
            icon={EyeSlash}
            label="Only what is drawn"
            on={onlyVisible}
            onToggle={() => setAreaState(areaId, { onlyVisible: !onlyVisible })}
            title="Withhold the rows whose eye is off"
          />
        }
      />
      <div role="tree" aria-label="The project" onKeyDown={onKeyDown} className="panel-scroll h-full min-h-0 overflow-y-auto py-1">
        {rows.map((row, index) => {
          const item = row.item
          const isActive = active(row)
          const IconC = row.icon
          const stale = item && isResult(item) ? staleReason(data, item) : null
          const busy = !!item && !!job && job.sourceId === item.id
          // What the eye is about: a thing on the map, or one of the map's layers. A reading with nothing drawn has none.
          const eye =
            item && item.kind !== "solar" && item.kind !== "wind" && item.kind !== "connection"
              ? { on: !item.hidden, set: (on: boolean) => setHidden(item.id, !on) }
              : row.layer
                ? { on: shown[row.layer], set: (on: boolean) => setLayer(row.layer!, on) }
                : null
          const dim = eye && !eye.on && !isActive
          return (
            <div
              key={row.key}
              ref={(el) => {
                if (el) rowRefs.current.set(row.key, el)
                else rowRefs.current.delete(row.key)
              }}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-selected={isActive}
              aria-expanded={row.expandable ? row.open : undefined}
              // A roving tab stop: the tree is one stop, not one per row.
              tabIndex={isActive || (!selected && !cursor && index === 0) ? 0 : -1}
              onClick={() => take(row)}
              onDoubleClick={() => {
                if (item) renaming.set(item.id)
                else if (row.layer) setLayer(row.layer, !shown[row.layer])
                else if (row.expandable) toggle(row.key)
              }}
              onContextMenu={(e) => {
                if (!item) return
                e.preventDefault()
                select(item.id)
                openContextMenu(e, itemMenu(item), item.name)
              }}
              className={`relative flex h-[22px] cursor-default select-none items-center gap-1.5 pr-1.5 transition-colors ${
                isActive ? "bg-selected" : "hover:bg-hover"
              }`}
              style={{ paddingLeft: 6 + row.depth * 16 }}
            >
              {row.expandable ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(row.key)
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="grid size-3.5 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  {row.open ? <CaretDown className="size-2.5" weight="fill" /> : <CaretRight className="size-2.5" />}
                </button>
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              {artSrc(row.art) ? (
                // Dimmed with its row: a hidden layer's drawing should not be the brightest thing on it.
                <img src={artSrc(row.art)} alt="" draggable={false} className={`size-4 shrink-0 ${dim ? "opacity-40 grayscale" : ""}`} />
              ) : (
                <IconC className={`size-3.5 shrink-0 ${dim ? "opacity-40" : ""}`} weight="fill" style={{ color: row.tint }} />
              )}
              {item && editing === item.id ? (
                <input
                  autoFocus
                  value={draft}
                  aria-label={`Rename ${item.name}`}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => commitName(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    // Stopped: the tree walks on the arrows and the window acts on Escape.
                    e.stopPropagation()
                    if (e.key === "Enter") commitName(item.id)
                    else if (e.key === "Escape") renaming.set(null)
                  }}
                  className="min-w-0 flex-1 rounded-sm border-0 bg-sunk px-1 text-emphasis text-foreground outline-none inset-ring-1 inset-ring-ring"
                />
              ) : (
                <span
                  className={`min-w-0 flex-1 truncate text-emphasis ${dim ? "text-muted-foreground/50" : row.folder || isActive ? "text-foreground" : "text-muted-foreground"}`}
                  title={item ? `${KIND[item.kind]} — double-click to rename` : row.layer ? "Double-click to draw it or take it off the map" : undefined}
                >
                  {row.label}
                </span>
              )}

              {/* What a layer holds once read, or that it could not be: the map's popover said this, and this is the one list now. */}
              {row.layer &&
                (() => {
                  const note = layerNote(row.layer)
                  return note.text ? (
                    <span
                      className={`telemetry shrink-0 text-micro tabular-nums ${note.failed ? "text-destructive-quiet" : "text-muted-foreground/70"}`}
                      title={note.failed}
                    >
                      {note.text}
                    </span>
                  ) : null
                })()}
              {row.count !== undefined && <span className="telemetry shrink-0 text-micro tabular-nums text-muted-foreground/70">{row.count}</span>}
              {busy && <span className="size-1.5 shrink-0 animate-pulse rounded-[1px] bg-accent" title="Running" />}
              {stale && (
                <span className="shrink-0" style={{ color: "var(--warning)" }} title={`${stale}. Its figures describe the source as it was.`}>
                  <Warning className="size-3" weight="fill" aria-label="Stale" />
                </span>
              )}
              {/* A terrain layer's legend, tied to it on the map: shown by asking, from here. */}
              {item?.kind === "terrain" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setLegendShown(item.id, !legends.has(item.id))
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  tabIndex={-1}
                  aria-pressed={legends.has(item.id)}
                  aria-label={`${legends.has(item.id) ? "Remove" : "Draw"} the legend of ${item.name}`}
                  title={legends.has(item.id) ? "Legend on the map" : "Draw its legend on the map, tied to the layer"}
                  className={`grid size-4 shrink-0 place-items-center rounded-sm transition-colors hover:text-foreground ${
                    legends.has(item.id) ? "text-accent" : "text-muted-foreground/40"
                  }`}
                >
                  <Swatches className="size-3" weight={legends.has(item.id) ? "fill" : "regular"} />
                </button>
              )}
              {/* THE EYE, in one column at the end of the row, so the tree's shape is what is read down the left. */}
              <span className="grid size-4 shrink-0 place-items-center">
                {eye && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      eye.set(!eye.on)
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    tabIndex={isActive ? 0 : -1}
                    aria-pressed={eye.on}
                    aria-label={`${eye.on ? "Hide" : "Show"} ${row.label}`}
                    title={eye.on ? "Hide" : "Show"}
                    className={`transition-colors hover:text-foreground ${eye.on ? "text-muted-foreground" : "text-muted-foreground/40"}`}
                  >
                    {eye.on ? <Eye className="size-3.5" /> : <EyeSlash className="size-3.5" />}
                  </button>
                )}
              </span>
            </div>
          )
        })}
        {empty && (
          <p className="px-3 py-2 text-body leading-relaxed text-muted-foreground">
            Nothing in the project yet. Place a site on the map, or take an area from the catalogue in the run graph.
          </p>
        )}
      </div>
    </>
  )
}

import { useEffect, useRef, useState } from "react"
import {
  CaretDown,
  CaretRight,
  Eye,
  EyeSlash,
  Fan,
  Lightning,
  MapPin,
  Mountains,
  Pentagon,
  Stack,
  Sun,
  Warning,
  type Icon,
} from "@phosphor-icons/react"
import { running } from "../../lib/analysis"
import { project, renameItem, resultsOf, setHidden, staleReason, type AnyItem } from "../../lib/project"
import { areaStates, setAreaState, showResult } from "../../lib/screen"
import { select, selection } from "../../lib/selection"
import { useStore } from "../../lib/store"
import { openContextMenu, renaming, type MenuItem } from "../../lib/ui"
import { StudioHeaderToggle } from "../studio/HeaderControls"
import { AreaHeader } from "../studio/StudioArea"

/**
 * The project's outliner, as TERRA's BoardSidebar: a tree of what is on the
 * map, carrying only the toggle that is binary and worth reading at a glance.
 * Everything with a value attached is edited in Properties, for whichever row
 * is active, so the tree's cost does not grow with the number of results.
 */

const ICON: Record<AnyItem["kind"], Icon> = { site: MapPin, area: Pentagon, solar: Sun, wind: Fan, terrain: Mountains }
const KIND: Record<AnyItem["kind"], string> = { site: "Site", area: "Area", solar: "Solar", wind: "Wind", terrain: "Terrain" }

type Mode = "scene" | "results"

type Row = {
  item: AnyItem
  depth: number
  expandable: boolean
  /** The source's name, beside a result listed away from it. */
  note?: string
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
  if (item.kind === "area") return [op("TERRAIN"), ...common]
  return [
    { type: "action", label: "Read it", run: () => showResult(item.id, item.kind) },
    op("RERUN", "Run again"),
    { type: "sep" },
    op("EXPORT_CSV"),
    op("EXPORT_JSON"),
    ...(item.kind === "terrain" ? [op("EXPORT_GEOTIFF")] : []),
    ...common,
  ]
}

export function OutlinerEditor({ areaId }: { areaId: string }) {
  const { data } = useStore(project)
  const { id: selected } = useStore(selection)
  const editing = useStore(renaming)
  const job = useStore(running)
  const state = useStore(areaStates)[areaId] ?? {}
  const mode = (state.mode as Mode | undefined) ?? "scene"
  const onlyVisible = !!state.onlyVisible
  const collapsed = new Set((state.collapsed as string[] | undefined) ?? [])
  const rowRefs = useRef(new Map<string, HTMLElement>())
  const [draft, setDraft] = useState("")

  const rows: Row[] = []
  if (mode === "scene") {
    for (const o of [...data.sites, ...data.areas]) {
      if (onlyVisible && o.hidden) continue
      const results = resultsOf(data, o.id).filter((r) => !onlyVisible || !r.hidden)
      rows.push({ item: o, depth: 0, expandable: results.length > 0 })
      if (collapsed.has(o.id)) continue
      for (const r of [...results].reverse()) rows.push({ item: r, depth: 1, expandable: false })
    }
  } else {
    for (const r of [...data.results].reverse()) {
      if (onlyVisible && r.hidden) continue
      const source = [...data.sites, ...data.areas].find((o) => o.id === r.sourceId)
      rows.push({ item: r, depth: 0, expandable: false, note: source?.name ?? "deleted" })
    }
  }

  // The row selected elsewhere, on the map, is scrolled to.
  useEffect(() => {
    if (selected) rowRefs.current.get(selected)?.scrollIntoView({ block: "nearest" })
  }, [selected])

  useEffect(() => {
    if (editing) {
      const item = rows.find((r) => r.item.id === editing)?.item
      if (item) setDraft(item.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const toggle = (id: string) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setAreaState(areaId, { collapsed: [...next] })
  }

  const commitName = (id: string) => {
    renaming.set(null)
    renameItem(id, draft)
    rowRefs.current.get(id)?.focus()
  }

  // The tree's keys: up and down walk the rows, right opens, left closes or steps to the parent.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.item.id === selected)
    const go = (to: Row | undefined) => {
      if (!to) return
      e.preventDefault()
      select(to.item.id)
      rowRefs.current.get(to.item.id)?.focus()
    }
    if (e.key === "ArrowDown") return go(rows[i + 1] ?? rows[0])
    if (e.key === "ArrowUp") return go(rows[Math.max(0, i - 1)])
    if (i < 0) return
    const row = rows[i]
    if (e.key === "F2" || e.key === "Enter") {
      e.preventDefault()
      renaming.set(row.item.id)
    } else if (e.key === "ArrowRight" && row.expandable && collapsed.has(row.item.id)) {
      e.preventDefault()
      toggle(row.item.id)
    } else if (e.key === "ArrowLeft") {
      if (row.expandable && !collapsed.has(row.item.id)) {
        e.preventDefault()
        toggle(row.item.id)
      } else if (row.depth > 0) {
        for (let j = i - 1; j >= 0; j--) if (rows[j].depth < row.depth) return go(rows[j])
      }
    }
  }

  const total = mode === "scene" ? data.sites.length + data.areas.length : data.results.length
  const shown = mode === "scene" ? [...data.sites, ...data.areas].filter((o) => !o.hidden).length : data.results.filter((r) => !r.hidden).length

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
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5" style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}>
          <div role="tablist" aria-label="What the outliner lists" className="flex gap-0.5">
            {(
              [
                ["scene", "Scene", Stack],
                ["results", "Results", Lightning],
              ] as const
            ).map(([id, label, IconC]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => setAreaState(areaId, { mode: id })}
                className={`flex items-center gap-1 rounded-sm px-1.5 py-1 text-meta transition-colors ${
                  mode === id ? "bg-selected text-foreground" : "text-muted-foreground hover:bg-hover"
                }`}
              >
                <IconC className="size-3" />
                {label}
              </button>
            ))}
          </div>
          <span className="telemetry shrink-0 text-meta text-muted-foreground">{total ? `${shown}/${total}` : null}</span>
        </div>

        <div role="tree" aria-label="The project" onKeyDown={onKeyDown} className="panel-scroll min-h-0 flex-1 overflow-y-auto py-1">
          {rows.map((row, index) => {
            const item = row.item
            const isActive = item.id === selected
            const isOpen = row.expandable && !collapsed.has(item.id)
            const IconC = ICON[item.kind]
            const stale = item.kind === "solar" || item.kind === "wind" || item.kind === "terrain" ? staleReason(data, item) : null
            const busy = !!job && job.sourceId === item.id
            const hasEye = item.kind !== "solar" && item.kind !== "wind"
            return (
              <div
                key={item.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(item.id, el)
                  else rowRefs.current.delete(item.id)
                }}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={isActive}
                aria-expanded={row.expandable ? isOpen : undefined}
                // A roving tab stop: the tree is one stop, not one per row.
                tabIndex={isActive || (!selected && index === 0) ? 0 : -1}
                onClick={() => select(item.id)}
                onDoubleClick={() => renaming.set(item.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  select(item.id)
                  openContextMenu(e, itemMenu(item), item.name)
                }}
                className={`relative flex cursor-default select-none items-center py-[3px] pr-2 transition-colors ${
                  isActive ? "bg-selected" : "hover:bg-hover"
                } ${item.hidden && !isActive ? "opacity-50" : ""}`}
              >
                {/* THE VISIBILITY GUTTER, a column at the head of the row, so every eye lands on one line. */}
                <span className="flex w-6 shrink-0 justify-center">
                  {hasEye && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setHidden(item.id, !item.hidden)
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      tabIndex={isActive ? 0 : -1}
                      aria-pressed={!item.hidden}
                      aria-label={`${item.hidden ? "Show" : "Hide"} ${item.name}`}
                      title={item.hidden ? "Show" : "Hide"}
                      className={`transition-colors hover:text-foreground ${item.hidden ? "text-muted-foreground/40" : "text-muted-foreground"}`}
                    >
                      {item.hidden ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  )}
                </span>

                <div className="flex min-w-0 flex-1 items-center gap-1.5" style={{ paddingLeft: `${row.depth * 0.75}rem` }}>
                  {row.expandable ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden
                      onClick={(e) => {
                        e.stopPropagation()
                        toggle(item.id)
                      }}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {isOpen ? <CaretDown className="size-3" /> : <CaretRight className="size-3" />}
                    </button>
                  ) : (
                    <span className="size-3 shrink-0" />
                  )}
                  <IconC className={`size-3.5 shrink-0 ${isActive ? "text-accent" : "text-muted-foreground"}`} />
                  {editing === item.id ? (
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
                    <span className={`min-w-0 flex-1 truncate text-emphasis ${isActive ? "text-accent" : "text-muted-foreground"}`} title="Double-click to rename">
                      {item.name}
                      {row.note && <span className="ml-1.5 text-meta text-muted-foreground/70">{row.note}</span>}
                    </span>
                  )}
                </div>

                {busy && <span className="mr-1 size-1.5 shrink-0 animate-pulse rounded-[1px] bg-accent" title="Running" />}
                {stale && (
                  <span className="mr-1 shrink-0" style={{ color: "var(--warning)" }} title={`${stale}. Its figures describe the source as it was.`}>
                    <Warning className="size-3" weight="fill" aria-label="Stale" />
                  </span>
                )}
                {/* What the row IS, in a fixed column: muted, because the name is what is scanned for. */}
                <span className="w-[62px] shrink-0 truncate pl-2 text-right text-meta text-muted-foreground/70">{KIND[item.kind]}</span>
              </div>
            )
          })}
          {rows.length === 0 && (
            <p className="px-3 py-2 text-body leading-relaxed text-muted-foreground">
              {mode === "scene"
                ? "Nothing in the project yet. Place a site or draw an area on the map."
                : "No results yet. Run one from Properties with a site or an area active."}
            </p>
          )}
        </div>
      </div>
    </>
  )
}

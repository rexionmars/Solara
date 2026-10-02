import { useState } from "react"
import { ChartBar, Fan, Graph, Mountains, PlugsConnected, PushPin, Sun, Warning, type Icon } from "@phosphor-icons/react"
import { runOperator } from "../../lib/operators"
import { PRODUCT_NAMES, PRODUCT_SUMMARY, findItem, isAreaProduct, isResult, project, resultsOf, staleReason, type AnyItem, type Product, type ProjectData, type ResultObject } from "../../lib/project"
import { areaStates, openRunGraph, setAreaState } from "../../lib/screen"
import { select, useActiveItem } from "../../lib/selection"
import { useStore } from "../../lib/store"
import type { MenuItem } from "../../lib/ui"
import { SolarBody } from "../energy/SolarDocument"
import { TerrainBody } from "../energy/TerrainDocument"
import { WindBody } from "../energy/WindDocument"
import { ConnectionBody } from "../energy/ConnectionDocument"
import { DemandBoard } from "../energy/DemandBoard"
import type { Place } from "../studio/Board"
import { StudioHeaderMenu, StudioHeaderPopoverButton } from "../studio/HeaderControls"
import { StudioMenuGroup, StudioMenuItem, StudioMenuRule, StudioPopover } from "../studio/Popover"
import { AreaHeader } from "../studio/StudioArea"
import { btnPrimary } from "../ui/buttons"

/**
 * A product's reading, as TERRA's Solar result and Wind screening editors:
 * the result is a reading and not a raster, so the reading is the editor.
 *
 * Which result it reads: the one it is pinned to, else the active result of
 * this product, else the newest one of the active site or area, else the
 * newest in the project.
 */

const ICON: Record<Product, Icon> = { solar: Sun, wind: Fan, terrain: Mountains, connection: PlugsConnected, demand: ChartBar }

function shown(d: ProjectData, product: Product, pinned: string | undefined, active: AnyItem | null): ResultObject | null {
  const pin = pinned ? findItem(d, pinned) : null
  if (isResult(pin) && pin.kind === product) return pin
  if (isResult(active) && active.kind === product) return active
  const sourceId = isResult(active) ? active.sourceId : active?.id
  const own = sourceId ? resultsOf(d, sourceId).filter((r) => r.kind === product).at(-1) : undefined
  return own ?? d.results.filter((r) => r.kind === product).at(-1) ?? null
}

const exportMenu = (): MenuItem[] => [
  { type: "op", op: "EXPORT_CSV", label: "As CSV…" },
  { type: "op", op: "EXPORT_JSON", label: "As JSON…" },
  { type: "op", op: "EXPORT_GEOTIFF", label: "Layer as GeoTIFF…" },
]

export function ReadingEditor({ areaId, product }: { areaId: string; product: Product }) {
  const d = useStore(project).data
  const active = useActiveItem()
  const pinned = useStore(areaStates)[areaId]?.pinned as string | undefined
  const result = shown(d, product, pinned, active)
  const stale = result ? staleReason(d, result) : null
  const [picker, setPicker] = useState(false)
  const all = d.results.filter((r) => r.kind === product)

  /*
    Where the reader has dragged each card, per result: two runs of the same
    product are two boards, because comparing them means arranging them
    differently. Kept in the area's state, so it is this window's arrangement
    and not the project's -- another window reading the same result is free to
    lay it out its own way.
  */
  const boards = (useStore(areaStates)[areaId]?.boards ?? {}) as Record<string, Record<string, Place>>
  const moveCard = (resultId: string, cardId: string, place: Place) =>
    setAreaState(areaId, {
      boards: { ...boards, [resultId]: { ...boards[resultId], [cardId]: place } },
    })
  const resetBoard = (resultId: string) => {
    const { [resultId]: _dropped, ...rest } = boards
    setAreaState(areaId, { boards: rest })
  }

  // Operators act on the active item; one started from this header acts on the reading on screen.
  const onShown = (name: string) => {
    if (!result) return
    select(result.id)
    void runOperator(name)
  }

  /*
    A READING IS EITHER A DOCUMENT OR A BOARD, and the reading says which.
    A document is scrolled inside a measured column; a board owns the whole
    area and is panned. Wrapping a board in the document's scroller would give
    it a height of zero, so the two are laid out by different branches rather
    than by one container that tries to serve both.
  */
  const boarded = result?.kind === "demand"

  // A value rather than a component declared here, which would remount the reading on every render.
  const body = !result ? null : result.kind === "solar" ? (
    <SolarBody solar={result.data} site={result.site} />
  ) : result.kind === "wind" ? (
    <WindBody wind={result.data} site={result.site} />
  ) : result.kind === "terrain" ? (
    <TerrainBody terrain={result.data} area={result.polygon} />
  ) : result.kind === "connection" ? (
    <ConnectionBody connection={result.data} area={result.polygon} />
  ) : (
    <DemandBoard
      demand={result.data}
      area={result.polygon}
      places={boards[result.id]}
      onMove={(id, place) => moveCard(result.id, id, place)}
      onReset={() => resetBoard(result.id)}
    />
  )

  return (
    <>
      <AreaHeader
        menus={
          <>
            <StudioPopover
              open={picker}
              onOpenChange={setPicker}
              widthRem={17}
              trigger={(t) => (
                <StudioHeaderPopoverButton
                  triggerRef={t.ref}
                  onClick={t.onClick}
                  icon={pinned ? PushPin : undefined}
                  // The source, not the result's name: the area header already says which product this is.
                  label={result ? `${findItem(d, result.sourceId)?.name ?? "deleted source"} · ${result.createdAt.slice(5, 16).replace("T", " ")}` : "No result"}
                  showLabel
                  open={picker}
                  title="Which result this area reads"
                  className="max-w-[14rem]"
                />
              )}
            >
              <StudioMenuItem
                label="Follow the active item"
                checked={!pinned}
                title="Read whatever is selected, or the newest result of it"
                onSelect={() => {
                  setAreaState(areaId, { pinned: undefined })
                  setPicker(false)
                }}
              />
              <StudioMenuRule />
              <StudioMenuGroup label={`${PRODUCT_NAMES[product]} results`}>
                {all.length ? (
                  [...all].reverse().map((r) => (
                    <StudioMenuItem
                      key={r.id}
                      icon={staleReason(d, r) ? Warning : undefined}
                      label={`${r.name} · ${findItem(d, r.sourceId)?.name ?? "deleted"}`}
                      note={r.createdAt.slice(5, 16).replace("T", " ")}
                      checked={pinned === r.id}
                      title="Pin this area to this result"
                      onSelect={() => {
                        setAreaState(areaId, { pinned: r.id })
                        setPicker(false)
                      }}
                    />
                  ))
                ) : (
                  <p className="px-2 py-1.5 text-micro text-muted-foreground">None yet.</p>
                )}
              </StudioMenuGroup>
            </StudioPopover>
            <StudioHeaderMenu label="Export" items={exportMenu} />
          </>
        }
        options={
          result && (
            <button
              type="button"
              onClick={() => onShown("RERUN")}
              title="Compute this product again at its source, with the settings as they are now"
              className="flex h-5 shrink-0 items-center rounded-sm px-1.5 text-meta text-foreground transition-colors hover:bg-hover"
            >
              Run again
            </button>
          )
        }
      />
      {!result ? (
        <div className="panel-scroll @container h-full min-h-0 overflow-y-auto">
          <Empty product={product} />
        </div>
      ) : boarded ? (
        // The board fills the area and is never scrolled. The staleness notice
        // floats over it, centred at the top, because a board has no "above".
        <div className="relative h-full min-h-0">
          {body}
          {stale && (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
              <StaleNotice stale={stale} onRerun={() => onShown("RERUN")} floating />
            </div>
          )}
        </div>
      ) : (
        <div className="panel-scroll @container h-full min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 pb-12 pt-5">
            {stale && (
              <div className="mb-4">
                <StaleNotice stale={stale} onRerun={() => onShown("RERUN")} />
              </div>
            )}
            {body}
          </div>
        </div>
      )}
    </>
  )
}

/** The source moved after the run. Said once, in the same words on either layout. */
function StaleNotice({ stale, onRerun, floating }: { stale: string; onRerun: () => void; floating?: boolean }) {
  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 rounded-md px-3 py-2 text-body ${floating ? "border border-white/[0.07] shadow-lg backdrop-blur" : ""}`}
      style={{ background: floating ? "rgb(52 46 18 / 0.92)" : "rgb(213 190 75 / 0.12)", color: "var(--warning)" }}
      role="status"
    >
      <Warning className="size-3.5 shrink-0" weight="fill" />
      <span className="flex-1">{stale}. The figures describe the source as it was when computed.</span>
      <button type="button" onClick={onRerun} className="shrink-0 rounded-sm px-1.5 py-0.5 text-meta hover:bg-hover">
        Run again
      </button>
    </div>
  )
}

/*
  WHAT AN EMPTY READING SAYS, AND WHAT IT MUST NOT DO.

  It says what the product is, in the one sentence PRODUCT_SUMMARY holds, and
  it sends the reader to the run graph. It does NOT run anything.

  A RUN IS SET UP IN ONE PLACE. The graph shows every input of a request at
  once, each with the state of its own wire, which is what makes the request
  legible before it is spent. A button here ran the same product with none of
  that on screen, so the reader pressed without seeing the ground, the
  register or the settings it would use -- and a second place to press is a
  second place for the two to disagree. The canvas exists to stop that, so
  this screen points at it instead of competing with it.
*/

function Empty({ product }: { product: Product }) {
  const IconC = ICON[product]
  const on = isAreaProduct(product) ? "an area" : "a site"
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 px-6 py-16">
      <div className="flex items-center gap-2">
        <IconC className="size-4 text-muted-foreground/60" />
        <p className="eyebrow">{PRODUCT_NAMES[product]}</p>
      </div>
      <p className="text-body leading-relaxed">{PRODUCT_SUMMARY[product]}</p>
      <p className="text-meta leading-relaxed text-muted-foreground">
        No reading yet. A run is set up in the run graph, where {on} and every setting it reads are on one board; what it
        produces is read back here, and stays in the project to be compared.
      </p>
      <button type="button" onClick={() => openRunGraph(product)} className={`${btnPrimary} self-start`}>
        <Graph className="size-3.5" />
        Set up a run
      </button>
    </div>
  )
}

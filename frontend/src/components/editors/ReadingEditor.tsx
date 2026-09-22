import { useState } from "react"
import { ChartBar, Fan, Mountains, PlugsConnected, PushPin, Sun, Warning, type Icon } from "@phosphor-icons/react"
import { RUN_OPERATOR, runOperator } from "../../lib/operators"
import { PRODUCT_NAMES, findItem, isAreaProduct, isResult, project, resultsOf, staleReason, type AnyItem, type Product, type ProjectData, type ResultObject } from "../../lib/project"
import { areaStates, setAreaState } from "../../lib/screen"
import { select, useActiveItem } from "../../lib/selection"
import { useStore } from "../../lib/store"
import type { MenuItem } from "../../lib/ui"
import { SolarBody } from "../energy/SolarDocument"
import { TerrainBody } from "../energy/TerrainDocument"
import { WindBody } from "../energy/WindDocument"
import { ConnectionBody } from "../energy/ConnectionDocument"
import { DemandBody } from "../energy/DemandDocument"
import { StudioHeaderMenu, StudioHeaderPopoverButton } from "../studio/HeaderControls"
import { StudioMenuGroup, StudioMenuItem, StudioMenuRule, StudioPopover } from "../studio/Popover"
import { AreaHeader } from "../studio/StudioArea"
import { OperatorButton } from "../ui/Fields"

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

  // Operators act on the active item; one started from this header acts on the reading on screen.
  const onShown = (name: string) => {
    if (!result) return
    select(result.id)
    void runOperator(name)
  }

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
    <DemandBody demand={result.data} area={result.polygon} />
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
      <div className="panel-scroll @container h-full min-h-0 overflow-y-auto">
        {!result ? (
          <Empty product={product} />
        ) : (
          <div className="mx-auto max-w-4xl px-6 pb-12 pt-5">
            {stale && (
              <div
                className="mb-4 flex items-center gap-2 rounded-sm px-3 py-2 text-body"
                style={{ background: "rgb(213 190 75 / 0.12)", color: "var(--warning)" }}
                role="status"
              >
                <Warning className="size-3.5 shrink-0" weight="fill" />
                <span className="flex-1">{stale}. The figures below describe the source as it was when computed.</span>
                <button type="button" onClick={() => onShown("RERUN")} className="shrink-0 rounded-sm px-1.5 py-0.5 text-meta hover:bg-hover">
                  Run again
                </button>
              </div>
            )}
            {body}
          </div>
        )}
      </div>
    </>
  )
}

function Empty({ product }: { product: Product }) {
  const IconC = ICON[product]
  const on = isAreaProduct(product) ? "an area" : "a site"
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-4 py-16 text-center">
      <IconC className="size-5 text-muted-foreground/60" />
      <p className="eyebrow">{PRODUCT_NAMES[product]}</p>
      <p className="text-body leading-relaxed text-muted-foreground">
        No reading yet. Make {on} active and run it here or from its card in Properties; every run stays in the project to be read
        and compared.
      </p>
      <OperatorButton name={RUN_OPERATOR[product]} primary />
    </div>
  )
}

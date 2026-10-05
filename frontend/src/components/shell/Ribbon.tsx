import { useState, type ReactNode } from "react"
import { CaretDown, CaretUp, Crosshair, Cube, GlobeHemisphereWest, Graph, type Icon } from "../../lib/icons"
import { STUDIO_GROUPS, editorMeta } from "../../lib/editors"
import { findOperator, formatKeys, pollOperator, runOperator, usePollTick } from "../../lib/operators"
import { PRODUCT_NAMES, type Product } from "../../lib/project"
import { WORKSPACES, openRunGraph, screen, setWorkspace } from "../../lib/screen"
import { artSrc, operatorArt } from "../../lib/art"
import { useStore } from "../../lib/store"
import { activeTool, basemap, overlays, type ToolId } from "../../lib/tools"
import { coordinatePrompt, ribbonCollapsed, ribbonTab, toggleRibbon, type RibbonTab } from "../../lib/ui"
import { useProductOffered } from "../../lib/capabilities"
import { BASEMAP_ITEMS } from "../editors/MapEditor"
import { StudioMenuItem, StudioMenuRule, StudioPopover } from "../studio/Popover"
import { AppMenu, ProjectMenu } from "./AppMenus"

/**
 * The ribbon: the application's commands by kind, in tabs, and under the open
 * tab its commands in named groups, as a GIS desktop lays them out.
 *
 * A TAB IS A KIND OF COMMAND, NOT AN ARRANGEMENT. The strip this replaced had
 * one tab per workspace, nine of them, so the row said how the window was
 * divided and nothing about what could be done in it. Four tabs now answer
 * the second question -- the map, the analyses, the window, what leaves the
 * application -- and the nine arrangements are a group of the View tab, where
 * they are still all on screen at once, under their subjects.
 *
 * NOTHING HERE IS NEW. Every button runs an operator the menus already ran,
 * flips an overlay the map's popover already flipped, or opens a workspace
 * the old strip opened, and reads its label from the same table. The ribbon
 * is a way to reach them that can be seen without opening anything, which is
 * the whole of what it adds.
 *
 * A RUN BUTTON OPENS THE RUN GRAPH; it does not spend the run. A request is
 * five or six settings, and the board is where they are all on screen at once.
 */

export const RIBBON_TABS_PX = 28
export const RIBBON_PX = 62

const TABS: { id: RibbonTab; label: string; hint: string }[] = [
  { id: "map", label: "Map", hint: "Move over the map, place sites and areas, and choose what is drawn on it" },
  { id: "analysis", label: "Analysis", hint: "The five readings, by subject, and the run in progress" },
  { id: "view", label: "View", hint: "The window's arrangements, by subject, and what the window shows" },
  { id: "share", label: "Share", hint: "What leaves the application: results, tables and the project file" },
]


const TOOL_OF: Record<string, ToolId> = { TOOL_SELECT: "select", TOOL_SITE: "site", TOOL_MEASURE: "measure" }

/** A product's entrance, named as its workspace names it. */
const RUN_LABEL: Record<Product, string> = {
  solar: "Resource",
  terrain: "Terrain",
  wind: "Screening",
  connection: "Connection",
  demand: "Consumption",
}

const TABLES: Product[] = ["solar", "terrain", "wind", "connection", "demand"]

function tone(on: boolean | undefined, disabled: boolean | undefined): string {
  if (disabled) return "cursor-not-allowed text-muted-foreground/40"
  if (on) return "bg-selected text-foreground"
  return "text-foreground/85 hover:bg-hover hover:text-foreground"
}

// Which drawing each product and workspace asks for; the operators' are in lib/art.ts .
const ART_BY_PRODUCT: Record<Product, string> = { solar: "solar", terrain: "terrain", wind: "wind", connection: "connection", demand: "demand" }
/** A workspace is drawn as what it is built around: the product's art, or the editor's. */
const ART_BY_WORKSPACE: Record<string, string> = {
  layout: "layout",
  graph: "run-graph",
  data: "data",
  scripting: "scripting",
  solar: "solar",
  terrain: "terrain",
  wind: "wind",
  connection: "connection",
  demand: "demand",
}

/** One command. Tall, it is a group's principal verb; short, three of them stack in a column. */
function Command({
  icon: IconC,
  art,
  label,
  title,
  tall,
  on,
  disabled,
  check,
  onClick,
  buttonRef,
  expanded,
}: {
  icon?: Icon
  /** The drawing that stands in for the glyph, by its file name. */
  art?: string
  label: string
  title: string
  tall?: boolean
  on?: boolean
  disabled?: boolean
  /** Draws the on state as a ticked box instead of a lit button: a layer, not a mode. */
  check?: boolean
  onClick: () => void
  buttonRef?: React.Ref<HTMLButtonElement>
  expanded?: boolean
}) {
  if (tall) {
    return (
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-pressed={on}
        aria-expanded={expanded}
        onClick={onClick}
        className={`flex min-w-11 shrink-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-meta transition-colors ${tone(on, disabled)}`}
      >
        {artSrc(art) ? (
          // Greyed with the command: a colour that stayed lit would say it can be pressed.
          <img src={artSrc(art)} alt="" draggable={false} className={`size-5 shrink-0 ${disabled ? "opacity-40 grayscale" : ""}`} />
        ) : (
          IconC && <IconC className="size-[18px] shrink-0" />
        )}
        {label}
      </button>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-[15px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 text-left text-meta transition-colors ${tone(!check && on, disabled)}`}
    >
      {check ? (
        <span
          className="flex size-2.5 shrink-0 items-center justify-center rounded-[2px] border"
          style={{ borderColor: "rgb(var(--p-line-strong) / 0.6)" }}
          aria-hidden
        >
          {on && <span className="size-1.5 rounded-[1px] bg-accent" />}
        </span>
      ) : artSrc(art) ? (
        <img src={artSrc(art)} alt="" draggable={false} className={`size-3.5 shrink-0 ${disabled ? "opacity-40 grayscale" : ""}`} />
      ) : (
        IconC && <IconC className="size-3 shrink-0 text-muted-foreground" />
      )}
      {label}
    </button>
  )
}

/** A command that runs an operator: greyed with the operator's own reason, and its key in the tooltip. */
function Op({ name, args, label, tall }: { name: string; args?: string[]; label?: string; tall?: boolean }) {
  usePollTick()
  const tool = useStore(activeTool)
  const op = findOperator(name)
  if (!op) return null
  const poll = pollOperator(op)
  const key = op.keys?.[0] ? ` (${formatKeys(op.keys[0])})` : ""
  return (
    <Command
      icon={op.icon}
      art={operatorArt(op.name)}
      label={label ?? op.label.replace(/…$/, "")}
      title={poll === true ? `${op.description}${key}` : poll}
      tall={tall}
      on={TOOL_OF[op.name] === tool}
      disabled={poll !== true}
      onClick={() => void runOperator(op.name, args)}
    />
  )
}

/** The ground the map draws, and the relief under it. */
function Basemap() {
  const ground = useStore(basemap)
  const o = useStore(overlays)
  const [open, setOpen] = useState(false)
  return (
    <StudioPopover
      open={open}
      onOpenChange={setOpen}
      widthRem={15}
      trigger={(t) => (
        <Command
          buttonRef={t.ref as React.Ref<HTMLButtonElement>}
          icon={GlobeHemisphereWest}
          art="basemap"
          label="Basemap"
          title="The ground the map draws"
          tall
          expanded={t["aria-expanded"]}
          onClick={t.onClick}
        />
      )}
    >
      {BASEMAP_ITEMS.map((it) => (
        <StudioMenuItem
          key={it.id}
          label={it.label}
          checked={it.id === ground}
          onSelect={() => {
            basemap.set(it.id)
            setOpen(false)
          }}
        />
      ))}
      <StudioMenuRule />
      <StudioMenuItem
        label="Hillshade"
        checked={o.hillshade}
        onSelect={() => overlays.set((cur) => ({ ...cur, hillshade: !cur.hillshade }))}
      />
    </StudioPopover>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col border-r px-1.5" style={{ borderColor: "rgb(var(--p-line) / 0.3)" }}>
      <div role="group" aria-label={label} className="flex min-h-0 flex-1 items-stretch gap-0.5 pt-1">
        {children}
      </div>
      <p className="eyebrow !text-[9px] text-center leading-[13px]">{label}</p>
    </div>
  )
}

/** Up to three short commands, one over the other. */
function Column({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-col justify-center gap-px">{children}</div>
}

function Run({ product }: { product: Product }) {
  // A product the connected store could never answer is not offered.
  if (!useProductOffered(product)) return null
  return (
    <Command
      icon={editorMeta(product).icon}
      art={ART_BY_PRODUCT[product]}
      label={RUN_LABEL[product]}
      title={`Set up ${PRODUCT_NAMES[product]} in the run graph`}
      tall
      onClick={() => openRunGraph(product)}
    />
  )
}

// ---- The tabs' bodies ---------------------------------------------------------

function MapTab() {
  return (
    <>
      <Group label="Edit">
        <Column>
          <Op name="UNDO" />
          <Op name="REDO" />
        </Column>
      </Group>
      <Group label="Object">
        <Column>
          <Op name="RENAME" label="Rename" />
          <Op name="HIDE" label="Hide / show" />
          <Op name="UNHIDE_ALL" />
        </Column>
        <Column>
          <Op name="SELECT_NONE" />
          <Op name="LEGEND" label="Legend" />
          <Op name="DELETE" />
        </Column>
      </Group>
      <Group label="Navigate">
        <Op name="TOOL_SELECT" tall />
        <Column>
          <Op name="FRAME_ALL" />
          <Op name="FRAME_SELECTED" />
          <Op name="NORTH" />
        </Column>
        <Column>
          <Op name="ZOOMIN" />
          <Op name="ZOOMOUT" />
        </Column>
      </Group>
      <Group label="Place">
        <Op name="TOOL_SITE" label="Site" tall />
        <Op name="AREA_PLACE" label="Area" tall />
        <Column>
          <Command
            icon={Crosshair}
            art="coordinates"
            label="At coordinates"
            title="Add a site by typing its latitude and longitude"
            onClick={() => coordinatePrompt.set(true)}
          />
        </Column>
      </Group>
      <Group label="Layer">
        <Basemap />
      </Group>
      <Group label="Inquiry">
        <Op name="TOOL_MEASURE" tall />
        <Op name="LOCATE" tall />
      </Group>
    </>
  )
}

function AnalysisTab() {
  return (
    <>
      <Group label="Solar">
        <Run product="solar" />
        <Run product="terrain" />
      </Group>
      <Group label="Wind">
        <Run product="wind" />
      </Group>
      <Group label="Grid">
        <Run product="connection" />
        <Run product="demand" />
        <Column>
          <Op name="GRID_STORE" label="Check the store" />
        </Column>
      </Group>
      <Group label="Run">
        <Command
          icon={Graph}
          art="run-graph"
          label="Run graph"
          title="Open the run graph: choose the product, the place and the settings, and see what a run would read"
          tall
          onClick={() => openRunGraph()}
        />
        <Column>
          <Op name="RERUN" label="Run again" />
          <Op name="CANCEL" label="Cancel" />
          <Op name="ADJUST_LAST" label="Adjust last" />
        </Column>
      </Group>
      <Group label="Engine">
        <Op name="PING" label="Check" tall />
      </Group>
    </>
  )
}

function ViewTab() {
  const s = useStore(screen)
  return (
    <>
      {STUDIO_GROUPS.map((g) => {
        const members = WORKSPACES.filter((w) => w.group === g.id)
        if (!members.length) return null
        return (
          <Group key={g.id} label={g.label}>
            {members.map((w) => (
              <Command
                key={w.id}
                icon={w.icon}
                art={ART_BY_WORKSPACE[w.id]}
                label={w.label}
                title={w.hint}
                tall
                on={w.id === s.active}
                onClick={() => setWorkspace(w.id)}
              />
            ))}
          </Group>
        )
      })}
      <Group label="Window">
        <Column>
          <Op name="RESET_LAYOUT" label="Reset this workspace" />
          <Op name="FULLSCREEN" label="Fullscreen" />
          <Op name="SEARCH" label="Search operators" />
        </Column>
      </Group>
    </>
  )
}

function ShareTab() {
  return (
    <>
      <Group label="Active result">
        <Column>
          <Op name="EXPORT_CSV" label="As CSV" />
          <Op name="EXPORT_JSON" label="As JSON" />
          <Op name="EXPORT_GEOTIFF" label="Terrain layer as GeoTIFF" />
        </Column>
      </Group>
      <Group label="Comparison tables, as CSV">
        {[TABLES.slice(0, 3), TABLES.slice(3)].map((col) => (
          <Column key={col[0]}>
            {col.map((p) => (
              <Op key={p} name="EXPORT_TABLE" args={[p]} label={PRODUCT_NAMES[p]} />
            ))}
          </Column>
        ))}
      </Group>
      <Group label="Project">
        <Op name="SAVE" tall />
        <Column>
          <Op name="SAVEAS" />
          <Op name="REVEAL_PROJECT" label="Reveal the file" />
        </Column>
      </Group>
    </>
  )
}

const BODY: Record<RibbonTab, () => React.ReactElement> = {
  map: MapTab,
  analysis: AnalysisTab,
  view: ViewTab,
  share: ShareTab,
}

export function Ribbon() {
  const tab = useStore(ribbonTab)
  const folded = useStore(ribbonCollapsed)
  const Body = BODY[tab]

  return (
    <>
      <div
        className="relative flex shrink-0 items-stretch gap-0.5 border-b px-1"
        style={{ height: RIBBON_TABS_PX, background: "var(--s-chrome)", borderColor: "rgb(var(--p-line) / 0.28)" }}
      >
        {/* The application's own tab, filled, where a GIS desktop keeps Project. */}
        <AppMenu
          trigger={(t) => (
            <button
              ref={t.ref as React.Ref<HTMLButtonElement>}
              type="button"
              onClick={t.onClick}
              aria-expanded={t["aria-expanded"]}
              aria-haspopup="menu"
              title="Studio: the project, settings and everything not about one tab"
              className="my-[3px] flex shrink-0 items-center gap-1 rounded-sm bg-primary px-2.5 text-meta font-semibold text-primary-foreground"
            >
              <Cube className="size-3.5" />
              Studio
            </button>
          )}
        />

        <nav className="ml-1 flex min-w-0 flex-1 items-stretch gap-px" role="tablist" aria-label="Ribbon">
          {TABS.map((t) => {
            const on = t.id === tab && !folded
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                title={t.hint}
                // A tab opens its commands; the open tab, asked again, folds them away.
                onClick={() => {
                  if (folded) toggleRibbon()
                  ribbonTab.set(t.id)
                }}
                onDoubleClick={toggleRibbon}
                className={`relative -mb-px flex shrink-0 items-center whitespace-nowrap px-3 text-meta transition-colors ${
                  on ? "text-accent" : "text-muted-foreground hover:text-foreground"
                }`}
                style={
                  on
                    ? // The ground of the ribbon below: the tab and its commands are one surface.
                      { background: "var(--s-panel-head)", borderTopLeftRadius: 3, borderTopRightRadius: 3 }
                    : undefined
                }
              >
                {t.label}
              </button>
            )
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          <ProjectMenu />
          <button
            type="button"
            onClick={() => void runOperator("TOGGLE_RIBBON")}
            aria-expanded={!folded}
            aria-label={folded ? "Show the ribbon" : "Fold the ribbon"}
            title={`${folded ? "Show the ribbon" : "Fold the ribbon"} (${formatKeys("Ctrl+F1")})`}
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            {folded ? <CaretDown className="size-3" /> : <CaretUp className="size-3" />}
          </button>
        </div>
      </div>

      {!folded && (
        <div
          className="app-no-drag flex shrink-0 items-stretch overflow-x-auto border-b px-1"
          style={{
            height: RIBBON_PX,
            background: "var(--s-panel-head)",
            borderColor: "rgb(var(--p-line) / 0.28)",
            scrollbarWidth: "none",
          }}
          role="tabpanel"
          aria-label={TABS.find((t) => t.id === tab)?.label}
        >
          <Body />
        </div>
      )}
    </>
  )
}

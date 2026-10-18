import { useState, type ReactNode } from "react"
import {
  CaretDown,
  CaretUp,
  Crosshair,
  Cube,
  GlobeHemisphereWest,
  Graph,
  FilePlus,
  FolderOpen,
  FloppyDisk,
  Play,
  StopCircle,
  Scroll,
  Table,
  SlidersHorizontal,
  type Icon,
} from "../../lib/icons"
import { editorMeta } from "../../lib/editors"
import { findOperator, formatKeys, pollOperator, runOperator, usePollTick } from "../../lib/operators"
import { PRODUCT_NAMES, project, type Product } from "../../lib/project"
import {
  activeTree,
  areaStates,
  leaves,
  openReading,
  openRunGraph,
  screen,
  setAreaState,
  setWorkspace,
  toggleMaximized,
} from "../../lib/screen"
import { RIBBON_TABS, ribbonContext, resolveRibbonTab } from "../../lib/ribbonContext"
import { planning, planningHasPendingProfiles, runPlanning, cancelPlanning } from "../../lib/planning"
import { running } from "../../lib/analysis"
import { exportTableCsv } from "../../lib/export"
import { usePlanningFiles } from "../editors/usePlanningFiles"
import { artSrc, operatorArt } from "../../lib/art"
import { useStore } from "../../lib/store"
import { activeTool, basemap, overlays, type ToolId } from "../../lib/tools"
import { coordinatePrompt, ribbonCollapsed, workspaceRibbonTabs, toggleRibbon } from "../../lib/ui"
import { useProductOffered } from "../../lib/capabilities"
import { BASEMAP_ITEMS } from "../editors/MapEditor"
import { StudioMenuItem, StudioMenuRule, StudioPopover } from "../studio/Popover"
import { AppMenu, ProjectMenu } from "./AppMenus"

/** Commands grouped by activity. WorkspaceBar switches panel layouts separately. */

export const RIBBON_TABS_PX = 28
export const RIBBON_PX = 62

const TOOL_OF: Record<string, ToolId> = { TOOL_SELECT: "select", TOOL_SITE: "site", TOOL_MEASURE: "measure" }

/** A product's entrance, named as its workspace names it. */
const RUN_LABEL: Record<Product, string> = {
  solar: "Resource",
  terrain: "Terrain",
  wind: "Screening",
  connection: "Connection",
  demand: "Consumption",
  ground: "Usable ground",
}

const TABLES: Product[] = ["solar", "terrain", "wind", "connection", "demand", "ground"]

function tone(on: boolean | undefined, disabled: boolean | undefined): string {
  if (disabled) return "cursor-not-allowed text-muted-foreground/40"
  if (on) return "bg-selected text-foreground"
  return "text-foreground/85 hover:bg-hover hover:text-foreground"
}

// Which drawing each product and workspace asks for; the operators' are in lib/art.ts .
const ART_BY_PRODUCT: Record<Product, string> = {
  solar: "solar",
  terrain: "terrain",
  wind: "wind",
  connection: "connection",
  demand: "demand",
  ground: "ground",
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
          <img
            src={artSrc(art)}
            alt=""
            draggable={false}
            className={`size-5 shrink-0 ${disabled ? "opacity-40 grayscale" : ""}`}
          />
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
        <img
          src={artSrc(art)}
          alt=""
          draggable={false}
          className={`size-3.5 shrink-0 ${disabled ? "opacity-40 grayscale" : ""}`}
        />
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
      portal="viewport"
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
    <div
      className="flex shrink-0 flex-col border-r px-1.5"
      style={{ borderColor: "rgb(var(--p-line) / 0.3)" }}
    >
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

/**
 * A product's entrance since the run graph became a second view: the
 * workspace of its reading, where an empty reading lists what a run would
 * read and carries the button, and Properties holds the settings beside it.
 */
function Reading({ product }: { product: Product }) {
  if (!useProductOffered(product)) return null
  return (
    <Command
      icon={editorMeta(product).icon}
      art={ART_BY_PRODUCT[product]}
      label={RUN_LABEL[product]}
      title={`${PRODUCT_NAMES[product]}: what a run reads over the active area, and its reading`}
      tall
      onClick={() => openReading(product)}
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

function AnalysisTab({ products }: { products: Product[] }) {
  return (
    <>
      {products.some((p) => p === "solar" || p === "terrain") && (
        <Group label="Solar">
          {products.includes("solar") && <Reading product="solar" />}
          {products.includes("terrain") && <Reading product="terrain" />}
        </Group>
      )}
      {products.includes("wind") && (
        <Group label="Wind">
          <Reading product="wind" />
        </Group>
      )}
      {products.some((p) => p === "connection" || p === "demand") && (
        <Group label="Grid">
          <Command
            icon={Graph}
            art="run-graph"
            label="Planning"
            title="Open PyPSA system planning"
            tall
            onClick={() => setWorkspace("planning")}
          />
          {products.includes("connection") && <Reading product="connection" />}
          {products.includes("demand") && <Reading product="demand" />}
          <Column>
            <Op name="GRID_STORE" label="Check the store" />
          </Column>
        </Group>
      )}
      {products.includes("ground") && (
        <Group label="Ground">
          <Reading product="ground" />
          <Column>
            <Op name="GROUND" label="Run on the area" />
          </Column>
        </Group>
      )}
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
  const state = useStore(screen)
  const panels = leaves(activeTree())
  return (
    <>
      <Group label="Panels">
        {panels.map((panel) => {
          const meta = editorMeta(panel.editor)
          return (
            <Command
              key={panel.id}
              icon={meta.icon}
              label={meta.label}
              title={`Show ${meta.label} alone; click again to restore the layout`}
              tall
              on={state.maximized === panel.id}
              onClick={() => toggleMaximized(panel.id)}
            />
          )
        })}
      </Group>
      <Group label="Layout">
        <Column>
          <Op name="RESET_LAYOUT" label="Reset this workspace" />
          <Op name="FULLSCREEN" label="Fullscreen" />
        </Column>
      </Group>
    </>
  )
}

function ShareTab({ products }: { products: Product[] }) {
  return (
    <>
      <Group label="Active result">
        <Column>
          <Op name="EXPORT_CSV" label="As CSV" />
          <Op name="EXPORT_JSON" label="As JSON" />
          {products.some((p) => p === "terrain" || p === "ground") && (
            <Op name="EXPORT_GEOTIFF" label="Layer as GeoTIFF" />
          )}
        </Column>
      </Group>
      <Group label="Comparison tables, as CSV">
        {[products.slice(0, 3), products.slice(3)]
          .filter((col) => col.length)
          .map((col) => (
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

function PlanningStudyTab() {
  const state = useStore(planning)
  const files = usePlanningFiles()
  const pending = planningHasPendingProfiles()
  return (
    <>
      {files.input}
      <Group label="Study">
        <Command
          icon={FilePlus}
          art="new"
          label="New study"
          title="Create an empty planning study"
          tall
          disabled={state.busy}
          onClick={files.newStudy}
        />
        <Command
          icon={FolderOpen}
          art="folder-open"
          label="Import"
          title="Import a planning study or run report JSON"
          tall
          disabled={state.busy}
          onClick={files.importStudy}
        />
        <Column>
          <Command
            icon={Graph}
            label="Synthetic example"
            title="Load the fictional two-bus demonstration"
            disabled={state.busy}
            onClick={files.example}
          />
        </Column>
      </Group>
      <Group label="Inputs">
        <Column>
          {[
            { id: "study", label: "Study settings", icon: SlidersHorizontal },
            { id: "network", label: "Network & assets", icon: Graph },
            { id: "series", label: "Demand & availability", icon: Table },
          ].map((view) => (
            <Command
              key={view.id}
              icon={view.icon}
              label={view.label}
              title={`Open ${view.label.toLowerCase()}`}
              on={state.view === view.id}
              disabled={pending && view.id !== "series"}
              onClick={() => planning.set((s) => ({ ...s, view: view.id }))}
            />
          ))}
        </Column>
      </Group>
    </>
  )
}

function PlanningRunTab() {
  const state = useStore(planning)
  const otherRun = useStore(running)
  const files = usePlanningFiles()
  const pending = planningHasPendingProfiles()
  return (
    <>
      <Group label="Optimization">
        <Command
          icon={Play}
          label={state.busy ? "Optimizing…" : "Optimize"}
          title={
            pending ? "Apply edited profiles first" : "Solve the current planning study with PyPSA and HiGHS"
          }
          tall
          disabled={state.busy || !!otherRun || pending}
          onClick={() => void runPlanning()}
        />
        <Command
          icon={StopCircle}
          art="cancel"
          label="Cancel"
          title="Stop the planning solve"
          tall
          disabled={!state.busy || state.cancelling}
          onClick={() => void cancelPlanning()}
        />
      </Group>
      <Group label="Results">
        <Command
          icon={Scroll}
          art="reports"
          label="Results"
          title="View solved planning results"
          tall
          disabled={pending || (!files.result && !state.busy)}
          onClick={() => planning.set((s) => ({ ...s, view: "results" }))}
        />
        <Column>
          <Command
            icon={SlidersHorizontal}
            label="Use solved inputs"
            title="Restore the inputs recorded in the selected run"
            disabled={state.busy || !files.result}
            onClick={() => {
              if (files.result) files.replace(structuredClone(files.result.study))
            }}
          />
        </Column>
      </Group>
      <Group label="Engine">
        <Op name="PING" label="Check" tall />
        {state.busy && (
          <div className="flex max-w-64 flex-col justify-center gap-1 px-2 text-meta text-muted-foreground">
            <progress
              aria-label="Planning progress"
              max={100}
              value={state.progress}
              className="h-1.5 w-full"
            />
            <span role="status" className="truncate" title={state.message}>
              {state.message}
            </span>
          </div>
        )}
      </Group>
    </>
  )
}

function PlanningExportTab() {
  const state = useStore(planning)
  const files = usePlanningFiles()
  return (
    <Group label="Planning JSON">
      <Command
        icon={FloppyDisk}
        art="save"
        label="Study"
        title="Export the current planning inputs as JSON"
        tall
        disabled={planningHasPendingProfiles()}
        onClick={files.exportStudy}
      />
      <Command
        icon={Scroll}
        art="reports"
        label="Run report"
        title="Export the selected run with its inputs and results"
        tall
        disabled={!files.result}
        onClick={files.exportReport}
      />
      <div className="flex flex-col justify-center px-2 text-meta text-muted-foreground">
        <span>{state.study.name}</span>
        <span>
          {files.result ? `${state.results.length} solved runs in this session` : "No solved run yet"}
        </span>
      </div>
    </Group>
  )
}

function PlanningDocument() {
  const state = useStore(planning)
  const files = usePlanningFiles()
  return (
    <div className="flex min-w-0 max-w-64 items-center gap-1 text-meta">
      <span className="truncate px-1 text-muted-foreground" title={state.study.name}>
        {state.study.name}
      </span>
      <button
        type="button"
        title="Export planning study JSON"
        aria-label="Save planning study"
        disabled={planningHasPendingProfiles()}
        onClick={files.exportStudy}
        className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-foreground hover:bg-hover disabled:opacity-40"
      >
        <FloppyDisk className="size-3" />
        Save study
      </button>
    </div>
  )
}

function DataTab() {
  useStore(screen)
  const settings = useStore(areaStates)
  const data = useStore(project).data
  const table = leaves(activeTree()).find((p) => p.editor === "table")
  const storedProduct = table && (settings[table.id]?.product as Product | undefined)
  const product = storedProduct && TABLES.includes(storedProduct) ? storedProduct : "solar"
  return (
    <>
      <Group label="Result table">
        {TABLES.map((p) => (
          <Command
            key={p}
            icon={editorMeta(p).icon}
            art={ART_BY_PRODUCT[p]}
            label={PRODUCT_NAMES[p]}
            title={`Show ${data.results.filter((r) => r.kind === p).length} ${PRODUCT_NAMES[p].toLowerCase()} results`}
            tall
            on={p === product}
            disabled={!table}
            onClick={() => {
              if (table) setAreaState(table.id, { product: p })
            }}
          />
        ))}
      </Group>
      <Group label="Export">
        <Command
          icon={FloppyDisk}
          art="csv"
          label="Table CSV"
          title={`Export the ${PRODUCT_NAMES[product].toLowerCase()} table`}
          tall
          disabled={!data.results.some((r) => r.kind === product)}
          onClick={() => void exportTableCsv(product)}
        />
      </Group>
    </>
  )
}

function ToolsTab() {
  useStore(screen)
  const panels = leaves(activeTree())
  const console = panels.find((p) => p.editor === "console")
  const reports = panels.find((p) => p.editor === "reports")
  return (
    <>
      <Group label="Console">
        <Command
          art="scripting"
          label="Console"
          title="Show the console panel alone"
          tall
          disabled={!console}
          onClick={() => {
            if (console) toggleMaximized(console.id)
          }}
        />
        <Op name="SEARCH" label="Operators" tall />
        <Column>
          <Op name="ADJUST_LAST" label="Adjust last" />
        </Column>
      </Group>
      <Group label="Engine">
        <Op name="PING" label="Check" tall />
        <Op name="CANCEL" label="Cancel" tall />
      </Group>
      <Group label="Reports">
        <Command
          icon={Scroll}
          art="reports"
          label="Reports"
          title="Show execution reports"
          tall
          disabled={!reports}
          onClick={() => {
            if (reports) toggleMaximized(reports.id)
          }}
        />
      </Group>
    </>
  )
}

export function Ribbon() {
  const state = useStore(screen)
  const selections = useStore(workspaceRibbonTabs)
  const folded = useStore(ribbonCollapsed)
  const context = ribbonContext(
    state.active,
    leaves(activeTree()).map((p) => p.editor),
  )
  const tab = resolveRibbonTab(context, selections[state.active])
  const tabs = context.tabs.map((id) => ({ id, ...RIBBON_TABS[id] }))
  const content =
    tab === "map" ? (
      <MapTab />
    ) : tab === "analysis" ? (
      <AnalysisTab products={context.products} />
    ) : tab === "view" ? (
      <ViewTab />
    ) : tab === "share" ? (
      context.planning ? (
        <PlanningExportTab />
      ) : (
        <ShareTab products={context.products} />
      )
    ) : tab === "study" ? (
      <PlanningStudyTab />
    ) : tab === "run" ? (
      <PlanningRunTab />
    ) : tab === "data" ? (
      <DataTab />
    ) : (
      <ToolsTab />
    )

  return (
    <>
      <div
        className="relative flex shrink-0 items-stretch gap-0.5 border-b px-1"
        style={{
          height: RIBBON_TABS_PX,
          background: "var(--s-chrome)",
          borderColor: "rgb(var(--p-line) / 0.28)",
        }}
      >
        {/* The application's own tab, filled, where a GIS desktop keeps Project. */}
        <AppMenu
          planningMode={context.planning}
          products={context.products}
          trigger={(t) => (
            <button
              ref={t.ref as React.Ref<HTMLButtonElement>}
              type="button"
              onClick={t.onClick}
              aria-expanded={t["aria-expanded"]}
              aria-haspopup="menu"
              title={
                context.planning
                  ? "Studio: planning files, settings and application commands"
                  : "Studio: project files, settings and application commands"
              }
              className="my-[3px] flex shrink-0 items-center gap-1 rounded-sm bg-primary px-2.5 text-meta font-semibold text-primary-foreground"
            >
              <Cube className="size-3.5" />
              Studio
            </button>
          )}
        />

        <nav className="ml-1 flex min-w-0 flex-1 items-stretch gap-px" role="tablist" aria-label="Ribbon">
          {tabs.map((t) => {
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
                  workspaceRibbonTabs.set((s) => ({ ...s, [state.active]: t.id }))
                }}
                onDoubleClick={toggleRibbon}
                className={`relative -mb-px flex shrink-0 items-center whitespace-nowrap px-3 text-meta transition-colors ${
                  on ? "text-accent" : "text-muted-foreground hover:text-foreground"
                }`}
                style={
                  on
                    ? // The ground of the ribbon below: the tab and its commands are one surface.
                      { background: "var(--s-band)", borderTopLeftRadius: 3, borderTopRightRadius: 3 }
                    : undefined
                }
              >
                {t.label}
              </button>
            )
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          {context.planning ? <PlanningDocument /> : <ProjectMenu />}
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
            background: "var(--s-band)",
            borderColor: "rgb(var(--p-line) / 0.28)",
            scrollbarWidth: "none",
          }}
          role="tabpanel"
          aria-label={RIBBON_TABS[tab].label}
        >
          <div key={`${state.active}:${tab}`} className="contents">
            {content}
          </div>
        </div>
      )}
    </>
  )
}

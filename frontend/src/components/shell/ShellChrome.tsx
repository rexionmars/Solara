import { useState, type ReactNode } from "react"
import { BrowserOpenURL, WindowMinimise, WindowToggleMaximise } from "../../../wailsjs/runtime/runtime"
import { CaretDown, CaretRight, Crosshair, FolderSimple, MapPin, Minus, Pentagon, ShellGlyph, SidebarSimple, SignIn, Square, X, type Icon } from "../../lib/icons"
import { account } from "../../lib/account"
import { REPO_URL } from "../../lib/brand"
import { frameItem } from "../../lib/mapEngine"
import { runOperator } from "../../lib/operators"
import { findItem, isResult, project, PRODUCT_NAMES, type Product } from "../../lib/project"
import { nameFromPath, openProject, recentFiles } from "../../lib/projectFile"
import { reports } from "../../lib/reports"
import { select, useActiveItem } from "../../lib/selection"
import { goTo, railOpen, reportsSeen, shell, togglePanel } from "../../lib/shell"
import { useStore } from "../../lib/store"
import { coordinatePrompt, preferences } from "../../lib/ui"
import { Avatar } from "../account/Avatar"
import { OperatorMenuItem, StudioMenuGroup, StudioMenuItem, StudioMenuRule, StudioPopover } from "../studio/Popover"

/*
  THE RAIL IS NARROWER THAN THE TRAFFIC LIGHTS ARE WIDE. They end about 61px in
  and the rail is 52, as the layout this follows has it, so on macOS they sit
  across the seam. The strip at the head of the rail and the header are one
  band for that reason: one ground, one line under it and no rail edge through
  the third light. Only the header's left padding depends on the platform.

  Read off the navigator rather than asked of the runtime: a wrong answer is a
  few pixels of padding, and an answer that arrived late would slide the
  header's contents on every launch.
*/
const RESERVES_TRAFFIC_LIGHTS = /Mac/i.test(navigator.platform)

const PRODUCTS: Product[] = ["solar", "wind", "terrain", "connection", "demand", "ground"]

/** A crumb of the header: a name that opens the menu of its level. */
function Crumb({
  label,
  title,
  current = false,
  muted = false,
  open,
  onOpenChange,
  children,
}: {
  label: ReactNode
  title: string
  /** The last crumb, which names where the reader is. */
  current?: boolean
  /** Nothing is chosen at this level: the label says so rather than names something. */
  muted?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <StudioPopover
      open={open}
      onOpenChange={onOpenChange}
      portal="viewport"
      widthRem={18}
      trigger={(t) => (
        <button
          ref={t.ref as React.Ref<HTMLButtonElement>}
          type="button"
          onClick={t.onClick}
          aria-expanded={t["aria-expanded"]}
          aria-haspopup="menu"
          title={title}
          className={`app-no-drag flex h-7 min-w-0 max-w-[20rem] items-center gap-1.5 rounded-sm px-1.5 text-heading transition-colors hover:bg-hover hover:text-foreground ${
            current && !muted ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {label}
        </button>
      )}
    >
      {children}
    </StudioPopover>
  )
}

/**
 * The band beside the rail's head: the rail's switch, where the reader is (the
 * project, then the site or area in hand), and the Options menu under the mark.
 */
export function ShellTopBar() {
  const p = useStore(project)
  const recent = useStore(recentFiles)
  const open = useStore(railOpen)
  const active = useActiveItem()
  const [menu, setMenu] = useState<"project" | "place" | "options" | null>(null)
  const opener = (m: "project" | "place" | "options") => (next: boolean) => setMenu(next ? m : null)
  const done = () => setMenu(null)

  // The place in hand: the selected site or area, or the one a selected result was read at.
  const source = isResult(active) ? findItem(p.data, active.sourceId) : active
  const place = source && (source.kind === "site" || source.kind === "area") ? source : null
  const go = (id: string) => {
    done()
    select(id)
    const item = findItem(project.get().data, id)
    if (item) frameItem(item)
  }

  return (
    <header
      className="app-draggable relative z-50 flex h-11 shrink-0 items-center gap-1.5 border-b pr-2"
      style={{
        background: "var(--s-chrome)",
        borderColor: "var(--s-line-soft)",
        paddingLeft: RESERVES_TRAFFIC_LIGHTS && !open ? "1.125rem" : "0.5rem",
      }}
    >
      <button
        type="button"
        onClick={() => railOpen.set(!open)}
        aria-pressed={open}
        aria-label={open ? "Hide the labels" : "Show the labels"}
        title={open ? "Hide the labels" : "Show the labels"}
        className="app-no-drag flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        <SidebarSimple className="size-4" />
      </button>
      <nav aria-label="Project and place" className="flex min-w-0 flex-1 items-center gap-0.5">
        <Crumb
          label={
            <>
              <span className="truncate">{p.data.name}</span>
              {p.dirty && <span className="size-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" aria-label="Unsaved changes" />}
            </>
          }
          title={p.path ? `${p.path} — project` : "Project, not saved yet"}
          open={menu === "project"}
          onOpenChange={opener("project")}
        >
          <StudioMenuGroup label="Recent projects">
            {recent.length ? (
              recent.slice(0, 6).map((path) => (
                <StudioMenuItem
                  key={path}
                  icon={FolderSimple}
                  label={nameFromPath(path)}
                  checked={path === p.path}
                  title={path}
                  onSelect={() => {
                    done()
                    void openProject(path)
                  }}
                />
              ))
            ) : (
              <p className="px-2 py-1.5 text-micro leading-relaxed text-muted-foreground">No projects opened yet. Save this one to list it here.</p>
            )}
          </StudioMenuGroup>
          <StudioMenuRule />
          <OperatorMenuItem name="NEW" label="New project" onDone={done} />
          <OperatorMenuItem name="OPEN" label="Open project…" onDone={done} />
          <OperatorMenuItem name="SAVE" onDone={done} />
          <OperatorMenuItem name="SAVEAS" label="Save as…" onDone={done} />
          <OperatorMenuItem name="REVEAL_PROJECT" label="Reveal project file" onDone={done} />
        </Crumb>
        <CaretRight className="size-3 shrink-0 text-muted-foreground" />
        <Crumb
          label={<span className="truncate">{place ? place.name : "No site or area"}</span>}
          title="The site or area in hand"
          current
          muted={!place}
          open={menu === "place"}
          onOpenChange={opener("place")}
        >
          {p.data.sites.length > 0 && (
            <StudioMenuGroup label="Sites">
              {p.data.sites.map((s) => (
                <StudioMenuItem key={s.id} icon={MapPin} art="site" label={s.name} checked={s.id === place?.id} onSelect={() => go(s.id)} />
              ))}
            </StudioMenuGroup>
          )}
          {p.data.areas.length > 0 && (
            <StudioMenuGroup label="Areas">
              {p.data.areas.map((a) => (
                <StudioMenuItem key={a.id} icon={Pentagon} art="area" label={a.name} checked={a.id === place?.id} onSelect={() => go(a.id)} />
              ))}
            </StudioMenuGroup>
          )}
          {!p.data.sites.length && !p.data.areas.length && (
            <p className="px-2 py-1.5 text-micro leading-relaxed text-muted-foreground">
              No sites or areas yet. Place a site on the map, or take an area from a published boundary.
            </p>
          )}
          <StudioMenuRule />
          <OperatorMenuItem name="TOOL_SITE" label="Place a site" onDone={done} />
          <OperatorMenuItem name="AREA_PLACE" label="Area from a place…" onDone={done} />
          <StudioMenuItem
            icon={Crosshair}
            label="Site at coordinates…"
            onSelect={() => {
              done()
              coordinatePrompt.set(true)
            }}
          />
        </Crumb>
      </nav>

      {/*
        The mark opens the Options menu: what belongs to the application rather
        than to the place. The logo and the name stay as they are; the caret
        marks them as a menu and not a picture.
      */}
      <StudioPopover
        open={menu === "options"}
        onOpenChange={opener("options")}
        portal="viewport"
        align="end"
        widthRem={17}
        trigger={(t) => (
          <button
            ref={t.ref as React.Ref<HTMLButtonElement>}
            type="button"
            onClick={t.onClick}
            aria-expanded={t["aria-expanded"]}
            aria-haspopup="menu"
            aria-label="Options"
            title="Options"
            className={`app-no-drag flex h-8 items-center gap-1 rounded-sm pl-1.5 pr-1 transition-colors hover:bg-hover ${t["aria-expanded"] ? "bg-hover" : ""}`}
          >
            <span className="brand-lockup text-[16px]">
              <img src="/solara-mark.svg" alt="" />
              <span className="brand-word">solara</span>
            </span>
            <CaretDown className="size-3 text-muted-foreground" />
          </button>
        )}
      >
        <OperatorMenuItem name="OPEN" label="Open project…" onDone={done} />
        <OperatorMenuItem name="SAVE" onDone={done} />
        <OperatorMenuItem name="SAVEAS" label="Save as…" onDone={done} />
        <StudioMenuRule />
        <OperatorMenuItem name="UNDO" onDone={done} />
        <OperatorMenuItem name="REDO" onDone={done} />
        <OperatorMenuItem name="ADJUST_LAST" onDone={done} />
        <StudioMenuRule />
        <StudioMenuGroup label="Export">
          <OperatorMenuItem name="EXPORT_CSV" label="Active result as CSV…" onDone={done} />
          <OperatorMenuItem name="EXPORT_JSON" label="Active result as JSON…" onDone={done} />
          <OperatorMenuItem name="EXPORT_GEOTIFF" label="Layer as GeoTIFF…" onDone={done} />
          {PRODUCTS.map((pr) => (
            <OperatorMenuItem key={pr} name="EXPORT_TABLE" args={[pr]} label={`${PRODUCT_NAMES[pr]} table as CSV…`} onDone={done} />
          ))}
        </StudioMenuGroup>
        <StudioMenuRule />
        <OperatorMenuItem name="SEARCH" label="Search commands…" onDone={done} />
        <OperatorMenuItem name="PREFERENCES" label="Settings…" onDone={done} />
        <OperatorMenuItem name="KEYMAP" label="Keymap" onDone={done} />
        <OperatorMenuItem name="SPLASH" label="Start screen" onDone={done} />
        <OperatorMenuItem name="FULLSCREEN" onDone={done} />
        <StudioMenuRule />
        <OperatorMenuItem name="PING" label="Check the engine" onDone={done} />
        <OperatorMenuItem name="GRID_STORE" onDone={done} />
        <OperatorMenuItem name="ABOUT" label="About" onDone={done} />
        <StudioMenuRule />
        <OperatorMenuItem name="QUIT" onDone={done} />
      </StudioPopover>
      <WindowControls />
    </header>
  )
}

/** Off macOS the window draws no controls of its own, so the band carries them. */
function WindowControls() {
  if (RESERVES_TRAFFIC_LIGHTS) return null
  const button = (title: string, onClick: () => void, child: ReactNode, danger = false) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground ${
        danger ? "hover:bg-destructive hover:text-white" : "hover:bg-hover"
      }`}
    >
      {child}
    </button>
  )
  return (
    <div className="app-no-drag ml-1 flex items-center gap-1">
      {button("Minimize", WindowMinimise, <Minus className="size-3.5" />)}
      {button("Maximize", WindowToggleMaximise, <Square className="size-3" />)}
      {/* Through the operator, so unsaved work is asked about first. */}
      {button("Close", () => void runOperator("QUIT"), <X className="size-3.5" />, true)}
    </div>
  )
}

function RailButton({
  icon: Glyph,
  label,
  title,
  open,
  active = false,
  dot = false,
  onClick,
}: {
  icon: Icon
  label: string
  /** The tooltip, where it has to say more than the label does. */
  title?: string
  open: boolean
  active?: boolean
  /** Something new behind it. */
  dot?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={title ?? label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`relative flex h-9 shrink-0 items-center rounded-md transition-colors ${open ? "w-full gap-3 px-2.5" : "w-9 justify-center"} ${
        // A ground and not the accent: this says where the reader is, and the
        // palette spends the accent on what can be acted on.
        active ? "bg-[rgb(var(--p-surface-raised))] text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"
      }`}
    >
      <Glyph className="size-[1.125rem] shrink-0" />
      {open && <span className="truncate text-emphasis">{label}</span>}
      {dot && <span aria-hidden className={`absolute size-1.5 rounded-full bg-warning ${open ? "left-[1.5rem] top-1.5" : "right-1.5 top-1.5"}`} />}
    </button>
  )
}

/**
 * Where a reader can go, as against what they can do where they are.
 *
 * The full height of the window. Its head is a blank strip that continues the
 * header's band, where the traffic lights sit; the mark is in the header, as
 * the Options menu.
 */
export function ShellRail() {
  const s = useStore(shell)
  const open = useStore(railOpen)
  const { user, loaded } = useStore(account)
  const list = useStore(reports)
  const seen = useStore(reportsSeen)
  const place =
    s.destination !== "explore" ? s.destination : s.panel === "places" ? "places" : s.panel === "activity" ? "activity" : "explore"
  const link = (path: string) => () => BrowserOpenURL(`${REPO_URL}${path}`)
  return (
    <nav
      aria-label="Application"
      className={`app-no-drag relative z-50 flex h-full shrink-0 flex-col transition-[width] duration-150 ${open ? "w-52" : "w-[3.25rem]"}`}
      style={{ background: "var(--s-chrome)" }}
    >
      <div className="app-draggable h-11 shrink-0 border-b" style={{ borderColor: "var(--s-line-soft)" }} />
      <div className="flex min-h-0 flex-1 flex-col border-r" style={{ borderColor: "var(--s-line-soft)" }}>
        <div className={`flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-1.5 ${open ? "px-2" : "items-center"}`}>
          <RailButton
            icon={ShellGlyph.Compass}
            label="Explore"
            title="Explore: the map"
            open={open}
            active={place === "explore"}
            onClick={() => {
              goTo("explore")
              shell.set((x) => ({ ...x, panel: x.panel === "places" || x.panel === "activity" ? null : x.panel }))
            }}
          />
          <RailButton icon={ShellGlyph.MapPin} label="Sites and areas" open={open} active={place === "places"} onClick={() => togglePanel("places")} />
          <RailButton icon={ShellGlyph.Columns} label="Compare" title="Compare: every result of a product side by side" open={open} active={place === "compare"} onClick={() => goTo("compare")} />
          <RailButton icon={ShellGlyph.Graph} label="Planning" title="System planning with PyPSA" open={open} active={place === "planning"} onClick={() => goTo("planning")} />
          <RailButton icon={ShellGlyph.FlowArrow} label="Run graph" title="Run graph: what a run reads, card by card" open={open} active={place === "graph"} onClick={() => goTo("graph")} />
          <hr className={`my-1.5 ${open ? "mx-1.5" : "w-7"}`} style={{ borderColor: "var(--s-line-soft)" }} />
          <div className="flex-1" />
          <RailButton
            icon={ShellGlyph.Scroll}
            label="Activity"
            title="Activity: what the application has said"
            open={open}
            active={place === "activity"}
            dot={!!list.length && list[list.length - 1] !== seen && place !== "activity"}
            onClick={() => togglePanel("activity")}
          />
          <RailButton icon={ShellGlyph.Question} label="Help" title="Help: the README on GitHub" open={open} onClick={link("#readme")} />
          <RailButton icon={ShellGlyph.Info} label="Feedback" title="Feedback: report an issue on GitHub" open={open} onClick={link("/issues")} />
        </div>
        {loaded && (
          <div className={`flex shrink-0 pb-2 pt-1 ${open ? "px-2" : "justify-center"}`}>
            <button
              type="button"
              onClick={() => preferences.set("account")}
              title={user ? `${user.display_name} · Settings` : "Sign in"}
              aria-label={user ? "Settings" : "Sign in"}
              className={`flex h-9 items-center rounded-md text-foreground transition-colors hover:bg-hover ${open ? "w-full gap-3 px-1" : "w-9 justify-center"}`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[rgb(var(--p-surface-raised))]">
                {user ? <Avatar user={user} size={22} /> : <SignIn className="size-4 text-muted-foreground" />}
              </span>
              {open && <span className="truncate text-emphasis">{user?.display_name || "Sign in"}</span>}
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}


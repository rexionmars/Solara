import { useState } from "react"
import { CaretDown, Cube, FloppyDisk, FolderOpen, FolderSimple, Plus, Stack } from "@phosphor-icons/react"
import { runOperator } from "../../lib/operators"
import { PRODUCT_NAMES, project, type Product } from "../../lib/project"
import { openProject, recentFiles } from "../../lib/projectFile"
import { STUDIO_GROUPS } from "../../lib/editors"
import { WORKSPACES, activeWorkspace, screen, setWorkspace } from "../../lib/screen"
import { useStore } from "../../lib/store"
import { OperatorMenuItem, StudioMenuGroup, StudioMenuItem, StudioMenuRule, StudioPopover } from "./Popover"

/** The bar's height. */
export const WORKSPACE_BAR_PX = 28

const baseName = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.terra$/i, "")

/**
 * The workspace bar, as TERRA's.
 *
 * ONE APPLICATION MENU at the left rather than File, Edit, Window: this
 * application has fewer verbs than a 3D suite, and a row of near-empty menus
 * reads as an imitation rather than as a tool.
 *
 * ONE ENTRANCE PER SUBJECT, which is a menu bar and not a tab strip: Board,
 * Solar and Wind each open the arrangements for that kind of work. The group
 * holding the current one carries the ground of the area below and says its
 * name, so "Solar / Terrain" is read without opening anything.
 *
 * THE PROJECT'S DATA-BLOCK at the right, where Blender keeps Scene and
 * ViewLayer: which project is open, a way to open another, and Save.
 */
export function WorkspaceBar() {
  const s = useStore(screen)
  const p = useStore(project)
  const recent = useStore(recentFiles)
  const [appMenu, setAppMenu] = useState(false)
  const [groupMenu, setGroupMenu] = useState<string | null>(null)
  const [projectMenu, setProjectMenu] = useState(false)
  const current = activeWorkspace()
  const done = () => setAppMenu(false)
  const exportTable = (product: Product) => (
    <OperatorMenuItem name="EXPORT_TABLE" args={[product]} label={`${PRODUCT_NAMES[product]} table as CSV…`} onDone={done} />
  )

  return (
    <div
      className="relative flex shrink-0 items-stretch gap-0.5 border-b px-1"
      style={{ height: WORKSPACE_BAR_PX, background: "var(--s-chrome)", borderColor: "rgb(var(--p-line) / 0.28)" }}
    >
      <StudioPopover
        open={appMenu}
        onOpenChange={setAppMenu}
        widthRem={16}
        trigger={(t) => (
          <button
            ref={t.ref as React.Ref<HTMLButtonElement>}
            type="button"
            onClick={t.onClick}
            aria-expanded={t["aria-expanded"]}
            aria-haspopup="menu"
            title="Studio"
            className={`flex h-full items-center gap-1 px-2 text-meta transition-colors ${appMenu ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Cube className="size-3.5" />
            Studio
          </button>
        )}
      >
        <OperatorMenuItem name="NEW" label="New project" onDone={done} />
        <OperatorMenuItem name="OPEN" label="Open project…" onDone={done} />
        <OperatorMenuItem name="SAVE" onDone={done} />
        <OperatorMenuItem name="SAVEAS" label="Save as…" onDone={done} />
        <OperatorMenuItem name="REVEAL_PROJECT" label="Reveal project file" onDone={done} />
        <StudioMenuRule />
        <StudioMenuGroup label="Export">
          <OperatorMenuItem name="EXPORT_CSV" label="Active result as CSV…" onDone={done} />
          <OperatorMenuItem name="EXPORT_JSON" label="Active result as JSON…" onDone={done} />
          <OperatorMenuItem name="EXPORT_GEOTIFF" label="Terrain layer as GeoTIFF…" onDone={done} />
          {exportTable("solar")}
          {exportTable("wind")}
          {exportTable("terrain")}
          {exportTable("connection")}
        </StudioMenuGroup>
        <StudioMenuRule />
        <OperatorMenuItem name="UNDO" onDone={done} />
        <OperatorMenuItem name="REDO" onDone={done} />
        <OperatorMenuItem name="ADJUST_LAST" onDone={done} />
        <OperatorMenuItem name="SEARCH" label="Search operators…" onDone={done} />
        <StudioMenuRule />
        <OperatorMenuItem name="RESET_LAYOUT" label="Reset this workspace" onDone={done} />
        <OperatorMenuItem name="PREFERENCES" label="Settings…" onDone={done} />
        <OperatorMenuItem name="KEYMAP" label="Keymap" onDone={done} />
        <OperatorMenuItem name="PING" label="Check the engine" onDone={done} />
        <OperatorMenuItem name="SPLASH" label="Splash screen" onDone={done} />
        <OperatorMenuItem name="ABOUT" label="About" onDone={done} />
        <StudioMenuRule />
        <OperatorMenuItem name="QUIT" onDone={done} />
      </StudioPopover>

      <span className="mx-1 h-4 w-px self-center" style={{ background: "rgb(var(--p-line) / 0.45)" }} aria-hidden />

      {STUDIO_GROUPS.map((g) => {
        const members = WORKSPACES.filter((w) => w.group === g.id)
        if (!members.length) return null
        const isCurrent = current.group === g.id
        return (
          <StudioPopover
            key={g.id}
            open={groupMenu === g.id}
            onOpenChange={(open) => setGroupMenu(open ? g.id : null)}
            widthRem={14}
            trigger={(t) => (
              <button
                ref={t.ref as React.Ref<HTMLButtonElement>}
                type="button"
                onClick={t.onClick}
                aria-expanded={t["aria-expanded"]}
                aria-haspopup="menu"
                title={isCurrent ? current.hint : `${g.label}: ${members.map((w) => w.label).join(", ")}`}
                className={`relative -mb-px flex h-full items-center gap-1.5 px-2.5 text-meta transition-colors ${
                  isCurrent ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                style={
                  isCurrent
                    ? // The ground of the AREA BELOW: the entrance and the work it opens are one surface.
                      { background: "var(--s-panel)", borderTopLeftRadius: 3, borderTopRightRadius: 3 }
                    : undefined
                }
              >
                {isCurrent && <current.icon className="size-3 shrink-0" />}
                {g.label}
                {isCurrent && <span className="truncate text-muted-foreground">{current.label}</span>}
                <CaretDown className="size-2.5 shrink-0 text-muted-foreground" />
              </button>
            )}
          >
            {members.map((w) => (
              <StudioMenuItem
                key={w.id}
                icon={w.icon}
                label={w.label}
                checked={w.id === s.active}
                title={w.hint}
                onSelect={() => {
                  setWorkspace(w.id)
                  setGroupMenu(null)
                }}
              />
            ))}
          </StudioPopover>
        )
      })}

      <span className="flex-1" />

      <div className="flex min-w-0 max-w-[26rem] items-center gap-1.5">
        <StudioPopover
          open={projectMenu}
          onOpenChange={setProjectMenu}
          align="end"
          widthRem={17}
          trigger={(t) => (
            <button
              ref={t.ref as React.Ref<HTMLButtonElement>}
              type="button"
              onClick={t.onClick}
              aria-expanded={t["aria-expanded"]}
              aria-haspopup="menu"
              title={p.path ? `${p.path} — open another project` : "Not saved yet — open another project"}
              className="flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-meta transition-colors hover:brightness-125"
              style={{ background: "var(--s-control)" }}
            >
              <Stack className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate text-foreground">{p.data.name}</span>
              {p.dirty && (
                <span className="size-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" aria-label="Unsaved changes" />
              )}
              <CaretDown className="size-2.5 shrink-0 opacity-60" />
            </button>
          )}
        >
          <StudioMenuGroup label="Recent projects">
            {recent.length ? (
              recent.map((path) => (
                <StudioMenuItem
                  key={path}
                  icon={FolderSimple}
                  label={baseName(path)}
                  checked={path === p.path}
                  title={path}
                  onSelect={() => {
                    setProjectMenu(false)
                    void openProject(path)
                  }}
                />
              ))
            ) : (
              <p className="px-2 py-1.5 text-micro leading-relaxed text-muted-foreground">
                No projects opened yet. Save this one to list it here.
              </p>
            )}
          </StudioMenuGroup>
          <StudioMenuRule />
          <StudioMenuItem
            icon={Plus}
            label="New project"
            onSelect={() => {
              setProjectMenu(false)
              void runOperator("NEW")
            }}
          />
          <StudioMenuItem
            icon={FolderOpen}
            label="Open project…"
            onSelect={() => {
              setProjectMenu(false)
              void runOperator("OPEN")
            }}
          />
        </StudioPopover>
        <button
          type="button"
          onClick={() => void runOperator("SAVE")}
          title={p.path ? `Save over "${baseName(p.path)}"` : "Save this project under a name"}
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          <FloppyDisk className="size-3.5" />
          Save
        </button>
      </div>
    </div>
  )
}

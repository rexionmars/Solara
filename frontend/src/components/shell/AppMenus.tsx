import { useState } from "react"
import { CaretDown, FloppyDisk, FolderOpen, FolderSimple, Plus, Stack } from "@phosphor-icons/react"
import { runOperator } from "../../lib/operators"
import { PRODUCT_NAMES, project, type Product } from "../../lib/project"
import { nameFromPath, openProject, recentFiles } from "../../lib/projectFile"
import { useStore } from "../../lib/store"
import {
  OperatorMenuItem,
  StudioMenuGroup,
  StudioMenuItem,
  StudioMenuRule,
  StudioPopover,
} from "../studio/Popover"

/**
 * The two menus the workspace bar used to carry, lifted out of it unchanged.
 *
 * MOVED, NOT REWRITTEN. Every entry below is the same operator the menu bar
 * invoked, in the same order. A rewrite here would drop an operator quietly
 * and nobody would notice until the day they reached for it, so the JSX was
 * carried across rather than retyped: the application menu now hangs off the
 * sidebar's wordmark, and the project data-block off the page header, but
 * neither learned or forgot anything on the way.
 */

/** Everything the application can do that is not about one page. */
export function AppMenu({
  trigger,
}: {
  trigger: (t: { ref: React.Ref<HTMLElement>; onClick: () => void; "aria-expanded": boolean }) => React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const done = () => setOpen(false)
  const exportTable = (product: Product) => (
    <OperatorMenuItem
      name="EXPORT_TABLE"
      args={[product]}
      label={`${PRODUCT_NAMES[product]} table as CSV…`}
      onDone={done}
    />
  )
  return (
    <StudioPopover open={open} onOpenChange={setOpen} widthRem={16} trigger={trigger}>
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
        {exportTable("demand")}
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
  )
}

/** Which project is open, the ones opened before, and Save. */
export function ProjectMenu() {
  const p = useStore(project)
  const recent = useStore(recentFiles)
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <StudioPopover
        open={open}
        onOpenChange={setOpen}
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
            className="flex h-5 min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-meta transition-colors hover:brightness-125"
            style={{ background: "var(--s-control)" }}
          >
            <Stack className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-foreground">{p.data.name}</span>
            {p.dirty && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-warning"
                title="Unsaved changes"
                aria-label="Unsaved changes"
              />
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
                label={nameFromPath(path)}
                checked={path === p.path}
                title={path}
                onSelect={() => {
                  setOpen(false)
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
            setOpen(false)
            void runOperator("NEW")
          }}
        />
        <StudioMenuItem
          icon={FolderOpen}
          label="Open project…"
          onSelect={() => {
            setOpen(false)
            void runOperator("OPEN")
          }}
        />
      </StudioPopover>
      <button
        type="button"
        onClick={() => void runOperator("SAVE")}
        title={p.path ? `Save over "${nameFromPath(p.path)}"` : "Save this project under a name"}
        className="flex h-5 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        <FloppyDisk className="size-3" />
        Save
      </button>
    </div>
  )
}

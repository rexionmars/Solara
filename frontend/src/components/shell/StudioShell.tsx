import { STUDIO_GROUPS } from "../../lib/editors"
import { runOperator } from "../../lib/operators"
import { project } from "../../lib/project"
import { WORKSPACES, activeWorkspace, screen, setWorkspace } from "../../lib/screen"
import { useStore } from "../../lib/store"
import { sidebarCollapsed, toggleSidebar } from "../../lib/ui"
import { AppSidebar, type NavGroup } from "./AppSidebar"
import { AppMenu, ProjectMenu } from "./AppMenus"
import { PageHeader } from "./PageHeader"

/**
 * The studio's own product layer: the rail that says where you are and the
 * band that says what this page is.
 *
 * WHAT THIS REPLACED. A 28-pixel menu bar whose five menus had to be opened
 * to learn what the application contained, and a status bar of key hints
 * below the work. Both were Blender's, and Blender can afford them because
 * its user has learnt it; an analysis tool is opened by someone who has not.
 *
 * THE MOSAIC SURVIVES underneath, as the page's body. Panes are right for
 * drawing an area against a map and for a node canvas; they were never a
 * substitute for knowing which of nine arrangements you were in.
 */

/** The arrangements, grouped by the subject they serve. */
function navGroups(): NavGroup[] {
  return STUDIO_GROUPS.map((g) => ({
    label: g.label,
    items: WORKSPACES.filter((w) => w.group === g.id).map((w) => ({
      id: w.id,
      label: w.label,
      icon: w.icon,
    })),
  })).filter((g) => g.items.length > 0)
}

export function StudioSidebar() {
  const s = useStore(screen)
  const p = useStore(project)
  const collapsed = useStore(sidebarCollapsed)

  return (
    <AppSidebar
      groups={navGroups()}
      active={s.active}
      onSelect={setWorkspace}
      collapsed={collapsed}
      onToggleCollapsed={toggleSidebar}
      onSearch={() => void runOperator("SEARCH")}
      brand="TERRA"
      brandSub={p.data.name + (p.dirty ? " · unsaved" : "")}
      // The application menu is what the wordmark opens, which is where a
      // desktop application's menu has always been.
      renderBrand={(inner) => (
        <AppMenu
          trigger={(t) => (
            <button
              ref={t.ref as React.Ref<HTMLButtonElement>}
              type="button"
              onClick={t.onClick}
              aria-expanded={t["aria-expanded"]}
              aria-haspopup="menu"
              title="Application menu"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-[4px] px-1 py-0.5 hover:bg-hover"
            >
              {inner}
            </button>
          )}
        />
      )}
    />
  )
}

export function StudioPageHeader() {
  const w = activeWorkspace()
  const group = STUDIO_GROUPS.find((g) => g.id === w.group)

  return (
    <PageHeader
      title={w.label}
      crumbs={group ? [{ label: group.label }] : undefined}
      subtitle={w.hint}
      actions={<ProjectMenu />}
    />
  )
}

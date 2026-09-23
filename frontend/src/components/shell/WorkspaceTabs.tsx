import { Cube } from "@phosphor-icons/react"
import { STUDIO_GROUPS } from "../../lib/editors"
import { WORKSPACES, screen, setWorkspace } from "../../lib/screen"
import { useStore } from "../../lib/store"
import { AppMenu, ProjectMenu } from "./AppMenus"

/**
 * The arrangements, as a thin strip under the window's own band.
 *
 * TABS, NOT MENUS. The bar this replaced hid nine arrangements behind four
 * drop-downs, so the application could not be learnt without opening them.
 * Every workspace is on screen at once now, in its group's order, with the
 * current one lit -- which was the only thing a navigation rail was buying,
 * and a rail charged two hundred pixels of width on every screen for it.
 *
 * THE SAME LANGUAGE AS AN EDITOR HEADER, one step up: the strip is a couple
 * of pixels taller than the `Map / View / Select / Add / Object` row below it
 * and sits on the chrome rather than the panel head, so the two read as a
 * hierarchy rather than as two bars of equal weight.
 */

export const WORKSPACE_TABS_PX = 28

export function WorkspaceTabs() {
  const s = useStore(screen)

  return (
    <div
      className="relative flex shrink-0 items-stretch gap-0.5 border-b px-1"
      style={{
        height: WORKSPACE_TABS_PX,
        background: "var(--s-chrome)",
        borderColor: "rgb(var(--p-line) / 0.28)",
      }}
    >
      <AppMenu
        trigger={(t) => (
          <button
            ref={t.ref as React.Ref<HTMLButtonElement>}
            type="button"
            onClick={t.onClick}
            aria-expanded={t["aria-expanded"]}
            aria-haspopup="menu"
            title="Studio"
            className="flex h-full shrink-0 items-center gap-1 rounded-sm px-2 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <Cube className="size-3.5" />
            Studio
          </button>
        )}
      />

      <span className="my-1.5 w-px shrink-0" style={{ background: "rgb(var(--p-line) / 0.45)" }} aria-hidden />

      {/* The strip scrolls rather than wraps: a bar that grows a second row
          moves everything under it, which is worse than a hidden tab. */}
      <nav
        className="flex min-w-0 flex-1 items-stretch gap-px overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
        aria-label="Workspaces"
      >
        {STUDIO_GROUPS.map((g, gi) => {
          const members = WORKSPACES.filter((w) => w.group === g.id)
          if (!members.length) return null
          return (
            <span key={g.id} className="flex items-stretch gap-px">
              {gi > 0 && (
                <span className="mx-1 my-2 w-px shrink-0" style={{ background: "rgb(var(--p-line) / 0.3)" }} aria-hidden />
              )}
              {members.map((w) => {
                const on = w.id === s.active
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setWorkspace(w.id)}
                    title={w.hint}
                    className={`my-[3px] flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-meta transition-colors ${
                      on ? "bg-selected text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"
                    }`}
                  >
                    <w.icon className="size-3 shrink-0" />
                    {w.label}
                  </button>
                )
              })}
            </span>
          )
        })}
      </nav>

      <div className="flex shrink-0 items-center">
        <ProjectMenu />
      </div>
    </div>
  )
}

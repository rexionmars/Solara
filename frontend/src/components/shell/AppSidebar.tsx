import { CaretDown, MagnifyingGlass, SidebarSimple, type Icon } from "@phosphor-icons/react"
import { useState, type ReactNode } from "react"

/**
 * The rail that says where you are and where else you could be.
 *
 * WHY THE STUDIO NEEDED ONE. A tiling editor answers "what is on screen" and
 * has no answer for "what else is there": every arrangement is reached by
 * opening a menu, so the application has no map of itself. Every analytics
 * surface worth copying carries its places in the open -- grouped, labelled,
 * with the current one lit -- and pays for the column it costs.
 *
 * PRESENTATIONAL ON PURPOSE. Nothing here reads a store or the Wails runtime,
 * so the shell can be rendered and judged in a browser at `/preview.html`
 * without a desktop build. The studio passes what it knows; this draws it.
 */

export type NavItem = {
  id: string
  label: string
  icon: Icon
  /** A count or a state, drawn as a chip at the right of the row. */
  badge?: string
  /** A row that has nothing to show yet is dimmed rather than hidden. */
  empty?: boolean
}

export type NavGroup = { label: string; items: NavItem[] }

export type AccountLine = { name: string; detail: string; avatar?: ReactNode }

export function AppSidebar({
  groups,
  active,
  onSelect,
  account,
  onSearch,
  searchHint = "⌘K",
  collapsed = false,
  onToggleCollapsed,
  brand = "solara",
  brandSub,
  onBrand,
  renderBrand,
}: {
  groups: NavGroup[]
  active: string
  onSelect: (id: string) => void
  account?: AccountLine
  onSearch?: () => void
  searchHint?: string
  collapsed?: boolean
  onToggleCollapsed?: () => void
  brand?: string
  brandSub?: string
  /** The application menu, which used to be the first entry of a menu bar. */
  onBrand?: () => void
  /**
   * Wraps the wordmark in something that opens: the rail owns how the brand
   * LOOKS, the caller owns what pressing it DOES, so the menu can live in the
   * studio where the operators are without the rail importing them.
   */
  renderBrand?: (inner: ReactNode) => ReactNode
}) {
  const [shut, setShut] = useState<Record<string, boolean>>({})

  return (
    <nav
      className="flex shrink-0 flex-col border-r border-border bg-chrome"
      style={{ width: collapsed ? 56 : 212 }}
      aria-label="Sections"
    >
      <div className="flex items-center gap-2 px-3 py-3">
        {(() => {
          const inner = (
            <>
              {/* Beside two lines the mark aligns with the name, not with the
                  pair; 24px is the 1.472em the lockup asks for at this size,
                  and the pixel up is where RoundSans puts its ink. */}
              <img src="/solara-mark.svg" alt="" className={`w-[24px] shrink-0 ${collapsed ? "" : "-mt-px self-start"}`} />
              {!collapsed && (
                <span className="min-w-0 text-left">
                  <span className="brand-word block truncate text-[16px]">{brand}</span>
                  {brandSub && <span className="block truncate text-[10px] text-muted-foreground">{brandSub}</span>}
                </span>
              )}
            </>
          )
          return renderBrand ? (
            renderBrand(inner)
          ) : (
            <button
              type="button"
              onClick={onBrand}
              className="flex min-w-0 items-center gap-2 rounded-[4px] px-1 py-0.5 hover:bg-hover"
              title="Application menu"
            >
              {inner}
            </button>
          )
        })()}
        {!collapsed && onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="ml-auto rounded-[4px] p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
            title="Collapse"
          >
            <SidebarSimple size={15} />
          </button>
        )}
      </div>

      {onSearch && (
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={onSearch}
            className="flex w-full items-center gap-2 rounded-[5px] border border-border bg-field px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:border-line hover:text-foreground"
          >
            <MagnifyingGlass size={14} className="shrink-0" />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 truncate">Search</span>
                <kbd className="shrink-0 rounded-[3px] bg-control px-1 py-px font-mono text-[10px]">{searchHint}</kbd>
              </>
            )}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((g) => {
          const closed = shut[g.label]
          return (
            <section key={g.label} className="mb-1">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => setShut((s) => ({ ...s, [g.label]: !s[g.label] }))}
                  className="flex w-full items-center justify-between px-1.5 py-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
                >
                  {g.label}
                  <CaretDown size={10} className={closed ? "-rotate-90 transition-transform" : "transition-transform"} />
                </button>
              )}
              {!closed &&
                g.items.map((it) => {
                  const on = it.id === active
                  const Ico = it.icon
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => onSelect(it.id)}
                      title={collapsed ? it.label : undefined}
                      // The current place is lit, not merely bolder: on a dark
                      // surface a weight change is invisible at 13px, and the
                      // rail's whole job is to say where you are.
                      className={`relative mb-px flex w-full items-center gap-2.5 rounded-[5px] px-2 py-[7px] text-[13px] transition-colors ${
                        on
                          ? "bg-accent-dim text-foreground"
                          : it.empty
                            ? "text-muted-foreground/55 hover:bg-hover hover:text-muted-foreground"
                            : "text-muted-foreground hover:bg-hover hover:text-foreground"
                      }`}
                    >
                      {on && <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-accent" />}
                      <Ico size={16} weight={on ? "fill" : "regular"} className="shrink-0" />
                      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{it.label}</span>}
                      {!collapsed && it.badge && (
                        <span className="shrink-0 rounded-[3px] bg-control px-1.5 py-px font-mono text-[10px] tabular-nums text-muted-foreground">
                          {it.badge}
                        </span>
                      )}
                    </button>
                  )
                })}
            </section>
          )
        })}
      </div>

      {account && (
        <div className="border-t border-hairline p-2">
          <div className="flex min-w-0 items-center gap-2 rounded-[5px] px-1.5 py-1.5 hover:bg-hover">
            <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-control text-[11px] text-muted-foreground">
              {account.avatar ?? account.name.slice(0, 1).toUpperCase()}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-foreground">{account.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{account.detail}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {collapsed && onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="border-t border-hairline p-2 text-muted-foreground hover:text-foreground"
          title="Expand"
        >
          <SidebarSimple size={15} className="mx-auto" />
        </button>
      )}
    </nav>
  )
}

import type { ReactNode } from "react"
import { CaretRight, X } from "../../lib/icons"
import { HostStrip } from "./HeaderHosts"

export interface Crumb {
  label: string
  /** Absent on the crumb that names where the reader is. */
  onClick?: () => void
}

/**
 * The one panel over the map, as TERRA's.
 *
 * Right of it is the tool column and under it the credit line, whose licences
 * ask that it stay reachable, so it stops short of both.
 *
 * AN EDITOR'S OWN CONTROLS ride under the title, in the strip HostStrip
 * offers: the reading's result picker and exports, the outliner's filter. A
 * panel holding an editor with none shows no strip.
 */
export function ShellPanel({
  crumbs,
  onClose,
  aside,
  footer,
  wide = false,
  children,
}: {
  crumbs: readonly Crumb[]
  onClose: () => void
  /** Beside the title, before the close mark: a panel's one action about itself. */
  aside?: ReactNode
  footer?: ReactNode
  /** For a reading with figures across it, which the narrow column cannot hold. */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <aside
      aria-label={crumbs[crumbs.length - 1]?.label}
      className="map-chrome map-chrome-panel app-no-drag absolute bottom-10 right-[3.5rem] top-3 z-40 flex max-w-[calc(100%-5rem)] flex-col overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.28)] shadow-[0_2px_8px_rgb(0_0_0/0.28)]"
      style={{ width: wide ? "44rem" : "26rem", containerType: "inline-size" }}
    >
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b pl-4 pr-2" style={{ borderColor: "var(--border)" }}>
        <nav aria-label="Panel path" className="flex min-w-0 flex-1 items-center gap-1.5">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <span key={`${i}:${c.label}`} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <CaretRight className="size-3 shrink-0 text-muted-foreground" />}
                {c.onClick ? (
                  <button type="button" onClick={c.onClick} className="truncate text-heading text-muted-foreground transition-colors hover:text-foreground">
                    {c.label}
                  </button>
                ) : (
                  <span aria-current={last ? "page" : undefined} className={`truncate text-heading ${last ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                    {c.label}
                  </span>
                )}
              </span>
            )
          })}
        </nav>
        {aside}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          title="Close"
          className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <HostStrip className="h-9 border-b px-2" >
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </HostStrip>
      {footer && (
        <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
          {footer}
        </footer>
      )}
    </aside>
  )
}

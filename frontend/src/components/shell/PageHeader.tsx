import type { ReactNode } from "react"

/**
 * The band that says what this page is, how fresh it is, and what to do next.
 *
 * WHAT IT REPLACES. A menu bar states what the application can do; it never
 * states what you are looking at. The studio's 22-pixel row said "Grid ·
 * Demand" in eleven-pixel type beside four other menus, so the name of the
 * thing on screen was the smallest text on it. Here the title is the largest,
 * the freshness sits under it, and the one action a reader came for is the
 * only coloured element in the band.
 *
 * ONE PRIMARY ACTION. In accent, on the right, always in the same place.
 * Everything else is quiet: an accent that appears twice has stopped meaning
 * "this one".
 */

export type Crumb = { label: string; onClick?: () => void }

export function PageHeader({
  title,
  crumbs,
  badge,
  subtitle,
  status,
  actions,
  primary,
}: {
  title: string
  /** Where the page sits, when it sits inside something. */
  crumbs?: Crumb[]
  /** The result's standing, in the warning colour when it qualifies every figure below. */
  badge?: ReactNode
  /** The register, the run, the time it was read. Never a sentence. */
  subtitle?: string
  /** A live word with a dot: ready, running, stale. */
  status?: { label: string; tone: "ok" | "busy" | "warn" | "off" }
  /** Quiet buttons: export, open, settings. */
  actions?: ReactNode
  primary?: { label: string; onClick: () => void; icon?: ReactNode; busy?: boolean }
}) {
  const dot =
    status?.tone === "ok"
      ? "bg-success"
      : status?.tone === "busy"
        ? "bg-accent"
        : status?.tone === "warn"
          ? "bg-warning"
          : "bg-line"

  return (
    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-app px-5 py-3.5">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <span className="opacity-50">/</span>}
                {c.onClick ? (
                  <button type="button" onClick={c.onClick} className="hover:text-foreground">
                    {c.label}
                  </button>
                ) : (
                  <span>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-[22px] font-medium leading-tight text-foreground">{title}</h1>
          {badge}
          {status && (
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`size-1.5 rounded-full ${dot}`} />
              {status.label}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-1 truncate text-[12px] text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        {actions}
        {primary && (
          <button
            type="button"
            onClick={primary.onClick}
            disabled={primary.busy}
            className="flex items-center gap-1.5 rounded-[5px] bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {primary.icon}
            {primary.busy ? "Running…" : primary.label}
          </button>
        )}
      </div>
    </header>
  )
}

/** A quiet button for the header's right side. Never the accent. */
export function HeaderAction({
  children,
  onClick,
  icon,
  title,
}: {
  children?: ReactNode
  onClick?: () => void
  icon?: ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 rounded-[5px] border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground hover:border-line hover:text-foreground"
    >
      {icon}
      {children}
    </button>
  )
}

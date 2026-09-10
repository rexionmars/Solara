import type { ReactNode } from "react"
import type { energy } from "../../../wailsjs/go/models"
import { formatLat, formatLng } from "../../lib/format"
import type { Site } from "../../lib/site"

/**
 * The pieces a result document is built from: a figure, a stat row, a chip,
 * a section, the header. Ported from TERRA's analysisPrimitives, restyled to
 * this application's tokens.
 *
 * Grids here follow the CONTAINER, not the window (the document declares
 * `@container`), because TERRA found that viewport breakpoints give a narrow
 * panel on a wide screen the layout of a wide one.
 */

export const EYEBROW = "text-[10px] uppercase tracking-[0.12em] text-muted"

/** A label, the figure it names, and the assumption the figure was read under. */
export function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className={EYEBROW}>{label}</div>
      <div className="mt-0.5 truncate font-mono text-lg tabular-nums text-ink">{value}</div>
      {sub && <div className="truncate font-mono text-[11px] tabular-nums text-muted">{sub}</div>}
    </div>
  )
}

/** A label and its value on one baseline, for a dense run of parameters. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    // The label has a floor and the value wraps below it rather than beside
    // it: in a narrow column a truncated label beside a kept number leaves an
    // unlabelled figure, which is worse than a wrapped one.
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 py-0.5">
      <span className="min-w-[8rem] flex-1 text-xs text-muted">{label}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-ink">{value}</span>
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-8 @2xl:grid-cols-2">{children}</div>
}

export function FigureGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-4">{children}</div>
}

/** Small caps tag for a result's standing. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[2px] border border-line px-1 py-px font-mono text-[9px] uppercase tracking-wider text-muted">
      {children}
    </span>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-5">
      <h3 className="mb-3 text-sm text-ink">{title}</h3>
      {children}
    </section>
  )
}

/** The product, where it was computed, on what record, and its standing. */
export function DocumentHeader({
  product,
  site,
  meta,
  chips,
}: {
  product: string
  site: Site
  meta: string
  chips?: string[]
}) {
  return (
    <header className="pb-5">
      <div className="flex items-center gap-2">
        <p className={EYEBROW}>{product}</p>
        {chips?.map((c) => <Chip key={c}>{c}</Chip>)}
      </div>
      <h2 className="mt-1 font-mono text-xl tabular-nums text-ink">
        {formatLat(site.lat)}  {formatLng(site.lon)}
      </h2>
      <p className="mt-1 text-xs text-muted">{meta}</p>
    </header>
  )
}

/**
 * Which NASA POWER series the figures were read from, and when. POWER
 * reprocesses historical data and the cache never expires, so a cached run
 * and a fetched one must be distinguishable on screen.
 */
export function ProvenanceNote({ provenance }: { provenance?: energy.PowerProvenance }) {
  if (!provenance) return null
  const series = [
    ["Daily", provenance.daily],
    ["Hourly", provenance.hourly],
  ] as const
  const present = series.filter(([, s]) => !!s)
  if (!present.length) return null
  return (
    <p className="mt-1 text-[11px] leading-relaxed text-muted">
      {present.map(([label, s], i) => (
        <span key={label}>
          {i > 0 ? " " : ""}
          {label} series{" "}
          {s!.source === "cache"
            ? `read from cache${s!.fetched_utc ? `, fetched ${s!.fetched_utc}` : ", fetch date not recorded"}`
            : "fetched during this run"}
          .
        </span>
      ))}
    </p>
  )
}

/** Shown in a result tab that has no result yet. */
export function NoResult({ product, command }: { product: string; command: string }) {
  return (
    <p className="py-16 text-center text-sm text-muted">
      No {product.toLowerCase()} yet. Set a site with SITE, then run {command}.
    </p>
  )
}

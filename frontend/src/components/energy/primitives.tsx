import { useState, type ReactNode } from "react"
import type { energy } from "../../../wailsjs/go/models"
import { Info } from "../../lib/icons"

/**
 * The pieces every reading is built from: the header, the head figures, the
 * panels and what goes inside them. One set, so that two products' readings
 * cannot be laid out two ways.
 *
 * Grids here follow the CONTAINER, not the window (the document declares
 * `@container`), because TERRA found that viewport breakpoints give a narrow
 * panel on a wide screen the layout of a wide one.
 */

export const EYEBROW = "text-[11px] uppercase tracking-[0.1em] text-muted-foreground"

/** A label and its value on one baseline, for a dense run of parameters. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    // The label has a floor and the value wraps below it rather than beside
    // it: in a narrow column a truncated label beside a kept number leaves an
    // unlabelled figure, which is worse than a wrapped one.
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 py-0.5">
      <span className="min-w-[8rem] flex-1 text-xs text-muted-foreground">{label}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">{value}</span>
    </div>
  )
}

/**
 * A result's standing, such as "gross" or "unvalidated". Drawn in the warning
 * colour: a qualifier that changes how every figure below it reads must not be
 * the least visible text on the page.
 */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[3px] bg-warning/15 px-1.5 py-px text-[11px] font-medium uppercase tracking-wide text-warning">
      {children}
    </span>
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
    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
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

// =====================================================================
// The panel layer: what turns a reading from a document into a surface.
//
// A section stacked under a section is a page, and a page is read once,
// top to bottom. A panel is bounded, carries its own head and its own
// scroll, and sits BESIDE its neighbours where the container allows it,
// so the reader chooses an order instead of receiving one. Everything
// below exists to make that possible in a column that is sometimes six
// hundred pixels wide and sometimes sixteen hundred.
// =====================================================================

/**
 * One bounded piece of a reading: a head that names it, a right-hand slot for
 * the control that scopes it, and a body that scrolls on its own.
 *
 * The body's height is capped rather than left to grow, because the panel's
 * job is to stay findable while the reader works somewhere else on the screen.
 */
export function Panel({
  title,
  right,
  children,
  bodyClass = "",
  /** Rows that are worth spreading across the full width -- a wide table, a map. */
  span,
  note,
}: {
  title: string
  right?: ReactNode
  children: ReactNode
  bodyClass?: string
  span?: boolean
  /**
   * What explains the panel's figures -- the assumption they were read under,
   * what a register does not hold -- behind the head's info button.
   *
   * NOT THE QUALIFIER THAT CHANGES HOW A NUMBER IS READ. "Gross", "at least",
   * "injected, not generated" are part of a figure's label and stay beside
   * it: a modelled value is never drawn as a measured one.
   */
  note?: ReactNode
}) {
  const [told, setTold] = useState(false)
  return (
    <section
      className={`flex min-w-0 flex-col rounded-[5px] border border-border bg-sunk ${span ? "@xl:col-span-2" : ""}`}
    >
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-1.5">
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
        {right}
        {note && (
          <button
            type="button"
            onClick={() => setTold((v) => !v)}
            aria-expanded={told}
            aria-label={told ? "Hide what these figures assume" : "What these figures assume"}
            title="What these figures assume"
            className={`grid size-4 shrink-0 place-items-center rounded-sm transition-colors hover:bg-hover ${
              told ? "text-accent" : "text-muted-foreground/70 hover:text-foreground"
            }`}
          >
            <Info className="size-3" />
          </button>
        )}
      </header>
      <div className={`min-w-0 px-3 py-2.5 ${bodyClass}`}>{children}</div>
      {note && told && (
        <div className="mx-3 mb-2.5 flex flex-col gap-1.5 rounded-[4px] bg-black/25 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
          {note}
        </div>
      )}
    </section>
  )
}

// =====================================================================
// The reading's page: what every product's result is read on.
//
// Three levels and no more: a head, one row of up to four indicator
// cards, one main panel (a second where the answer has two parts), then a
// line saying where the figures came from. The finish -- colours, type,
// spacing -- is the `.reading` block of index.css; these are its parts.
//
// A NUMBER IS WRITTEN ONCE. The head carries no figure; an indicator's
// figure is not repeated in the panel under it; the layer's legend is on
// the map and a file's path is in Export.
// =====================================================================

/** The page a reading is laid on. It owns the surface, so it fills its studio area. */
export function ReadingPage({ children }: { children: ReactNode }) {
  return <div className="reading-page">{children}</div>
}

/** The product's name and one sentence saying what the reading is of. No figure: that is the first card's. */
export function ReadingHead({ title, about, chips, tag }: { title: string; about: string; chips?: string[]; tag?: string }) {
  return (
    <header className="reading-head">
      <div className="flex flex-wrap items-center gap-2">
        <h2>{title}</h2>
        {/* Which of a product's cases this result is: a fact about it, not a warning. */}
        {tag && <span className="reading-chip">{tag}</span>}
        {/* A standing that qualifies every figure below is beside the name, in the warning tone, always on screen. */}
        {chips?.map((c) => (
          <span key={c} className="reading-chip" data-tone="warn">
            {c}
          </span>
        ))}
      </div>
      <p>{about}</p>
    </header>
  )
}

/**
 * What every figure below has to be read under, in one line between the head
 * and the indicators, always on screen: a screening that is gross and
 * unvalidated must not look like an assessment for want of a click.
 *
 * ONE LINE, so the head and the indicators still fit without scrolling. The
 * engine's full qualification is behind the line's own info button.
 */
export function ReadingNotice({ children, more }: { children: ReactNode; more?: ReactNode }) {
  const [told, setTold] = useState(false)
  return (
    <div className="reading-notice" role="note">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">{children}</span>
        {more && (
          <button
            type="button"
            onClick={() => setTold((v) => !v)}
            aria-expanded={told}
            aria-label={told ? "Hide the full qualification" : "The full qualification"}
            title="The full qualification"
            className="grid size-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-white/10"
          >
            <Info className="size-4" />
          </button>
        )}
      </div>
      {more && told && <div className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed opacity-90">{more}</div>}
    </div>
  )
}

/** Up to four indicators abreast; two, then one, as the area narrows. */
export function IndicatorRow({ children }: { children: ReactNode }) {
  return <div className="reading-kpis">{children}</div>
}

/**
 * One indicator: what it is and over what, a rule, the figure large with its
 * unit small beside it, a chip, and a line of description.
 *
 * THE CHIP HAS ITS OWN LINE, in every card whether or not it has one. Beside
 * the figure it fits in a wide card and drops under it in a narrow one, and
 * then the descriptions of four neighbours start at four heights.
 */
export function IndicatorCard({
  title,
  sub,
  value,
  unit,
  chip,
  children,
}: {
  title: string
  sub: string
  value: string
  unit?: string
  /** What the figure is read against, or the short qualifier that changes how it is read. */
  chip?: string
  children?: ReactNode
}) {
  return (
    <article className="reading-kpi">
      <header>
        <h3 title={title}>{title}</h3>
        <p title={sub}>{sub}</p>
      </header>
      <div>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="reading-num selectable min-w-0" data-code={/[A-Za-z]/.test(value) ? "" : undefined} title={value}>
            {value}
          </span>
          {unit && <span className="reading-unit">{unit}</span>}
        </div>
        <div className="reading-chip-line">{chip && <span className="reading-chip">{chip}</span>}</div>
        {children && <p>{children}</p>}
      </div>
    </article>
  )
}

/**
 * The panel a reading's answer is drawn in: a title that states the finding,
 * a line saying what the drawing is, the controls that change it in the head,
 * and what few readers ask for folded at its foot.
 *
 * `note` is what explains the drawing, behind the info button. The qualifier
 * that changes how a figure is read is never here: it is a chip, on screen.
 */
export function ReadingPanel({
  title,
  sub,
  controls,
  note,
  details,
  children,
}: {
  title: string
  sub?: string
  controls?: ReactNode
  note?: ReactNode
  /** Label-and-value rows, folded under "Details". */
  details?: ReactNode
  children: ReactNode
}) {
  const [told, setTold] = useState(false)
  return (
    <section className="reading-panel">
      <div className="reading-panel-head">
        <div className="reading-panel-title">
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          {note && (
            <button
              type="button"
              onClick={() => setTold((v) => !v)}
              aria-expanded={told}
              aria-label={told ? "Hide what this assumes" : "What this assumes"}
              title="What this assumes"
              className="grid size-7 place-items-center rounded-md transition-colors hover:bg-[var(--s-panel-head)]"
              style={{ color: told ? "var(--accent)" : "var(--s-text-muted)" }}
            >
              <Info className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div className="reading-panel-body">{children}</div>
      {note && told && <div className="reading-note">{note}</div>}
      {details && (
        <details className="reading-details">
          <summary>Details</summary>
          <div className="reading-rows">{details}</div>
        </details>
      )}
    </section>
  )
}

/** A row of a panel's details. */
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <span className="selectable">{value}</span>
    </div>
  )
}

/** A choice between two or three drawings of the same figures, in a panel's head. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="reading-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Where the figures came from, in one quiet line at the foot. Never a path, and nothing the page already says. */
export function ReadingSource({ children }: { children: ReactNode }) {
  return <footer className="reading-source">{children}</footer>
}

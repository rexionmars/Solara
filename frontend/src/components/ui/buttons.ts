/**
 * The button primitives, TERRA's set.
 *
 * A filled accent button takes near-black (the accent is light: ink 6.25,
 * white 2.58), and a filled button has no hover fade, which would drop its
 * label under the floor.
 */

const FOCUS = "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

/** One disabled convention across the set, so two buttons in a row never differ. */
const DISABLED = "disabled:opacity-60 aria-disabled:opacity-60"

/** 32px, which is also the field height: a primary beside an input lines up. */
export const btnPrimary = `inline-flex h-8 items-center justify-center gap-1.5 rounded-sm bg-primary px-3 text-body font-semibold text-primary-foreground ${DISABLED} ${FOCUS}`

/** The single committing action that anchors a panel foot or a dialog. */
export const btnPrimaryCommit = `inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-primary px-4 text-emphasis font-semibold text-primary-foreground ${DISABLED} ${FOCUS}`

export const btnGhost = `inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-line/40 bg-control px-3 text-body text-muted-foreground transition-colors hover:bg-hover hover:text-foreground ${DISABLED} ${FOCUS}`

/** The dense band, 28px, for toolbars and card feet where 4px repeats per row. */
export const btnGhostDense = `inline-flex h-7 items-center justify-center gap-1 rounded-sm border border-line/40 bg-control px-2 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground ${DISABLED} ${FOCUS}`

/** 28px square, matching the dense height. */
export const btnIcon = `inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground ${DISABLED} ${FOCUS}`

/** The input well, 32px. */
export const fieldInput =
  "h-8 w-full rounded-sm border border-line/40 bg-transparent px-2 text-body text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/55"

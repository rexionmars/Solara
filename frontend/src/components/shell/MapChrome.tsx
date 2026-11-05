import type { ReactNode } from "react"

/**
 * The map's own controls, as TERRA draws them: a 2.125rem square on the
 * `.map-chrome` material, a hairline between buttons in a bar and a hairline
 * around it.
 */

/** One bar of controls: the hairline, the radius and the shadow. */
export function MapBar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.28)] shadow-[0_2px_8px_rgb(0_0_0/0.28)] ${className}`}>
      {children}
    </div>
  )
}

/** The rule between the column's own panels and the map's tools. */
export function MapBarRule() {
  return <div aria-hidden className="h-1 bg-[rgb(var(--p-line)/0.45)]" />
}

/**
 * One control: a glyph, and its name as the title and accessible name.
 *
 * A map's chrome sits over the ground it controls, and a control that spells
 * itself out takes ground from the thing being looked at -- which is the whole
 * argument for a column of glyphs rather than a row of words.
 */
export function MapButton({
  label,
  active = false,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  /** Why it cannot act now; the button stays where it is and says so. */
  disabled?: string | false
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={disabled ? `${label} — ${disabled}` : label}
      aria-label={label}
      aria-pressed={active}
      aria-disabled={disabled ? true : undefined}
      onClick={() => {
        if (!disabled) onClick()
      }}
      className={`map-chrome flex size-[2.125rem] items-center justify-center border-b border-[rgb(var(--p-line)/0.22)] transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
        disabled
          ? "cursor-default text-muted-foreground/45"
          : active
            ? "bg-[rgb(var(--p-surface-raised)/0.92)] text-accent-quiet"
            : "text-muted-foreground hover:bg-[rgb(var(--p-surface-raised)/0.92)] hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

import { artSrc } from "../../lib/art"
import { useState } from "react"
import { CaretDown, type Icon } from "../../lib/icons"
import type { MenuItem } from "../../lib/ui"
import { MenuItems, StudioPopover } from "./Popover"

/**
 * The header's vocabulary, TERRA's copy of Blender's, and the reason a header
 * holds twenty controls in twenty-six pixels. Four shapes and no more:
 *
 *   TEXT MENU      View  Select  Add        no glyph, no border, opens a list
 *   TOGGLE         [icon]                   pressed reads as filled accent
 *   POPOVER        [icon ⌄]                 a glyph and a chevron, opens a panel
 *   RADIO          [icon label|icon label]  an enum whose members can be glyphed
 *
 * Borderless until touched: Blender draws nothing until hover and fills only
 * what is on, so a row of controls reads as one strip. 20px controls in a
 * 26px header, 12px glyphs.
 */

export const HEADER_CONTROL = "h-5"

const BASE = "flex shrink-0 items-center rounded-sm transition-colors outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"

/** A bare text menu opening a list: View, Select, Add. */
export function StudioHeaderMenu({ label, items, widthRem = 13.5 }: { label: string; items: () => MenuItem[]; widthRem?: number }) {
  const [open, setOpen] = useState(false)
  return (
    <StudioPopover
      open={open}
      onOpenChange={setOpen}
      widthRem={widthRem}
      trigger={(p) => (
        <button
          type="button"
          ref={p.ref as React.Ref<HTMLButtonElement>}
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-haspopup="menu"
          className={`${BASE} ${HEADER_CONTROL} px-1.5 text-meta ${open ? "bg-selected text-foreground" : "text-foreground hover:bg-hover"}`}
        >
          {label}
        </button>
      )}
    >
      {open && <MenuItems items={items()} onDone={() => setOpen(false)} />}
    </StudioPopover>
  )
}

/** A toggle, filled with the accent while on: the only strong colour in a header, so it reads as state. */
export function StudioHeaderToggle({
  icon: IconC,
  label,
  on,
  onToggle,
  title,
  showLabel = false,
  disabled,
}: {
  icon: Icon
  label: string
  on: boolean
  onToggle: () => void
  title?: string
  showLabel?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      title={title ?? label}
      className={`${BASE} ${HEADER_CONTROL} ${showLabel ? "gap-1 px-1.5" : "w-5 justify-center"} ${
        disabled ? "cursor-not-allowed opacity-40" : ""
      } ${on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"}`}
    >
      <IconC className="size-3 shrink-0" />
      {showLabel && <span className="text-meta">{label}</span>}
    </button>
  )
}

/** A popover entrance: a glyph, an optional label, and the chevron that says there is more behind it. */
export function StudioHeaderPopoverButton({
  triggerRef,
  icon: IconC,
  art,
  label,
  showLabel = false,
  open,
  active,
  title,
  onClick,
  className = "",
}: {
  triggerRef: (el: HTMLElement | null) => void
  icon?: Icon
  /** The coloured drawing that stands in for the glyph, where the set on trial has one (lib/art.ts). */
  art?: string
  label: string
  showLabel?: boolean
  open?: boolean
  active?: boolean
  title?: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      ref={triggerRef as React.Ref<HTMLButtonElement>}
      title={title ?? label}
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="menu"
      className={`${BASE} ${HEADER_CONTROL} gap-0.5 px-1 ${
        active
          ? "bg-accent text-accent-foreground"
          : open
            ? "bg-selected text-foreground"
            : "text-muted-foreground hover:bg-hover hover:text-foreground"
      } ${className}`}
    >
      {artSrc(art) ? <img src={artSrc(art)} alt="" draggable={false} className="size-3.5 shrink-0" /> : IconC && <IconC className="size-3 shrink-0" />}
      {showLabel && <span className="truncate text-meta">{label}</span>}
      <CaretDown className="size-2.5 shrink-0 opacity-60" />
    </button>
  )
}

/** A popover entrance opening a menu described as data. */
export function StudioHeaderPopover({
  icon,
  label,
  showLabel,
  items,
  align = "start",
  widthRem = 13.5,
  active,
}: {
  icon?: Icon
  label: string
  showLabel?: boolean
  items: () => MenuItem[]
  align?: "start" | "end"
  widthRem?: number
  active?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <StudioPopover
      open={open}
      onOpenChange={setOpen}
      align={align}
      widthRem={widthRem}
      trigger={(p) => (
        <StudioHeaderPopoverButton
          triggerRef={p.ref}
          onClick={p.onClick}
          icon={icon}
          label={label}
          showLabel={showLabel}
          open={open}
          active={active}
        />
      )}
    >
      {open && <MenuItems items={items()} onDone={() => setOpen(false)} />}
    </StudioPopover>
  )
}

/** The vertical hairline between groups in a header. */
export function StudioHeaderRule() {
  return <span className="mx-1 h-3.5 w-px shrink-0 self-center" style={{ background: "rgb(var(--p-line) / 0.45)" }} aria-hidden />
}

/**
 * A radio group drawn as glyphs with their names beside them. The name
 * withdraws when the area cannot carry it, leaving the glyph and its title.
 */
export function StudioHeaderRadio<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string; title?: string; icon: Icon }[]
  onChange: (id: T) => void
}) {
  return (
    <span
      className={`flex shrink-0 items-center gap-px overflow-hidden rounded-sm ${HEADER_CONTROL}`}
      style={{ background: "rgb(var(--p-line) / 0.22)" }}
      role="radiogroup"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          onClick={() => onChange(o.id)}
          aria-checked={o.id === value}
          title={o.title ?? o.label}
          className={`flex h-full shrink-0 items-center gap-1 px-1.5 transition-colors ${
            o.id === value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"
          }`}
        >
          <o.icon className="size-3 shrink-0" />
          <span className="header-label text-meta">{o.label}</span>
        </button>
      ))}
    </span>
  )
}

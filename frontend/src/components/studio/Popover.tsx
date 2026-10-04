import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { Icon } from "../../lib/icons"
import { artSrc, operatorArt } from "../../lib/art"
import { formatKeys, pollOperator, runOperator, findOperator, usePollTick } from "../../lib/operators"
import { useStore } from "../../lib/store"
import { contextMenu, type MenuItem } from "../../lib/ui"

/**
 * A control that opens a panel, the way every dense control in TERRA's studio
 * does: the header carries the entrance, and the settings live one press away.
 *
 * PORTALLED into the studio surface and clamped against it. An area clips its
 * own body, so a panel rendered in place would be cut off by the very area
 * that opened it.
 */

/** The element popovers are portalled into and clamped against. */
export const StudioSurface = createContext<HTMLElement | null>(null)

function useSurface(): HTMLElement {
  return useContext(StudioSurface) ?? document.body
}

/** Walk the enabled rows of a panel with the arrow keys, as a menu is walked. */
function onMenuKeys(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)"))
  if (!items.length) return
  e.preventDefault()
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? items.length - 1
        : e.key === "ArrowDown"
          ? (i + 1) % items.length
          : (i - 1 + items.length) % items.length
  items[next].focus()
}

export type TriggerProps = {
  ref: (el: HTMLElement | null) => void
  onClick: () => void
  "aria-expanded": boolean
  "aria-haspopup": "menu" | "dialog"
}

export function StudioPopover({
  open,
  onOpenChange,
  trigger,
  align = "start",
  widthRem = 13.5,
  role = "menu",
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: (props: TriggerProps) => ReactNode
  /** Where the panel prefers to sit relative to the trigger. */
  align?: "start" | "end"
  widthRem?: number
  /** A panel of prose is a dialog, not a menu: a screen reader looks for items in a menu. */
  role?: "menu" | "dialog"
  children: ReactNode
}) {
  const surface = useSurface()
  const anchorRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const detached = surface === document.body

  // Measured before the browser shows it: the panel's own size decides whether it flips or slides.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const a = anchorRef.current?.getBoundingClientRect()
    const s = surface.getBoundingClientRect()
    const p = panelRef.current
    if (!a || !p) return
    const pad = 6
    const w = p.offsetWidth
    const h = p.offsetHeight
    let x = (align === "end" ? a.right - w : a.left) - s.left
    let y = a.bottom - s.top + 2
    // Flip above where there is no room below, which a header at the foot of the studio needs.
    if (y + h > s.height - pad) {
      const above = a.top - s.top - h - 2
      if (above > pad) y = above
    }
    x = Math.min(Math.max(pad, x), Math.max(pad, s.width - w - pad))
    y = Math.min(Math.max(pad, y), Math.max(pad, s.height - h - pad))
    setPos({ x, y })
  }, [open, surface, align])

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onOpenChange(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // Stopped, or the window's own Escape acts under a menu the reader was dismissing.
      e.stopPropagation()
      e.preventDefault()
      onOpenChange(false)
      anchorRef.current?.focus()
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", esc, true)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", esc, true)
    }
  }, [open, onOpenChange])

  // The first row takes focus once placed, so the arrow keys walk the menu at once.
  useEffect(() => {
    if (open && pos && role === "menu") {
      panelRef.current?.querySelector<HTMLElement>("[role='menuitem']:not(:disabled)")?.focus({ preventScroll: true })
    }
  }, [open, pos, role])

  return (
    <>
      {trigger({
        ref: (el) => {
          anchorRef.current = el
        },
        onClick: () => onOpenChange(!open),
        "aria-expanded": open,
        "aria-haspopup": role,
      })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role={role}
            onKeyDown={onMenuKeys}
            className={`rounded-sm border py-1 shadow-[0_8px_24px_rgba(0,0,0,0.55)] ${detached ? "fixed z-[1200]" : "absolute z-[60]"}`}
            style={{
              left: pos?.x ?? -9999,
              top: pos?.y ?? -9999,
              width: `${widthRem}rem`,
              // Raised rather than ink: a panel the colour of the ground behind it reads as a hole.
              background: "var(--s-float)",
              borderColor: "rgb(var(--p-line-strong) / 0.5)",
              visibility: pos ? "visible" : "hidden",
            }}
          >
            {children}
          </div>,
          surface
        )}
    </>
  )
}

/** One row of a popover: a glyph, a label, and a trailing note where Blender puts a shortcut. */
export function StudioMenuItem({
  icon: IconC,
  art,
  label,
  note,
  checked,
  disabled,
  indented,
  onSelect,
  title,
}: {
  icon?: Icon
  /** The coloured drawing that stands in for the glyph, where the set on trial has one (lib/art.ts). */
  art?: string
  label: string
  note?: string
  checked?: boolean
  disabled?: boolean
  indented?: boolean
  onSelect: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 py-[3px] text-left text-meta outline-none transition-colors ${
        indented ? "pl-7 pr-2" : "px-2"
      } ${
        disabled
          ? "cursor-not-allowed text-muted-foreground/40"
          : "text-foreground hover:bg-accent-dim focus-visible:bg-accent-dim"
      }`}
    >
      {/* A fixed slot whether or not there is a glyph, so the labels of a mixed menu line up. */}
      <span className="flex size-3 shrink-0 items-center justify-center">
        {checked ? (
          <span className="size-1.5 rounded-[1px] bg-accent" aria-hidden />
        ) : artSrc(art) ? (
          <img src={artSrc(art)} alt="" draggable={false} className={`size-3.5 max-w-none ${disabled ? "opacity-40 grayscale" : ""}`} />
        ) : IconC ? (
          <IconC className="size-3 text-muted-foreground" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note && <span className="telemetry shrink-0 text-[9px] text-muted-foreground">{note}</span>}
    </button>
  )
}

/** A titled group inside a popover. */
export function StudioMenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-0.5">
      <p className="eyebrow !text-[9px] px-2 pb-0.5">{label}</p>
      {children}
    </div>
  )
}

/** The hairline between groups of entries. */
export function StudioMenuRule() {
  return <div className="my-1 h-px" style={{ background: "rgb(var(--p-line) / 0.4)" }} aria-hidden />
}

/**
 * A row that runs an operator: greyed with the operator's own reason when it
 * cannot run, and its shortcut as the note.
 */
export function OperatorMenuItem({
  name,
  args,
  label,
  onDone,
}: {
  name: string
  args?: string[]
  label?: string
  onDone: () => void
}) {
  usePollTick()
  const op = findOperator(name)
  if (!op) return null
  const poll = pollOperator(op)
  return (
    <StudioMenuItem
      icon={op.icon}
      art={operatorArt(op.name)}
      label={label ?? op.label}
      note={op.keys?.[0] ? formatKeys(op.keys[0]) : undefined}
      disabled={poll !== true}
      title={poll === true ? op.description : poll}
      onSelect={() => {
        onDone()
        void runOperator(op.name, args)
      }}
    />
  )
}

/**
 * A menu described as data, drawn in the studio's vocabulary. A submenu is
 * drawn as a titled group in place rather than as a flyout: a handful of rows
 * does not earn the hover-intent and second placement a flyout needs, and a
 * flyout in a 14rem panel opens where there is no room for it.
 */
export function MenuItems({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  return (
    <>
      {items.map((item, i) => {
        switch (item.type) {
          case "op":
            return <OperatorMenuItem key={i} name={item.op} args={item.args} label={item.label} onDone={onDone} />
          case "action":
            return (
              <StudioMenuItem
                key={i}
                icon={item.icon}
                label={item.label}
                note={item.shortcut}
                checked={item.checked}
                disabled={!!item.disabled}
                title={item.disabled || undefined}
                onSelect={() => {
                  onDone()
                  item.run()
                }}
              />
            )
          case "sub":
            return (
              <StudioMenuGroup key={i} label={item.label}>
                <MenuItems items={item.items()} onDone={onDone} />
              </StudioMenuGroup>
            )
          case "sep":
            return <StudioMenuRule key={i} />
          case "heading":
            return (
              <p key={i} className="eyebrow !text-[9px] px-2 pb-0.5 pt-1">
                {item.label}
              </p>
            )
        }
      })}
    </>
  )
}

/**
 * A menu placed at a press, inside the surface, dismissed by Escape or a press
 * away from it -- the one opened from anywhere through openContextMenu.
 */
export function ContextMenuHost() {
  const menu = useStore(contextMenu)
  const surface = useSurface()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const close = () => contextMenu.set(null)

  useLayoutEffect(() => {
    const p = panelRef.current
    if (!menu || !p) {
      setPos(null)
      return
    }
    const s = surface.getBoundingClientRect()
    const pad = 6
    const x = Math.min(Math.max(pad, menu.x - s.left), Math.max(pad, s.width - p.offsetWidth - pad))
    const y = Math.min(Math.max(pad, menu.y - s.top), Math.max(pad, s.height - p.offsetHeight - pad))
    setPos({ x, y })
    p.querySelector<HTMLElement>("[role='menuitem']:not(:disabled)")?.focus({ preventScroll: true })
  }, [menu, surface])

  useEffect(() => {
    if (!menu) return
    const away = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) close()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      e.preventDefault()
      close()
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", esc, true)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", esc, true)
    }
  }, [menu])

  if (!menu) return null
  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      onKeyDown={onMenuKeys}
      className={`${surface === document.body ? "fixed" : "absolute"} z-[70] w-[14rem] rounded-sm border py-1 shadow-[0_8px_24px_rgba(0,0,0,0.55)]`}
      style={{
        left: pos?.x ?? -9999,
        top: pos?.y ?? -9999,
        background: "var(--s-float)",
        borderColor: "rgb(var(--p-line-strong) / 0.5)",
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {menu.title && (
        <>
          <p className="truncate px-2 pb-1 pt-0.5 text-[10px] text-muted-foreground">{menu.title}</p>
          <StudioMenuRule />
        </>
      )}
      <MenuItems items={menu.items} onDone={close} />
    </div>,
    surface
  )
}

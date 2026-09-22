import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowsIn, ArrowsOut, Columns, Rows, X } from "@phosphor-icons/react"
import { EDITORS, STUDIO_GROUPS, editorMeta, type EditorId } from "../../lib/editors"
import { AREA_RADIUS_PX, closeArea, hoveredArea, setEditor, splitArea, toggleMaximized, type Rect } from "../../lib/screen"
import { StudioHeaderPopoverButton } from "./HeaderControls"
import { StudioMenuGroup, StudioMenuItem, StudioMenuRule, StudioPopover } from "./Popover"

/**
 * One area: a header that is a control surface, an optional toolbar, and a
 * body -- TERRA's StudioArea.
 *
 * THREE ZONES, as Blender has them:
 *
 *   [type ⌄] [menus…]        [centre…]        [options…] │ ⌟
 *
 * `menus` is what the editor DOES, `centre` how it is doing it, `options`
 * what is shown. The arrangement costs no header pixels: splitting, closing
 * and maximising live on the header's context menu and behind the ⌟ grip.
 *
 * AN AREA TOO SMALL SAYS SO, rather than drawing something unreadable.
 */

/** The header's height. */
export const AREA_HEADER_PX = 26

type Hosts = {
  menus: HTMLElement | null
  centre: HTMLElement | null
  options: HTMLElement | null
  toolbar: HTMLElement | null
  setToolbar: (on: boolean) => void
}

/**
 * The header's places, offered to whatever this area holds. An editor fills
 * them from inside its own tree, so a control's state stays where it is used
 * rather than being lifted to whoever renders the area.
 */
const AreaHosts = createContext<Hosts | null>(null)

/** An editor's contribution to its area's header and toolbar. */
export function AreaHeader({
  menus,
  centre,
  options,
  toolbar,
}: {
  /** What the editor does: pulldowns, immediately right of the type button. */
  menus?: ReactNode
  /** How it is doing it: mode, tool. */
  centre?: ReactNode
  /** What is shown: visibility, overlays. Right-aligned. */
  options?: ReactNode
  /** A vertical strip of tools down the left of the body. */
  toolbar?: ReactNode
}) {
  const hosts = useContext(AreaHosts)
  const hasToolbar = !!toolbar
  useEffect(() => {
    if (!hosts || !hasToolbar) return
    hosts.setToolbar(true)
    return () => hosts.setToolbar(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts?.setToolbar, hasToolbar])
  if (!hosts) return null
  return (
    <>
      {menus && hosts.menus && createPortal(menus, hosts.menus)}
      {centre && hosts.centre && createPortal(centre, hosts.centre)}
      {options && hosts.options && createPortal(options, hosts.options)}
      {toolbar && hosts.toolbar && createPortal(toolbar, hosts.toolbar)}
    </>
  )
}

export function StudioArea({
  areaId,
  editor,
  rect,
  rootPx,
  maximized,
  takenUnique,
  canClose,
  children,
}: {
  areaId: string
  editor: EditorId
  rect: Rect
  rootPx: number
  maximized: boolean
  takenUnique: ReadonlySet<EditorId>
  canClose: boolean
  children: ReactNode
}) {
  const meta = editorMeta(editor)
  const [typeMenu, setTypeMenu] = useState(false)
  const [areaMenu, setAreaMenu] = useState(false)
  const [menusHost, setMenusHost] = useState<HTMLElement | null>(null)
  const [centreHost, setCentreHost] = useState<HTMLElement | null>(null)
  const [optionsHost, setOptionsHost] = useState<HTMLElement | null>(null)
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null)
  const [hasToolbar, setToolbar] = useState(false)
  const hosts = useMemo<Hosts>(
    () => ({ menus: menusHost, centre: centreHost, options: optionsHost, toolbar: toolbarHost, setToolbar }),
    [menusHost, centreHost, optionsHost, toolbarHost]
  )
  // A right-click that dismisses told apart from the one that summons: the
  // popover closes on the press, before the contextmenu event arrives.
  const dismissedByRightPress = useRef(false)

  const bodyH = Math.max(0, rect.h - AREA_HEADER_PX)
  const fits = rect.w >= meta.minRem * rootPx && bodyH >= meta.minRowRem * rootPx

  return (
    <div
      className="absolute flex flex-col overflow-hidden"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: AREA_RADIUS_PX,
        background: "var(--s-panel)",
        // So an editor responds to the AREA's width rather than the window's.
        containerType: "inline-size",
      }}
      data-area={areaId}
      onMouseEnter={() => hoveredArea.set({ id: areaId, editor })}
      onMouseMove={() => {
        const h = hoveredArea.get()
        if (h.id !== areaId || h.editor !== editor) hoveredArea.set({ id: areaId, editor })
      }}
      onMouseLeave={() => {
        if (hoveredArea.get().id === areaId) hoveredArea.set({ id: null, editor: null })
      }}
    >
      {/* HEADER */}
      <div
        onPointerDown={(e) => {
          if (e.button === 2) dismissedByRightPress.current = areaMenu
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("input")) return
          e.preventDefault()
          if (dismissedByRightPress.current) {
            dismissedByRightPress.current = false
            setAreaMenu(false)
            return
          }
          setAreaMenu(true)
        }}
        className="studio-header relative flex shrink-0 items-center gap-0.5 overflow-hidden border-b px-1"
        style={{ height: AREA_HEADER_PX, background: "var(--s-panel-head)", borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        {/* The editor selector, which is where Blender's header begins. */}
        <StudioPopover
          open={typeMenu}
          onOpenChange={setTypeMenu}
          widthRem={14}
          trigger={(p) => (
            <StudioHeaderPopoverButton
              triggerRef={p.ref}
              onClick={p.onClick}
              icon={meta.icon}
              label={meta.label}
              // Below 12rem the label withdraws and the glyph is all that is left.
              showLabel={rect.w > 12 * rootPx}
              open={typeMenu}
              title={meta.hint}
            />
          )}
        >
          {STUDIO_GROUPS.map((g, gi) => {
            const members = EDITORS.filter((e) => e.group === g.id)
            if (!members.length) return null
            return (
              <div key={g.id}>
                {gi > 0 && <StudioMenuRule />}
                <StudioMenuGroup label={g.label}>
                  {members.map((e) => {
                    const blocked = !!e.unique && e.id !== editor && takenUnique.has(e.id)
                    return (
                      <StudioMenuItem
                        key={e.id}
                        icon={e.icon}
                        label={e.label}
                        checked={e.id === editor}
                        disabled={blocked}
                        title={blocked ? `${e.label} holds the one map and can only be in one area` : e.hint}
                        onSelect={() => {
                          setEditor(areaId, e.id)
                          setTypeMenu(false)
                        }}
                      />
                    )
                  })}
                </StudioMenuGroup>
              </div>
            )
          })}
        </StudioPopover>

        {/* `contents`, so an editor's controls sit in the header's own flex row. */}
        <div ref={setMenusHost} className="contents" />
        <span className="flex-1" />
        <div ref={setCentreHost} className="contents" />
        <span className="flex-1" />
        <div ref={setOptionsHost} className="contents" />

        <StudioPopover
          open={areaMenu}
          onOpenChange={setAreaMenu}
          align="end"
          widthRem={13}
          trigger={(p) => (
            <button
              ref={p.ref as React.Ref<HTMLButtonElement>}
              type="button"
              onClick={p.onClick}
              aria-expanded={p["aria-expanded"]}
              aria-haspopup="menu"
              title="Area: split, close, maximise"
              className="ml-0.5 flex h-5 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              {/* Blender's corner grip, which is also its split handle. */}
              <span className="text-[13px] leading-none">⌟</span>
            </button>
          )}
        >
          <StudioMenuItem
            icon={Columns}
            label="Split side by side"
            onSelect={() => {
              splitArea(areaId, "row")
              setAreaMenu(false)
            }}
          />
          <StudioMenuItem
            icon={Rows}
            label="Split above and below"
            onSelect={() => {
              splitArea(areaId, "col")
              setAreaMenu(false)
            }}
          />
          <StudioMenuRule />
          <StudioMenuItem
            icon={maximized ? ArrowsIn : ArrowsOut}
            label={maximized ? "Restore areas" : "Maximise area"}
            note="Ctrl Space"
            onSelect={() => {
              toggleMaximized(maximized ? null : areaId)
              setAreaMenu(false)
            }}
          />
          <StudioMenuItem
            icon={X}
            label="Close area"
            disabled={!canClose}
            title={canClose ? "Its neighbour takes the space" : "The last area cannot be closed"}
            onSelect={() => {
              closeArea(areaId)
              setAreaMenu(false)
            }}
          />
        </StudioPopover>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {fits ? (
            <AreaHosts.Provider value={hosts}>{children}</AreaHosts.Provider>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
              <meta.icon className="size-4 text-muted-foreground/60" />
              <p className="text-[10px] leading-snug text-muted-foreground">
                {meta.label} needs {meta.minRem}×{meta.minRowRem} rem.
                <br />
                This area is {Math.round(rect.w / rootPx)}×{Math.round(bodyH / rootPx)}.
              </p>
            </div>
          )}
        </div>
        {/*
          The tools float over the work, hugging themselves, rather than
          holding a column of their own down the whole edge: four buttons were
          reserving a strip the length of the area and giving back a strip of
          empty ground. Same plate as the map's own navigation group, so the
          two read as one family of floating controls.
        */}
        <div
          ref={setToolbarHost}
          className={
            hasToolbar && fits
              ? "absolute left-1.5 top-1.5 z-10 flex flex-col overflow-hidden rounded-sm border shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
              : "hidden"
          }
          style={{ background: "rgb(var(--p-ink) / 0.72)", borderColor: "rgb(var(--p-line) / 0.4)" }}
        />
      </div>
    </div>
  )
}


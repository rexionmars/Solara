import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

/**
 * The places an editor's controls are drawn in, offered by whatever holds it.
 *
 * An editor fills them from inside its own tree, so a control's state stays
 * where it is used rather than being lifted to whoever renders the editor.
 * A panel over the map and a full-screen destination both offer them in their
 * header, which is how an editor written for the studio's areas reads the
 * same in either.
 */
export type Hosts = {
  menus: HTMLElement | null
  centre: HTMLElement | null
  options: HTMLElement | null
  toolbar: HTMLElement | null
  setToolbar: (on: boolean) => void
}

export const AreaHosts = createContext<Hosts | null>(null)

/** An editor's contribution to its holder's header and toolbar. */
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

/**
 * A strip that offers the three header places to the editor below it, for a
 * holder with no studio header: the menus left, the options right.
 *
 * It takes no height until an editor puts something in it, so a panel whose
 * editor has no controls shows no empty band.
 */
export function HostStrip({ children, lead, className = "" }: { children: ReactNode; lead?: ReactNode; className?: string }) {
  const [menus, setMenus] = useState<HTMLElement | null>(null)
  const [centre, setCentre] = useState<HTMLElement | null>(null)
  const [options, setOptions] = useState<HTMLElement | null>(null)
  const hosts = useMemo<Hosts>(
    () => ({ menus, centre, options, toolbar: null, setToolbar: () => {} }),
    [menus, centre, options]
  )
  return (
    <AreaHosts.Provider value={hosts}>
      {/* .host-strip hides itself while its three places are empty (index.css). */}
      <div className={`host-strip flex shrink-0 items-center gap-0.5 ${className}`}>
        {lead && <div className="flex min-w-0 shrink-0 items-center gap-2">{lead}</div>}
        <div ref={setMenus} className="flex min-w-0 items-center gap-0.5" />
        <div ref={setCentre} className="flex min-w-0 flex-1 items-center justify-center gap-0.5" />
        <div ref={setOptions} className="flex min-w-0 items-center gap-0.5" />
      </div>
      {children}
    </AreaHosts.Provider>
  )
}

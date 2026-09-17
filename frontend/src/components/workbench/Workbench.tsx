import { Fragment, useEffect, useRef, useState } from "react"
import { Check, List, X } from "@phosphor-icons/react"
import { loadAccount } from "../../lib/account"
import { listenForProgress } from "../../lib/analysis"
import { area, cancelDrawing } from "../../lib/area"
import { print } from "../../lib/commandLog"
import { DOCUMENT_TITLES, activateDocument, closeDocument, documents } from "../../lib/documents"
import { panels } from "../../lib/layout"
import { checkSidecar } from "../../lib/sidecarStatus"
import { cancelPicking, site } from "../../lib/site"
import { useStore } from "../../lib/store"
import { AccountDocument } from "../account/AccountDocument"
import { SolarDocument } from "../energy/SolarDocument"
import { TerrainDocument } from "../energy/TerrainDocument"
import { WindDocument } from "../energy/WindDocument"
import { CommandLine } from "./CommandLine"
import { PropertiesPanel } from "./PropertiesPanel"
import { RibbonBar } from "./RibbonBar"
import { StatusBar } from "./StatusBar"
import { Viewport } from "./Viewport"

// Set once the greeting is printed. StrictMode runs mount effects twice in
// development, and the history would otherwise open with every line doubled.
let greeted = false

// Keys that, typed outside a field, go to the command line. Letters and "?"
// only: MapLibre's keyboard handler uses the arrows, + and -, and the map
// canvas keeps focus for those.
const COMMAND_KEY = /^[a-z?]$/i

/** The list of open documents, from the menu button at the start of the tab strip. */
function DocumentMenu() {
  const { open, active } = useStore(documents)
  const [shown, setShown] = useState(false)
  return (
    <div className="relative" onBlur={() => setShown(false)}>
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-expanded={shown}
        title="Open documents"
        className="grid h-6 w-7 place-items-center rounded-sm text-ink/90 hover:bg-hover"
      >
        <List size={16} aria-hidden="true" />
      </button>
      {shown && (
        <ul className="absolute left-0 top-7 z-50 min-w-48 rounded-sm border border-line bg-panel py-1 shadow-xl">
          {open.map((id) => (
            <li key={id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  activateDocument(id)
                  setShown(false)
                }}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] text-ink hover:bg-hover"
              >
                <Check size={12} className={id === active ? "text-accent" : "invisible"} aria-hidden="true" />
                {DOCUMENT_TITLES[id]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DocumentTabs() {
  const { open, active } = useStore(documents)
  return (
    <nav aria-label="Documents" className="flex h-7 shrink-0 items-center bg-chrome px-1 text-[12px]">
      <DocumentMenu />
      {open.map((id) => {
        const isActive = id === active
        return (
          <Fragment key={id}>
            <span className="select-none px-1 text-line" aria-hidden="true">
              /
            </span>
            <span
              className={`group flex h-6 items-center gap-1 rounded-sm px-2 ${isActive ? "bg-raised text-ink" : "text-muted hover:bg-raised/50 hover:text-ink"}`}
            >
              <button
                type="button"
                onClick={() => activateDocument(id)}
                aria-current={isActive ? "page" : undefined}
                className={isActive ? "font-semibold" : ""}
              >
                {DOCUMENT_TITLES[id]}
              </button>
              {id !== "map" && (
                <button
                  type="button"
                  onClick={() => closeDocument(id)}
                  aria-label={`Close ${DOCUMENT_TITLES[id]}`}
                  className={`rounded-sm p-0.5 text-muted hover:bg-hover hover:text-ink ${isActive ? "" : "opacity-0 group-hover:opacity-100"}`}
                >
                  <X size={10} aria-hidden="true" />
                </button>
              )}
            </span>
          </Fragment>
        )
      })}
      <span className="select-none px-1 text-line" aria-hidden="true">
        /
      </span>
    </nav>
  )
}

/**
 * The main window: title bar and ribbon, document tabs, the active document
 * with the command line floating over it, and the status bar. The arrangement
 * follows desktop CAD, where the drawing stays in the middle and every tool is
 * reachable both from the ribbon and by typing its name.
 */
export function Workbench() {
  const shown = useStore(panels)
  const { active } = useStore(documents)
  const commandInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!greeted) {
      greeted = true
      print("TERRA Energy Engine ready.")
      print("Type a command or use the ribbon. HELP lists the commands.")
    }
    void checkSidecar()
    void loadAccount()
  }, [])

  // One progress listener for the application; the cleanup keeps StrictMode's
  // second mount from registering another.
  useEffect(() => listenForProgress(), [])

  // Typing a command name anywhere starts it on the command line, as in CAD,
  // and Escape abandons picking a site or drawing an area.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (site.get().picking) {
          cancelPicking()
          return
        }
        if (area.get().drawing) {
          cancelDrawing()
          return
        }
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (!COMMAND_KEY.test(e.key)) return
      const target = e.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      // Focused during keydown, the input receives this same keystroke.
      commandInput.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="app-shell-enter flex h-full flex-col bg-surface text-ink">
      <RibbonBar />
      <DocumentTabs />
      <div className="flex min-h-0 flex-1">
        {active === "map" && shown.properties && <PropertiesPanel />}
        <div className="relative flex min-h-0 min-w-0 flex-1">
          {/*
            The map stays mounted while another document is in front. Unmounting
            it would release its WebGL context and reload every tile on return.
          */}
          <div className={active === "map" ? "absolute inset-0 flex" : "hidden"}>
            <Viewport />
          </div>
          {active === "account" && <AccountDocument />}
          {active === "solar" && <SolarDocument />}
          {active === "wind" && <WindDocument />}
          {active === "terrain" && <TerrainDocument />}
          {shown.commandLine && <CommandLine inputRef={commandInput} />}
        </div>
      </div>
      <StatusBar />
    </div>
  )
}

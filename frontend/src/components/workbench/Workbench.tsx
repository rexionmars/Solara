import { useEffect, useRef } from "react"
import { X } from "@phosphor-icons/react"
import { loadAccount } from "../../lib/account"
import { listenForProgress } from "../../lib/analysis"
import { print } from "../../lib/commandLog"
import { DOCUMENT_TITLES, activateDocument, closeDocument, documents } from "../../lib/documents"
import { panels } from "../../lib/layout"
import { checkSidecar } from "../../lib/sidecarStatus"
import { cancelPicking, site } from "../../lib/site"
import { useStore } from "../../lib/store"
import { AccountDocument } from "../account/AccountDocument"
import { SolarDocument } from "../energy/SolarDocument"
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

function DocumentTabs() {
  const { open, active } = useStore(documents)
  return (
    <nav aria-label="Documents" className="flex h-8 shrink-0 items-end gap-0.5 border-b border-line bg-chrome px-2">
      {open.map((id) => {
        const isActive = id === active
        return (
          <span
            key={id}
            className={`flex items-center rounded-t border-x border-t text-xs ${
              isActive ? "border-line border-t-accent bg-surface text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <button type="button" onClick={() => activateDocument(id)} className="py-1 pl-4 pr-3">
              {DOCUMENT_TITLES[id]}
            </button>
            {id !== "map" && (
              <button
                type="button"
                onClick={() => closeDocument(id)}
                aria-label={`Close ${DOCUMENT_TITLES[id]}`}
                className="mr-1.5 rounded-sm p-0.5 text-muted hover:bg-hover hover:text-ink"
              >
                <X size={10} aria-hidden="true" />
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

/**
 * The main window: ribbon, document tabs, the active document, command line,
 * status bar. The arrangement follows desktop CAD, where the drawing stays in
 * the middle and every tool is reachable both from the ribbon and by typing
 * its name.
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
  // and Escape abandons picking a site.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && site.get().picking) {
        cancelPicking()
        return
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
        {/*
          The map stays mounted while another document is in front. Unmounting
          it would release its WebGL context and reload every tile on return.
        */}
        <div className={active === "map" ? "flex min-h-0 min-w-0 flex-1" : "hidden"}>
          {shown.properties && <PropertiesPanel />}
          <Viewport />
        </div>
        {active === "account" && <AccountDocument />}
        {active === "solar" && <SolarDocument />}
        {active === "wind" && <WindDocument />}
      </div>
      {shown.commandLine && <CommandLine inputRef={commandInput} />}
      <StatusBar />
    </div>
  )
}

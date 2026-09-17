import { useEffect, useState, type ReactNode } from "react"
import { GetAppVersion } from "../../../wailsjs/go/main/App"
import { account } from "../../lib/account"
import { PRODUCT_NAMES, analysis } from "../../lib/analysis"
import { findCommand, runCommand } from "../../lib/commands"
import { formatLat, formatLng } from "../../lib/format"
import { cursor, mapView } from "../../lib/mapController"
import { sidecar } from "../../lib/sidecarStatus"
import { useStore } from "../../lib/store"
import { usePressed } from "./RibbonBar"
import type { RibbonItem } from "./ribbon"

// A status field: flat, as CAD draws its status bar, and set apart by rules
// between groups rather than by a box round each field.
const FIELD = "flex h-6 items-center gap-1.5 rounded-sm px-1.5"

function Rule() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />
}

// The toggles at the end of the bar, drawn in the accent while on.
const TOGGLES: { command: string; pressedWhen: NonNullable<RibbonItem["pressedWhen"]> }[] = [
  { command: "PROPERTIES", pressedWhen: "properties" },
  { command: "COMMANDLINE", pressedWhen: "commandLine" },
  { command: "TERRAINLAYER", pressedWhen: "terrainLayer" },
]

function Toggle({ command, pressedWhen }: (typeof TOGGLES)[number]) {
  const pressed = usePressed({ pressedWhen })
  const cmd = findCommand(command)
  if (!cmd) return null
  const Icon = cmd.icon
  return (
    <button
      type="button"
      onClick={() => void runCommand(command)}
      aria-pressed={pressed}
      title={`${cmd.label} (${cmd.name})`}
      className={`grid h-6 w-7 place-items-center rounded-sm hover:bg-hover ${pressed ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"}`}
    >
      <Icon size={16} weight={pressed ? "bold" : "regular"} aria-hidden="true" />
    </button>
  )
}

function Cell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className={FIELD} title={title}>
      {children}
    </span>
  )
}

function CursorCell() {
  const c = useStore(cursor)
  return (
    <Cell title="Position under the pointer (WGS 84)">
      <span className="min-w-[14rem] text-right font-mono tabular-nums text-ink/90">
        {c ? `${formatLat(c.lat)}  ${formatLng(c.lng)}` : "—"}
      </span>
    </Cell>
  )
}

function ZoomCell() {
  const { zoom } = useStore(mapView)
  return (
    <Cell title="Map zoom level">
      <span className="font-mono tabular-nums">Z {zoom.toFixed(2)}</span>
    </Cell>
  )
}

function SidecarCell() {
  const s = useStore(sidecar)
  const dot = s.kind === "ready" ? "bg-ok" : s.kind === "failed" ? "bg-fail" : "bg-muted animate-pulse"
  const label =
    s.kind === "ready" ? `Python ${s.version}` : s.kind === "failed" ? "Sidecar unavailable" : "Checking"
  const title = s.kind === "ready" ? s.python : s.kind === "failed" ? s.message : undefined
  return (
    <Cell title={title}>
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </Cell>
  )
}

/** The analysis in flight: product, progress, the sidecar's latest step, and a way to stop it. */
function RunCell() {
  const { running } = useStore(analysis)
  if (!running) return null
  return (
    <span className={`${FIELD} min-w-0 bg-accent/10 text-ink ring-1 ring-inset ring-accent/50`}>
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden="true" />
      <span className="shrink-0">
        {PRODUCT_NAMES[running.product]}
        {running.progress !== null && ` · ${running.progress}%`}
      </span>
      <span className="max-w-[16rem] truncate text-muted" title={running.message}>
        {running.message}
      </span>
      <button
        type="button"
        onClick={() => void runCommand("CANCEL")}
        className="shrink-0 rounded-sm px-1 text-muted hover:bg-hover hover:text-ink"
      >
        Cancel
      </button>
    </span>
  )
}

function UserCell() {
  const { user } = useStore(account)
  return (
    <button
      type="button"
      onClick={() => void runCommand("ACCOUNT")}
      title={user ? user.email : "Working as the guest. Open the Account tab to sign in."}
      className={`${FIELD} hover:bg-hover hover:text-ink`}
    >
      {user ? user.display_name : "Guest"}
    </button>
  )
}

export function StatusBar() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    GetAppVersion()
      .then((v) => {
        if (!stale) setVersion(v)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [])

  return (
    <footer className="flex h-7 shrink-0 items-center gap-0.5 border-t border-sunken bg-chrome px-1 text-[11px] text-muted">
      <span className="flex h-6 items-center rounded-sm bg-raised px-3 text-[12px] font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-accent)]">
        Map
      </span>
      <span className="flex-1" />
      <RunCell />
      <CursorCell />
      <Rule />
      <ZoomCell />
      <Rule />
      <SidecarCell />
      <Rule />
      {TOGGLES.map((t) => (
        <Toggle key={t.command} {...t} />
      ))}
      <Rule />
      <UserCell />
      {version && <Cell>v{version}</Cell>}
    </footer>
  )
}

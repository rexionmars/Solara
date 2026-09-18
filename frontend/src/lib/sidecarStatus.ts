import { Ping } from "../../wailsjs/go/main/App"
import { createStore } from "./store"

export type SidecarState =
  | { kind: "checking" }
  | { kind: "ready"; python: string; version: string }
  | { kind: "failed"; python: string; message: string }

export const sidecar = createStore<SidecarState>({ kind: "checking" })

let inFlight: Promise<SidecarState> | null = null

/**
 * Start the sidecar with the ping action and publish the result.
 *
 * Calls made while a check is running share it, so the workbench mounting
 * twice under StrictMode, or PING typed during the startup check, starts one
 * interpreter rather than two.
 */
export function checkSidecar(): Promise<SidecarState> {
  if (inFlight) return inFlight
  sidecar.set({ kind: "checking" })
  inFlight = Ping()
    .then(
      (s): SidecarState =>
        s.ok
          ? { kind: "ready", python: s.python, version: s.version ?? "" }
          : { kind: "failed", python: s.python, message: s.error ?? "unknown error" }
    )
    .catch((e: unknown): SidecarState => ({ kind: "failed", python: "", message: String(e) }))
    .then((state) => {
      sidecar.set(state)
      inFlight = null
      return state
    })
  return inFlight
}

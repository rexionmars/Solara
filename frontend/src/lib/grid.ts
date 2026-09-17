import { InspectGridStore, SetGridStore } from "../../wailsjs/go/main/App"
import type { grid } from "../../wailsjs/go/models"
import { errorMessage } from "./errors"
import { fail, info, note } from "./reports"
import { createStore } from "./store"

/**
 * The grid store: the local PostGIS database TERRA loads with the Brazilian
 * electrical record, as TERRA's plantRegister.ts and its store card read it.
 *
 * Whether the store answered, what it holds, and which database it is: the
 * variable, the one chosen in Settings, or the default.
 */

// ---- The store ----------------------------------------------------------------------

export type GridStoreState =
  | { kind: "unknown" }
  | { kind: "checking"; last: grid.StoreReport | null }
  | { kind: "known"; report: grid.StoreReport }
  | { kind: "failed"; message: string }

export const gridStore = createStore<GridStoreState>({ kind: "unknown" })

/** The last report, whatever is happening now. */
export function storeReport(s: GridStoreState = gridStore.get()): grid.StoreReport | null {
  return s.kind === "known" ? s.report : s.kind === "checking" ? s.last : null
}

export const storeReachable = (s: GridStoreState = gridStore.get()) => !!storeReport(s)?.reachable

/** Where the DSN came from, in the words the settings screen uses. */
export function dsnSourceLabel(source: string): string {
  if (source === "TERRA_BR_DSN") return "set by TERRA_BR_DSN"
  if (source === "chosen") return "chosen here"
  return "the default"
}

function settle(report: grid.StoreReport, announce: boolean): void {
  gridStore.set({ kind: "known", report })
  if (!announce) return
  if (report.reachable) {
    const c = report.coverage
    info(`Grid store reachable: ${c?.plants.registered.toLocaleString() ?? 0} plants, ${c?.network.lines_in_service.toLocaleString() ?? 0} lines in service.`)
  } else {
    fail(`Grid store unreachable: ${report.unreachable}`)
  }
}

/** Check the store. Quiet unless `announce`, which a button that asked for it sets. */
export async function checkGridStore(announce = false): Promise<void> {
  gridStore.set({ kind: "checking", last: storeReport() })
  try {
    settle(await InspectGridStore(), announce)
  } catch (e) {
    const message = errorMessage(e)
    gridStore.set({ kind: "failed", message })
    if (announce) fail(`Could not check the grid store: ${message}`)
  }
}

/**
 * Point the grid products at another store; an empty DSN returns to the
 * default. The shell refuses a store that does not answer and saves nothing,
 * so the report comes back unreachable and the choice is unchanged.
 */
export async function chooseGridStore(dsn: string): Promise<boolean> {
  gridStore.set({ kind: "checking", last: storeReport() })
  try {
    const report = await SetGridStore(dsn)
    const refused = !!dsn.trim() && !report.reachable && report.dsn_source === "chosen"
    settle(report, false)
    if (refused) {
      fail(`Not saved: ${report.unreachable}`)
      return false
    }
    if (report.dsn_source === "TERRA_BR_DSN") note("Saved, but TERRA_BR_DSN is set and is what the grid products read.")
    else info(dsn.trim() ? "Grid store chosen." : "Grid store back to the default.")
    return true
  } catch (e) {
    const message = errorMessage(e)
    gridStore.set({ kind: "failed", message })
    fail(`Could not set the grid store: ${message}`)
    return false
  }
}

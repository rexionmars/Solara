import { ParameterDefaults } from "../../wailsjs/go/main/App"
import type { energy } from "../../wailsjs/go/models"
import { createStore } from "./store"

/**
 * The defaults the sidecar applies to a setting left empty, as it reports
 * them. Null until it has answered, or when it could not.
 *
 * Read from the sidecar rather than restated here: TERRA mirrored every Python
 * constant into TypeScript with nothing linking the two, and the interface
 * went on showing values the sidecar no longer used.
 */
export const defaults = createStore<energy.ParameterDefaults | null>(null)

let loading: Promise<void> | null = null

export function loadDefaults(): Promise<void> {
  if (!loading) {
    loading = ParameterDefaults()
      .then((d) => defaults.set(d ?? null))
      .catch(() => {
        // Retried on the next engine check; the fields read "default" meanwhile.
        loading = null
      })
  }
  return loading
}

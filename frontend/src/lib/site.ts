import { print } from "./commandLog"
import { formatLat, formatLng } from "./format"
import { createStore } from "./store"

/**
 * The site the energy products are computed at: one point, placed by clicking
 * the map after SITE, or typed as SITE <lat> <lon>.
 *
 * A point rather than an area because the solar resource and the wind
 * screening both resolve to one reanalysis cell; an area arrives with the
 * terrain product, which resolves within it.
 */
export type Site = { lon: number; lat: number }

export type SiteState = { point: Site | null; picking: boolean }

export const site = createStore<SiteState>({ point: null, picking: false })

export function startPicking(): void {
  site.set((s) => ({ ...s, picking: true }))
}

export function cancelPicking(): void {
  if (!site.get().picking) return
  site.set((s) => ({ ...s, picking: false }))
  print("Site selection cancelled.")
}

export function placeSite(point: Site): void {
  site.set({ point, picking: false })
  print(`Site set at ${formatLat(point.lat)}  ${formatLng(point.lon)}.`)
}

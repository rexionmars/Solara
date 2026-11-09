/**
 * The splash stills: what they are, where they came from, and which one shows.
 *
 * One still for now, this application's own. The two carried over from TERRA's
 * manifest, Windfarm and Ember, were retired when Ridge arrived: a launch that
 * rotated through three showed the featured one a third of the time. Ridge's
 * wind turbines gave way to Array, a solar farm, on 2026-11-09.
 * WebP at 1600 px, which is what the 420x280 splash window needs.
 *
 * index.html paints a still before any bundle loads. Its list of paths is
 * substituted from SPLASH_STILLS at build time by the splash-constants plugin in
 * vite.config.ts, so this file is the only place the list is written.
 */

export type SplashStill = {
  /** The code name. Names the release that features it. */
  name: string
  path: string
  /** What the photograph shows, for whoever has to pick one later. */
  subject: string
  /**
   * Pexels images require no attribution. The source is recorded as the only
   * route back to the original if it ever needs re-encoding.
   */
  source: string
  photographer: string
  /** The application version that introduced it. */
  since: string
}

export const SPLASH_STILLS: SplashStill[] = [
  {
    name: "Array",
    path: "/splash/array.webp",
    subject: "rows of solar panels on bare ochre ground under a blue sky with low clouds, a puddle and young grass in front",
    source: "https://www.pexels.com/photo/19205947/",
    // The Pexels user name, as the downloaded file names it; the page itself refuses automated reads.
    photographer: "gunas4life",
    since: "1.0.0",
  },
]

/**
 * The still the start card shows. Ridge was both this and RELEASE_NAME until
 * its photograph was replaced; the release keeps its name, which a tag carries.
 */
export const FEATURED_STILL = "Array"

/*
  Storage keys. index.html writes the same two keys in its inline script, which
  cannot import these; a rename has to be made in both places.
*/
export const SPLASH_NEXT_KEY = "terra-energy.splash.next"
export const SPLASH_CURRENT_KEY = "terra-energy.splash.current"

/**
 * The still for this launch, as an index into SPLASH_STILLS.
 *
 * index.html claims first and records its choice in sessionStorage; this reads
 * that choice back instead of advancing again, so the image does not change
 * between the static splash and the React one. Called with nothing recorded
 * (the development server in a browser tab), it claims the next still itself.
 */
export function claimSplashStill(count: number = SPLASH_STILLS.length): number {
  if (count <= 0) return 0

  try {
    const current = sessionStorage.getItem(SPLASH_CURRENT_KEY)
    if (current != null) {
      const parsed = Number.parseInt(current, 10)
      if (Number.isFinite(parsed)) return ((parsed % count) + count) % count
    }
  } catch {
    /* sessionStorage unavailable */
  }

  let next = 0
  try {
    const parsed = Number.parseInt(localStorage.getItem(SPLASH_NEXT_KEY) ?? "0", 10)
    if (Number.isFinite(parsed)) next = parsed
  } catch {
    /* localStorage unavailable */
  }

  const index = ((next % count) + count) % count
  try {
    localStorage.setItem(SPLASH_NEXT_KEY, String((index + 1) % count))
    sessionStorage.setItem(SPLASH_CURRENT_KEY, String(index))
  } catch {
    /* quota exceeded or private mode */
  }
  return index
}

/**
 * The splash stills: what they are, where they came from, and which one shows.
 *
 * Both come from TERRA's own manifest, where they were introduced in 0.4.0 and
 * later retired from that product; their provenance is carried over unchanged.
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
    name: "Windfarm",
    path: "/splash/windfarm.webp",
    subject: "three turbines silhouetted against a sunset",
    source: "https://www.pexels.com/photo/34316533/",
    photographer: "Arlind Photography",
    since: "0.1.0",
  },
  {
    name: "Ember",
    path: "/splash/ember.webp",
    subject: "turbines under a burning sky",
    source: "https://www.pexels.com/photo/19564402/",
    photographer: "stonesdonotdisappear",
    since: "0.1.0",
  },
]

/** The still this release is named for. Equal to RELEASE_NAME in brand.ts. */
export const FEATURED_STILL = "Windfarm"

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

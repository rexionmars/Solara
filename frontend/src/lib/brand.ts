/**
 * How the application names itself on the splash.
 *
 * Read by the React splash and, at build time, substituted into the static
 * splash in index.html, which paints before any bundle loads and so cannot
 * import this module. See the splash-constants plugin in vite.config.ts.
 */
export const BRAND_TAGLINE = "Energy engine"

/**
 * The name of this release, fixed for the version, as its tag has it. It was
 * taken from the still the release featured; it does not follow the stills,
 * which change on their own (FEATURED_STILL in splashBackground.ts).
 */
export const RELEASE_NAME = "Ridge"

/** Where the source, the issues and the README live; the rail's Help and Feedback open it. */
export const REPO_URL = "https://github.com/rexionmars/TerraEnergyEngine"

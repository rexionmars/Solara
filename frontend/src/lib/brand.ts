/**
 * How the application names itself on the splash.
 *
 * Read by the React splash and, at build time, substituted into the static
 * splash in index.html, which paints before any bundle loads and so cannot
 * import this module. See the splash-constants plugin in vite.config.ts.
 */
export const BRAND_TAGLINE = "energy engine"

/**
 * The name of this release, fixed for the version. It names the still the
 * release features (FEATURED_STILL in splashBackground.ts) and does not follow
 * whichever still a given launch shows.
 */
export const RELEASE_NAME = "Windfarm"

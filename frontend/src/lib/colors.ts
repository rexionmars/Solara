/*
  Colours the map draws with. MapLibre and terra-draw take literal colours, not
  CSS variables, so these restate tokens from index.css.
*/

/** The active object: --p-accent, the only hue the chrome spends, as TERRA marks what is chosen. */
export const ACTIVE = "#61a7ff" as const

/** Areas that are not active: --p-text, so the accent is left to the active one. */
export const AREA = "#dddddd" as const

/** Sites that are not active. */
export const SITE = "#dddddd" as const
export const SITE_OUTLINE = "#181818" as const

/** Where a register reaches: --p-kind-area, the hue an area already carries. */
export const REACH = "#6da4d3" as const

/** A hairline on the map: --p-line. */
export const HAIRLINE = "#5b5b5b" as const

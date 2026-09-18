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

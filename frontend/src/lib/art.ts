/**
 * The drawings that stand in for the Phosphor glyphs: KDE's Breeze icons.
 *
 * Breeze is LGPL-3.0-or-later, so the files are in the repository, in
 * public/icons/breeze beside its licence. frontend/scripts/breeze_icons.py
 * copies them from Breeze and says which icon each one is. A command is drawn
 * in one ink, as Breeze draws its actions; a thing -- a folder, the sun, a
 * file of a kind -- is in colour.
 *
 * A drawing is named for what it MEANS in this application ("site", "store",
 * "run-again"), not for the file it came from, so the set is swapped without
 * touching whoever asks for one. A name Breeze has no drawing for answers
 * with nothing, and the caller keeps its glyph.
 */

/** Breeze has no drawing for these. */
const WITHOUT = new Set(["terrain", "ground"])

/** Where a drawing is. */
export function artSrc(art: string | undefined): string | undefined {
  return art && !WITHOUT.has(art) ? `/icons/breeze/${art}.svg` : undefined
}

/**
 * Which drawing each operator asks for. Keyed by the operator's name, so the
 * ribbon, the menus, the operator search and the start screen draw one command
 * the same way wherever it is reached. An operator with no entry keeps its glyph.
 */
const OPERATOR_ART: Record<string, string> = {
  NEW: "new",
  OPEN: "folder-open",
  SAVE: "save",
  SAVEAS: "save-as",
  REVEAL_PROJECT: "reveal",
  EXPORT_CSV: "csv",
  EXPORT_JSON: "json",
  EXPORT_GEOTIFF: "geotiff",
  EXPORT_TABLE: "table",
  QUIT: "quit",
  UNDO: "undo",
  REDO: "redo",
  ADJUST_LAST: "adjust",
  SEARCH: "locate",
  RENAME: "rename",
  DELETE: "delete",
  LEGEND: "legend",
  HIDE: "hide",
  UNHIDE_ALL: "show",
  SELECT_NONE: "select-none",
  PREFERENCES: "adjust",
  SITE_ADD: "site",
  TOOL_SELECT: "select",
  TOOL_SITE: "site",
  AREA_PLACE: "area",
  TOOL_MEASURE: "measure",
  LOCATE: "locate",
  ZOOMIN: "zoom-in",
  ZOOMOUT: "zoom-out",
  FRAME_ALL: "frame-all",
  FRAME_SELECTED: "frame-selected",
  NORTH: "north",
  SOLAR: "solar",
  WIND: "wind",
  TERRAIN: "terrain",
  CONNECTION: "connection",
  DEMAND: "demand",
  GROUND: "ground",
  GRID_STORE: "store",
  RERUN: "run-again",
  CANCEL: "cancel",
  PING: "check",
  AREA_MAXIMIZE: "fullscreen",
  RESET_LAYOUT: "reset",
  FULLSCREEN: "fullscreen",
  HELP: "help",
  KEYMAP: "keymap",
  ABOUT: "about",
  ACCOUNT: "account",
  LOGOUT: "logout",
}

export const operatorArt = (name: string): string | undefined => OPERATOR_ART[name]

/** Which drawing each editor asks for, on its area's header and in the menu that changes it. */
const EDITOR_ART: Record<string, string> = {
  map: "area",
  graph: "run-graph",
  outliner: "legend",
  properties: "adjust",
  table: "data",
  reports: "reports",
  console: "scripting",
  solar: "solar",
  wind: "wind",
  terrain: "terrain",
  connection: "connection",
  demand: "demand",
  ground: "ground",
}

export const editorArt = (id: string): string | undefined => EDITOR_ART[id]

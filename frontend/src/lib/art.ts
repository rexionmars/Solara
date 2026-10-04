/**
 * The coloured drawings on trial in place of the Phosphor glyphs, and which
 * set of them is being looked at.
 *
 * A TRIAL, NOT A DECISION. The files are in public/icons and are not
 * committed. "office" is Icons8's Office style and "fluent" its Windows 11
 * Color style: Icons8's licence asks for a link in the product or a paid plan,
 * and whether it allows the files in a public repository is still to be read.
 * "vs" is Microsoft's Visual Studio Image Library, whose licence allows
 * testing and forbids publishing the files, so it is here to be looked at and
 * for nothing else.
 *
 * A drawing is named for what it MEANS in this application ("site", "terrain",
 * "run-again"), not for the file it came from, so a set is swapped without
 * touching whoever asks for one. A name the set on trial has no drawing for
 * answers with nothing, and the caller keeps its glyph.
 */

export type ArtSet = "office" | "fluent" | "vs"

export const ART_SET: ArtSet = "fluent"

/** The Microsoft set has no drawing for these. */
const VS_WITHOUT = new Set(["select-none", "wind", "logout"])

/**
 * Where a drawing is. `large` asks for the one made for a tall button: Office
 * is drawn twice, at 40 px and at 16 px, and the small one is a different
 * drawing rather than the large one made small. The other sets have one.
 */
export function artSrc(art: string | undefined, large?: boolean): string | undefined {
  if (!art) return undefined
  if (ART_SET === "vs") return VS_WITHOUT.has(art) ? undefined : `/icons/vs/${art}.svg`
  if (ART_SET === "fluent") return `/icons/fluent/${art}.png`
  return `/icons/office/${large ? 40 : 16}/${art}.png`
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
}

export const editorArt = (id: string): string | undefined => EDITOR_ART[id]

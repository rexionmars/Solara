import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl"

/*
  A dark street map drawn from OpenFreeMap's vector tiles (the OpenMapTiles
  schema, OpenStreetMap data). No key and no request quota; the attribution is
  required by the licence of the data.

  The style is written here rather than loaded from the provider, so the map
  is drawn in the workbench's own greys, the Dark neutral scale: land is
  --color-surface, roads step up the scale by class, and labels are its light
  steps over a halo of the land colour. Hue stays out of the basemap, as it stays out of the chrome, and
  is left to the data drawn on top of it.
*/
export const BASEMAP_NAME = "OpenFreeMap Dark"

// The tiles carry detail to this zoom; past it they are drawn larger.
export const BASEMAP_MAX_ZOOM = 14

// Steps of the Dark neutral scale (see index.css).
const LAND = "#171717" // 100, as --color-surface
const WATER = "#0a0a0a" // 50
const GREEN = "#262626" // 200, drawn translucent
const BUILDING = "#262626" // 200
const ROAD_MINOR = "#262626" // 200
const ROAD_MID = "#373737" // 300
const ROAD_MAJOR = "#373737" // 300, wider than mid
const ROAD_MOTORWAY = "#525252" // 400
const RAIL = "#525252" // 400
const BOUNDARY = "#525252" // 400
const LABEL_DIM = "#8a8a8a" // 500
const LABEL = "#a3a3a3" // 600
const LABEL_BRIGHT = "#d4d4d4" // 700

const REGULAR = ["Noto Sans Regular"]
const ITALIC = ["Noto Sans Italic"]
const BOLD = ["Noto Sans Bold"]

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name"]]

/** A line width that grows with zoom, from `min` at z`from` to `max` at z20. */
function width(from: number, min: number, max: number): ExpressionSpecification {
  return ["interpolate", ["exponential", 1.5], ["zoom"], from, min, 20, max]
}

function road(id: string, classes: string[], color: string, minzoom: number, w: ExpressionSpecification): LayerSpecification {
  return {
    id,
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom,
    filter: ["match", ["get", "class"], classes, true, false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": w },
  }
}

const HALO = { "text-halo-color": LAND, "text-halo-width": 1.2, "text-halo-blur": 0.5 }

/** The first label layer. Layers the application adds go below it, so names stay readable over data. */
export const BASEMAP_FIRST_LABEL = "water-name"

export const BASEMAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    openmaptiles: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution:
        '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": LAND } },

    // --- Ground
    {
      id: "park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "park",
      paint: { "fill-color": GREEN, "fill-opacity": 0.5 },
    },
    {
      id: "landcover-wood",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      filter: ["match", ["get", "class"], ["wood", "grass"], true, false],
      paint: { "fill-color": GREEN, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 9, 0.4] },
    },
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": WATER } },
    {
      id: "waterway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      paint: { "line-color": WATER, "line-width": width(8, 0.5, 6) },
    },
    {
      id: "building",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 16,
      paint: { "fill-color": BUILDING, "fill-outline-color": ROAD_MID },
    },
    {
      id: "boundary-state",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": BOUNDARY, "line-width": 0.8, "line-dasharray": [3, 2], "line-opacity": 0.7 },
    },
    {
      id: "boundary-country",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": BOUNDARY, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 10, 1.6] },
    },

    // --- Roads, least important first so the major ones draw over junctions
    road("road-path", ["path", "track"], ROAD_MINOR, 14, width(14, 0.5, 3)),
    road("road-minor", ["minor", "service"], ROAD_MINOR, 12, width(12, 0.5, 14)),
    road("road-mid", ["secondary", "tertiary"], ROAD_MID, 9, width(9, 0.5, 18)),
    road("road-major", ["primary", "trunk"], ROAD_MAJOR, 6, width(6, 0.5, 22)),
    road("road-motorway", ["motorway"], ROAD_MOTORWAY, 5, width(5, 0.6, 26)),
    {
      id: "rail",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 11,
      filter: ["match", ["get", "class"], ["rail", "transit"], true, false],
      paint: { "line-color": RAIL, "line-width": 1, "line-dasharray": [6, 2, 1, 2] },
    },

    // --- Labels
    {
      id: BASEMAP_FIRST_LABEL,
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "water_name",
      layout: { "text-field": NAME, "text-font": ITALIC, "text-size": 12, "symbol-placement": "point" },
      paint: { "text-color": LABEL_DIM, ...HALO, "text-halo-color": WATER },
    },
    {
      id: "road-name",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 13,
      layout: {
        "text-field": NAME,
        "text-font": REGULAR,
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 18, 14],
        "symbol-placement": "line",
        "text-rotation-alignment": "map",
      },
      paint: { "text-color": LABEL, ...HALO },
    },
    {
      id: "poi-name",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: 16,
      // Landmarks only, as a street map names them; squares, shops and addresses would bury the streets.
      filter: ["match", ["get", "class"], ["college", "hospital", "stadium"], true, false],
      layout: { "text-field": NAME, "text-font": ITALIC, "text-size": 11, "text-max-width": 8 },
      paint: { "text-color": LABEL_DIM, ...HALO },
    },
    {
      id: "place-neighbourhood",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 12,
      filter: ["match", ["get", "class"], ["suburb", "quarter", "neighbourhood"], true, false],
      layout: {
        "text-field": NAME,
        "text-font": REGULAR,
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 14],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.12,
        "text-max-width": 7,
      },
      paint: { "text-color": LABEL, ...HALO },
    },
    {
      id: "place-village",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 10,
      filter: ["match", ["get", "class"], ["village", "hamlet"], true, false],
      layout: { "text-field": NAME, "text-font": REGULAR, "text-size": 11 },
      paint: { "text-color": LABEL, ...HALO },
    },
    {
      id: "place-town",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 7,
      filter: ["==", ["get", "class"], "town"],
      layout: { "text-field": NAME, "text-font": REGULAR, "text-size": ["interpolate", ["linear"], ["zoom"], 7, 11, 14, 15] },
      paint: { "text-color": LABEL_BRIGHT, ...HALO },
    },
    {
      id: "place-city",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 4,
      filter: ["==", ["get", "class"], "city"],
      layout: {
        "text-field": NAME,
        "text-font": ["step", ["zoom"], ["literal", REGULAR], 8, ["literal", BOLD]],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, ["case", ["<=", ["get", "rank"], 3], 13, 11], 12, 18],
      },
      paint: { "text-color": LABEL_BRIGHT, ...HALO },
    },
    {
      id: "place-state",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 4,
      maxzoom: 9,
      filter: ["==", ["get", "class"], "state"],
      layout: {
        "text-field": NAME,
        "text-font": REGULAR,
        "text-size": 11,
        "text-transform": "uppercase",
        "text-letter-spacing": 0.15,
        "text-max-width": 8,
      },
      paint: { "text-color": LABEL_DIM, ...HALO },
    },
    {
      id: "place-country",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      maxzoom: 7,
      filter: ["==", ["get", "class"], "country"],
      layout: {
        "text-field": NAME,
        "text-font": BOLD,
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 11, 6, 15],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.15,
        "text-max-width": 8,
      },
      paint: { "text-color": LABEL, ...HALO },
    },
  ],
}

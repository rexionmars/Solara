import type { Map as MapLibreMap } from "maplibre-gl"
import type { Overlays } from "./tools"

/**
 * The registers that publish themselves, drawn straight from their own
 * services rather than from the local store.
 *
 * WHY THESE ARE RASTER AND NOT FEATURES. Every one of them is asked for as a
 * picture: a map tile, or ArcGIS's export, over the tile the map is about to
 * draw. The alternative is to pull the whole layer as GeoJSON, which is
 * megabytes of geometry that the reader can neither click nor query any more
 * usefully than they can read it. A picture also crosses the webview without
 * a CORS negotiation, which a government geoserver is not obliged to grant.
 *
 * The cost of that choice is honest and worth stating: these layers cannot be
 * picked. They say where something is, not what it is. When one of them needs
 * to answer a question about a single feature, it wants a WFS read into the
 * grid store, not a bigger raster.
 */

export type ServiceKey = "nightLights" | "sigel"

export type ServiceLayer = {
  key: ServiceKey & keyof Overlays
  /** The source and layer id; also the prefix the error handler matches on. */
  id: string
  /** What the console calls it when the service refuses. */
  label: string
  tiles: () => string
  tileSize: number
  /** Past this the tiles are stretched rather than fetched. */
  maxzoom?: number
  opacity: number
  /**
   * Where it sits. "ground" is with the registers, under the areas a reader
   * draws; "weather" is further down, under the grid, where the observed
   * layers already are.
   */
  anchor: "ground" | "weather"
}

// ---- Nighttime lights --------------------------------------------------------------------

/*
  NASA GIBS serves the Black Marble day/night band as web map tiles, the same
  service and the same URL shape the GOES clouds already come from.

  THE GAP-FILLED, BRDF-CORRECTED PRODUCT AND NOT THE PLAIN ONE. The plain
  near-constant-contrast layer is prettier and stops in 2023; this one is
  corrected for moonlight, atmosphere and surface reflectance, and is current
  to about yesterday. What a reader wants from it -- whether the lights here
  are as bright as the consumption record says -- is a radiance comparison,
  and only the corrected product supports one.
*/
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
const NIGHT_LAYER = "VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance"

/**
 * The most recent night the product is likely to carry. It is published with
 * a lag of a day or two, so the map asks for a date already past rather than
 * for a date that answers 404 on most days.
 */
export function nightLightsDate(now = new Date()): string {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - 2)
  return d.toISOString().slice(0, 10)
}

// ---- The services ------------------------------------------------------------------------

export const SERVICES: ServiceLayer[] = [
  {
    key: "nightLights",
    id: "svc-night-lights",
    label: "Nighttime lights",
    tiles: () => `${GIBS}/${NIGHT_LAYER}/default/${nightLightsDate()}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
    tileSize: 256,
    // The product is served to level 8 and no further.
    maxzoom: 8,
    opacity: 0.8,
    anchor: "weather",
  },
  {
    /*
      ANEEL's own map of the sector. Two of its layers are drawn, and both are
      things the local store does not hold: the turbines one by one, and the
      strips already declared of public utility -- ground where a corridor is
      committed, whether or not a line stands on it yet.

      EPSG:4674 is what the service publishes in; it is SIRGAS 2000, which at
      this scale is WGS84 to within a metre, and the export is asked for in
      3857 anyway.
    */
    key: "sigel",
    id: "svc-sigel",
    label: "SIGEL (ANEEL)",
    tiles: () =>
      "https://sigel.aneel.gov.br/arcgis/rest/services/PORTAL/WFS/MapServer/export" +
      "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512" +
      // 0 is Aerogeradores, 14 is Declaração de Utilidade Pública.
      "&layers=show%3A0%2C14&format=png32&transparent=true&f=image",
    tileSize: 512,
    opacity: 0.9,
    anchor: "ground",
  },
]

/** The credit each service is owed, shown at the foot while its layer is drawn. */
export const SERVICE_CREDITS: Record<ServiceKey, { label: string; href: string }> = {
  nightLights: { label: "NASA GIBS / Black Marble", href: "https://www.earthdata.nasa.gov/data/projects/black-marble" },
  sigel: { label: "SIGEL / ANEEL", href: "https://sigel.aneel.gov.br" },
}

/**
 * Put each service's layer on the map, or hide it.
 *
 * Added when first asked for and kept from then on: the source is one request
 * per tile, so a layer switched off costs nothing while it is hidden, and a
 * layer switched on again should not have to be built a second time.
 *
 * `anchorFor` is passed in because where a layer belongs is the map's
 * business, not this module's: it is the one thing here that depends on what
 * else the application has drawn.
 */
export function applyServices(
  m: MapLibreMap,
  isOn: (key: ServiceKey) => boolean,
  anchorFor: (anchor: ServiceLayer["anchor"]) => string,
): void {
  for (const service of SERVICES) {
    const on = isOn(service.key)
    if (!m.getSource(service.id)) {
      if (!on) continue
      m.addSource(service.id, {
        type: "raster",
        tiles: [service.tiles()],
        tileSize: service.tileSize,
        ...(service.maxzoom === undefined ? {} : { maxzoom: service.maxzoom }),
      })
      m.addLayer(
        {
          id: service.id,
          type: "raster",
          source: service.id,
          paint: { "raster-opacity": service.opacity, "raster-fade-duration": 0 },
        },
        anchorFor(service.anchor),
      )
      continue
    }
    m.setLayoutProperty(service.id, "visibility", on ? "visible" : "none")
  }
}

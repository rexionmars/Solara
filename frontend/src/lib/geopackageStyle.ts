import type { Feature } from "geojson"

export type PackageStyle = { color?: string; field?: string; categories?: Record<string, string> }

/** Accept only literal colors understood by both CSS and MapLibre. */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== "string") return null
  const color = value.trim()
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) return color
  if (/^(?:red|blue|green|orange|yellow|purple|cyan|magenta|black|white|gr[ae]y|transparent)$/i.test(color)) return color.toLowerCase()
  const rgb = color.match(/^(?:rgba?\()?\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)?$/i)
  if (!rgb) return null
  const [r, g, b] = rgb.slice(1, 4).map(Number)
  if ([r, g, b].some(n => n > 255)) return null
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) > 1 ? Number(rgb[4]) / 255 : Number(rgb[4])
  if (alpha > 1) return null
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Random starting hue, spaced by the golden angle for neighboring layers. */
export function paletteColor(index: number, start: number): string {
  const hue = ((start + index * 137.508) % 360) / 60
  const c = 0.6, x = c * (1 - Math.abs(hue % 2 - 1)), m = 0.23
  const rgb = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]
  return "#" + rgb.map(n => Math.round((n + m) * 255).toString(16).padStart(2, "0")).join("")
}

export function featureColor(feature: Feature, style: PackageStyle | undefined, fallback: string): string {
  const props = feature.properties ?? {}
  if (style?.field && style.categories) {
    const color = normalizeColor(style.categories[String(props[style.field])])
    if (color) return color
  }
  const kind = feature.geometry?.type ?? ""
  const keys = kind.includes("Polygon") ? ["fill", "fill-color", "color", "colour"]
    : kind.includes("Line") ? ["stroke", "stroke-color", "color", "colour"]
      : ["marker-color", "marker_color", "color", "colour"]
  for (const key of keys) {
    const color = normalizeColor(props[key])
    if (color) return color
  }
  return normalizeColor(style?.color) ?? fallback
}

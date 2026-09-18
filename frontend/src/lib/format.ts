/** Latitude as unsigned degrees with its hemisphere, e.g. "14.20000° S". */
export function formatLat(lat: number, digits = 5): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? "S" : "N"}`
}

/** Longitude as unsigned degrees with its hemisphere, e.g. "51.90000° W". */
export function formatLng(lng: number, digits = 5): string {
  return `${Math.abs(lng).toFixed(digits)}° ${lng < 0 ? "W" : "E"}`
}

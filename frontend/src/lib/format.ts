/** Latitude as unsigned degrees with its hemisphere, e.g. "14.20000° S". */
export function formatLat(lat: number, digits = 5): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? "S" : "N"}`
}

/** Longitude as unsigned degrees with its hemisphere, e.g. "51.90000° W". */
export function formatLng(lng: number, digits = 5): string {
  return `${Math.abs(lng).toFixed(digits)}° ${lng < 0 ? "W" : "E"}`
}

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * When something was computed, in the reader's own time: "2026-10-04 22:46".
 *
 * A result keeps its moment as an ISO string in UTC, which is right for a
 * file that travels and wrong on a screen: cut to its first sixteen
 * characters it showed 01:46 on the fifth for a run made at 22:46 on the
 * fourth. Every place that prints the moment asks here, so they cannot come
 * to disagree about the day.
 *
 * `short` drops the year, for a label with no room for it. A string that is
 * not a date is returned as it came rather than as "Invalid Date".
 */
export function formatMoment(iso: string, short = false): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return short ? `${day} ${time}` : `${d.getFullYear()}-${day} ${time}`
}

/**
 * The same moment for a file that leaves the application: ISO 8601 in the
 * reader's time with its offset, "2026-10-04T22:46:00-03:00".
 *
 * Local, so it agrees with what the screen showed; with the offset, so it is
 * still one instant to whoever opens the file elsewhere. A local time with no
 * zone is a time nobody else can place.
 */
export function formatMomentIso(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const off = -d.getTimezoneOffset()
  const sign = off < 0 ? "-" : "+"
  const zone = `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${zone}`
  )
}

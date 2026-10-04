/**
 * What a card on the run graph supplies to a run, as TERRA's runValue.ts.
 *
 * One value per card, and three things follow from it: the READING written
 * along the wire the card sends, whether the card SUPPLIES anything at all
 * (a wire from a card that does not is drawn dashed, "not set"), and the
 * SIGNATURE a later run is compared against. They were three tables in TERRA
 * before they were one, and a card could be added to one and not the others.
 */

const num = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "")

export type RunValue =
  /** Where the run reads. `at` is what moves it, and is in the signature but not the reading. */
  | { kind: "ground"; label: string | null; at?: string }
  | { kind: "record"; years: number; of: string; also?: readonly number[] }
  | { kind: "choice"; label: string | null }
  | { kind: "measure"; of: number; unit: string; also?: readonly number[] }
  | { kind: "band"; low: number; high: number; unit: string }
  /** A database a run reads from: supplied only while it answers. */
  | { kind: "store"; reachable: boolean }
  | { kind: "none" }

/** The value as it is written along its wire. Empty when there is nothing to write. */
export function reading(v: RunValue): string {
  switch (v.kind) {
    case "ground":
      return v.label ?? ""
    case "record":
      return Number.isFinite(v.years) ? `${num(v.years)} yr ${v.of}`.trim() : ""
    case "choice":
      return v.label ?? ""
    case "measure":
      return Number.isFinite(v.of) ? `${num(v.of)} ${v.unit}`.trim() : ""
    case "band":
      return Number.isFinite(v.low) && Number.isFinite(v.high) ? `${num(v.low)}-${num(v.high)} ${v.unit}`.trim() : ""
    case "store":
      return v.reachable ? "connected" : "not connected"
    case "none":
      return ""
  }
}

/**
 * Whether the card gives a run what it needs. A number is always supplied:
 * an empty setting is the engine's default, which is a value, not an absence.
 */
export function supplied(v: RunValue): boolean {
  switch (v.kind) {
    case "store":
      return v.reachable
    case "ground":
    case "choice":
      return v.label !== null
    case "record":
    case "measure":
    case "band":
    case "none":
      return true
  }
}

export const signature = (v: RunValue): string => JSON.stringify(v)

/**
 * Which part of a request a value is, and so what colour its card is drawn
 * in: WHERE the run reads, WHEN (the record), HOW (a choice of method), and
 * the VALUES it is given.
 */
export type Subject = "source" | "when" | "method" | "value"

export function subject(v: RunValue): Subject | null {
  switch (v.kind) {
    case "ground":
    case "store":
      return "source"
    case "record":
      return "when"
    case "choice":
      return "method"
    case "measure":
    case "band":
      return "value"
    case "none":
      return null
  }
}

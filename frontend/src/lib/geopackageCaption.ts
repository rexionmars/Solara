import type { Caption } from "../components/editors/OverlayCallouts"
import type { PickedGeoPackage } from "./mapState"
import { titleField, type PackageField } from "./geopackageStyle"
import { formatMoment } from "./format"
import { ClipboardSetText } from "../../wailsjs/runtime/runtime"

type FieldType = PackageField["type"]
export type Detail = { key: string; label: string; value: unknown; type?: FieldType }

/**
 * A value as its column declares it. An integer is as often a code or an
 * identifier as a quantity, so it is never grouped: 2408102 is a municipality,
 * not two million. A column the file did not declare is read by its value.
 */
export function formatValue(v: unknown, type?: FieldType): string {
  if (typeof v === "number") {
    if (type === "boolean") return v === 1 ? "Yes" : v === 0 ? "No" : String(v)
    if (type === "blob") return `Binary, ${v.toLocaleString()} bytes`
    if (type === "integer" || (type === undefined && Number.isInteger(v))) return String(v)
    return v.toLocaleString(undefined, { maximumFractionDigits: 6 })
  }
  if (typeof v === "string" && type === "datetime") return formatMoment(v)
  if (typeof v === "object") return JSON.stringify(v, null, 2)
  return String(v)
}

/** A text value holding a JSON object, such as a column of key=value tags. */
function jsonObject(v: unknown): Record<string, unknown> | null {
  if (typeof v !== "string" || !v.trimStart().startsWith("{")) return null
  try {
    const parsed = JSON.parse(v)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    // A truncated or non-JSON value stays readable as an ordinary one.
    return null
  }
}

/** The attributes in the file's own column order, under their aliases; a text column holding a JSON object becomes a section. */
export function featureDetails(props: Record<string, unknown>, fields: PackageField[] = []) {
  const declared = new Map(fields.map(f => [f.name, f]))
  const keys = [...fields.map(f => f.name).filter(k => k in props), ...Object.keys(props).filter(k => !declared.has(k))]
  const attributes: Detail[] = []
  const sections: { key: string; label: string; entries: [string, unknown][] }[] = []
  for (const key of keys) {
    const value = props[key]
    if (key.startsWith("__solara_") || value === null || value === undefined || value === "") continue
    const field = declared.get(key)
    const label = field?.title ?? key
    const nested = (field?.type ?? "text") === "text" ? jsonObject(value) : null
    if (nested) sections.push({ key, label, entries: Object.entries(nested) })
    else attributes.push({ key, label, value, type: field?.type })
  }
  return { attributes, sections }
}

const NOTES: Partial<Record<PickedGeoPackage["status"], (p: PickedGeoPackage) => string>> = {
  reading: () => "Reading the feature's attributes…",
  failed: p => `Only the attributes the map draws with could be read: ${p.error}`,
}

/** Adapt the source's attributes to the existing map callout; no separate UI. */
export function featureCaption(picked: PickedGeoPackage): Caption {
  const { attributes, sections } = featureDetails(picked.props, picked.fields)
  const named = titleField(picked.fields)
  const titled = attributes.find(a => a.key === named && typeof a.value === "string" && a.value.trim())
  const note = NOTES[picked.status]?.(picked)
  return {
    subject: `${picked.label} · ${picked.geometry}`,
    area: titled ? String(titled.value) : picked.fid !== null ? `Feature ${picked.fid}` : "Feature",
    detail: picked.file,
    color: picked.color,
    body: {
      kind: "stats",
      rows: attributes.filter(a => a !== titled).map(a => ({ label: a.label, value: formatValue(a.value, a.type) })),
      ...(note ? { note } : {}),
      sections: sections.length ? sections.map(s => ({ label: `${s.label} (${s.entries.length})`, rows: s.entries.map(([key, v]) => ({ label: key, value: formatValue(v) })) })) : undefined,
    },
    action: {
      label: "Copy attributes",
      run: async () => {
        const copied = await ClipboardSetText(JSON.stringify(Object.fromEntries([
          ...attributes.map(a => [a.key, a.value]),
          ...sections.map(s => [s.key, Object.fromEntries(s.entries)]),
        ]), null, 2))
        if (!copied) throw new Error("Clipboard unavailable")
      },
    },
  }
}

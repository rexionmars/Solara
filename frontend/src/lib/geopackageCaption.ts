import type { Caption } from "../components/editors/OverlayCallouts"
import type { PickedGeoPackage } from "./mapState"
import { ClipboardSetText } from "../../wailsjs/runtime/runtime"

const LABELS: Record<string, string> = { fid: "Feature ID", osm_id: "OSM ID", name: "Name", operator: "Operator", ref: "Reference", line: "Type", voltage_kv: "Voltage (kV)", output_mw: "Output (MW)", source: "Source", method: "Method" }
const label = (key: string) => LABELS[key] ?? key.replaceAll("_", " ").replace(/^./, c => c.toUpperCase())
const value = (v: unknown): string => typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 6 }) : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v)

export function featureDetails(props: Record<string, unknown>) {
  const entries = Object.entries(props).filter(([k, v]) => !k.startsWith("__solara_") && v !== null && v !== "")
  const tags: [string, unknown][] = []
  const attributes = entries.filter(([key, v]) => {
    if (key !== "tags") return true
    try {
      const parsed = typeof v === "string" ? JSON.parse(v) : v
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        tags.push(...Object.entries(parsed))
        return false
      }
    } catch { /* A truncated or non-JSON tag stays readable as an ordinary value. */ }
    return true
  })
  const priority = ["name", "operator", "ref", "voltage_kv", "output_mw", "source", "method", "line", "osm_id", "fid"]
  attributes.sort(([a], [b]) => (priority.indexOf(a) < 0 ? 99 : priority.indexOf(a)) - (priority.indexOf(b) < 0 ? 99 : priority.indexOf(b)))
  return { attributes, tags }
}

/** Adapt the source's attributes to the existing map callout; no separate UI. */
export function featureCaption(picked: PickedGeoPackage): Caption {
  const { props } = picked
  const { attributes, tags } = featureDetails(props)
  const title = typeof props.name === "string" && props.name.trim() ? props.name : props.ref ? String(props.ref) : `Feature ${props.fid ?? props.osm_id ?? ""}`.trim()
  return {
    subject: `${picked.label} · ${picked.geometry}`,
    area: title,
    detail: picked.file,
    color: picked.color,
    body: {
      kind: "stats",
      rows: attributes.filter(([key]) => key !== "name").map(([key, v]) => ({ label: label(key), value: value(v) })),
      sections: tags.length ? [{ label: `Additional tags (${tags.length})`, rows: tags.map(([key, v]) => ({ label: key, value: value(v) })) }] : undefined,
    },
    action: {
      label: "Copy attributes",
      run: async () => {
        const copied = await ClipboardSetText(JSON.stringify(Object.fromEntries(attributes.concat(tags.length ? [["tags", Object.fromEntries(tags)]] : [])), null, 2))
        if (!copied) throw new Error("Clipboard unavailable")
      },
    },
  }
}

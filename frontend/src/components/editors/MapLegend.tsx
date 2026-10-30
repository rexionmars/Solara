import { useState } from "react"
import { CaretDown, CaretUp } from "../../lib/icons"
import { countRadius, geoPackage, PREVIEW_LIMIT, type PackageLayer } from "../../lib/geopackage"
import { currentMap } from "../../lib/mapEngine"
import { legendsShown, mapView } from "../../lib/mapState"
import { findItem, project, type GroundResult, type TerrainResult } from "../../lib/project"
import { useStore } from "../../lib/store"
import { overlays } from "../../lib/tools"
import { ClassLegend } from "../energy/Legend"
import { captionOf, Ramp } from "./OverlayCallouts"

/** A legend's reference counts are rounded to two figures: they are sizes to read against, not readings. */
function twoFigures(n: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1)
  return Math.round(n / step) * step
}

/** Whether a box in degrees meets the part of the map on screen. */
function inView(box: { lon_min: number; lat_min: number; lon_max: number; lat_max: number }): boolean {
  const b = currentMap()?.getBounds()
  if (!b) return true
  return box.lon_max >= b.getWest() && box.lon_min <= b.getEast() && box.lat_max >= b.getSouth() && box.lat_min <= b.getNorth()
}

/** What a feature layer's swatch is drawn as, from the geometry its file declares. */
function Swatch({ layer, color }: { layer: PackageLayer; color: string }) {
  const g = layer.geometry.toUpperCase()
  if (g.includes("LINE")) {
    return <svg width="18" height="8" aria-hidden className="shrink-0"><path d="M1 4h16" stroke={color} strokeWidth="2" strokeLinecap="round" /></svg>
  }
  if (g.includes("POLYGON") || g.includes("SURFACE")) {
    return <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: `${color}55`, border: `1.5px solid ${color}` }} />
  }
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
}

/**
 * THE MAP'S ONE LEGEND, docked in a corner of the map: the key of every layer
 * that is drawn and in view, and nothing else. A reading's ramp or classes,
 * where its legend was asked for in the outliner; each visible GeoPackage layer
 * with its swatch, or, where it is counted per cell, the circles' sizes. It
 * replaced boxes anchored to each area, which piled up over the ground they
 * explained. Shown while the Legend overlay is on; folds to its head.
 */
export function MapLegend() {
  const [folded, setFolded] = useState(false)
  const d = useStore(project).data
  const o = useStore(overlays)
  const asked = useStore(legendsShown)
  const local = useStore(geoPackage)
  // Read so the legend follows the map: what is in view changes as it moves.
  useStore(mapView)

  if (!o.legend) return null
  const readings = o.layers
    ? d.results.filter(
        (r): r is TerrainResult | GroundResult =>
          (r.kind === "terrain" || r.kind === "ground") && !r.hidden && !findItem(d, r.sourceId)?.hidden && asked.has(r.id) && inView(r.data.extent)
      )
    : []
  const packaged = (local.file?.layers ?? []).filter((l) => local.views[l.name]?.visible && !l.error)
  const total = readings.length + packaged.length
  if (!total) return null
  const counted = packaged.some((l) => local.views[l.name]?.counted)

  return (
    <aside
      aria-label="Legend"
      className="pointer-events-auto flex max-h-[min(70vh,560px)] w-64 flex-col overflow-hidden rounded-[10px] border shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
      style={{ background: "rgb(var(--p-surface) / 0.95)", borderColor: "var(--s-line)" }}
    >
      <button
        type="button"
        onClick={() => setFolded((f) => !f)}
        aria-expanded={!folded}
        className="flex items-center gap-2 px-3 py-2 text-left hover:bg-hover"
        style={folded ? undefined : { borderBottom: "1px solid var(--s-line-soft)" }}
      >
        <span className="text-emphasis font-semibold text-foreground">Legend</span>
        <span className="flex-1 text-meta text-muted-foreground">
          {total} {total === 1 ? "layer" : "layers"} in view
        </span>
        {folded ? <CaretDown className="size-3 text-muted-foreground" /> : <CaretUp className="size-3 text-muted-foreground" />}
      </button>
      {!folded && (
        <div className="panel-scroll flex flex-col gap-3 overflow-y-auto px-3 pb-3 pt-2.5">
          {readings.map((r) => {
            const c = captionOf(d, r)
            return (
              <section key={r.id} className="flex flex-col gap-1">
                <p className="text-body text-foreground">
                  {c.subject} <span className="text-muted-foreground">· {c.area}</span>
                </p>
                {c.detail && <p className="text-micro leading-snug text-muted-foreground">{c.detail}</p>}
                {c.body.kind === "ramp" ? <Ramp scale={c.body.scale} /> : c.body.kind === "classes" ? <ClassLegend classes={c.body.classes} /> : null}
              </section>
            )
          })}
          {packaged.map((layer) => {
            const view = local.views[layer.name]
            const cells = view.counted
            if (!cells) {
              return (
                <p key={layer.name} className="flex items-center gap-2 text-body text-foreground">
                  <Swatch layer={layer} color={view.color} />
                  <span className="truncate">{layer.label}</span>
                </p>
              )
            }
            const sizes = [cells.largest, twoFigures(cells.largest / 4), twoFigures(cells.largest / 16)].filter((n, i, all) => n >= 1 && all.indexOf(n) === i)
            return (
              <section key={layer.name} className="flex flex-col gap-1.5">
                <p className="flex items-center gap-2 text-body text-foreground">
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: view.color }} />
                  <span className="flex-1 truncate">{layer.label}</span>
                  <span className="rounded-[4px] px-1.5 text-micro text-foreground" style={{ background: "rgb(var(--p-surface-raised))" }}>counts</span>
                </p>
                <div className="flex items-end gap-4 pl-4">
                  {sizes.map((n) => {
                    const r = countRadius(n, cells.largest)
                    return (
                      <div key={n} className="flex flex-col items-center gap-1">
                        <svg width={2 * r + 2} height={2 * r + 2} aria-hidden>
                          <circle cx={r + 1} cy={r + 1} r={r} fill={view.color} fillOpacity={0.7} stroke="#14181c" strokeWidth={0.8} />
                        </svg>
                        <span className="telemetry text-micro text-muted-foreground">{n.toLocaleString()}</span>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
          {counted && (
            <p className="text-micro leading-snug text-muted-foreground">
              Counts: more than {PREVIEW_LIMIT.toLocaleString()} in view, one circle per cell. Zoom in to draw each one.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}

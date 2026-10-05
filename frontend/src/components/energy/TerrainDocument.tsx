import { useState } from "react"
import type { energy } from "../../../wailsjs/go/models"
import { grouped, unitLabel } from "../../lib/energyFormat"
import { polygonAreaKm2 } from "../../lib/geo"
import { seasonLabel } from "../../lib/params"
import type { Polygon } from "../../lib/project"
import { Histogram } from "./charts"
import { basisNote } from "./Legend"
import { DetailRow, IndicatorCard, IndicatorRow, ProvenanceNote, ReadingHead, ReadingPage, ReadingPanel, ReadingSource, Segmented } from "./primitives"

/**
 * Irradiation over the ground of an area, on the reading's page: the head,
 * four indicators, and one panel that draws how the area is spread between
 * its least and its most irradiated ground.
 *
 * A NUMBER IS WRITTEN ONCE. The mean, the lowest and the highest cell are the
 * cards'; the chart names its mean line and the ends of its ruler without
 * repeating them. The layer's legend is on the map, where the layer is; the
 * raster's path is in Export, where it is used.
 *
 * THE PANEL'S TITLE IS COUNTED, NOT WRITTEN. It says how much of the area lies
 * within two percent of the mean, in one of three wordings chosen by that
 * share, so two areas that differ do not read the same sentence.
 */

const pct = (v: number | undefined | null, digits = 2) => (v == null ? "—" : v.toFixed(digits))
const deg = (v: number) => `${v.toFixed(1)}°`

/** The share of the area whose interval's centre is within `band` of the mean, in percent. */
function shareNearMean(d: energy.Distribution, mean: number, band = 0.02): number {
  const total = d.cells.reduce((n, c) => n + c, 0) + (d.overflow?.cells ?? 0) || 1
  const near = d.cells.reduce((n, c, i) => (Math.abs((d.edges[i] + d.edges[i + 1]) / 2 - mean) <= band * Math.abs(mean) ? n + c : n), 0)
  return (100 * near) / total
}

function finding(d: energy.Distribution | undefined, mean: number): string {
  if (!d) return "From the lowest to the highest cell"
  const near = shareNearMean(d, mean)
  if (near >= 90) return "Nearly all of the area sits close to the mean"
  if (near >= 60) return "Most of the area sits close to the mean"
  return "The area is spread widely around the mean"
}

export function TerrainBody({ terrain, area }: { terrain: energy.SolarTerrainAnalysis; area: Polygon }) {
  const [mode, setMode] = useState<"share" | "area">("share")
  const t = terrain
  const fmt = (v: number) => v.toFixed(t.scale.decimals)
  const unit = unitLabel(t.unit)
  // "kWh/m² per year" is a unit and its period: the first beside the figure, the second in the sentence under it.
  const [short, period] = unit.split(" per ")
  const window = seasonLabel(t.season)
  const sky = t.sky_view
  const spread = t.distribution
  const step = spread && spread.edges.length > 2 ? spread.edges[1] - spread.edges[0] : null
  const ofMean = t.poa_mean ? Math.round((100 * t.poa_min) / t.poa_mean) : null
  const above = t.poa_mean ? ((100 * (t.poa_max - t.poa_mean)) / t.poa_mean).toFixed(0) : null
  return (
    <ReadingPage>
      <ReadingHead
        title="Solar terrain"
        about={`Irradiation on the plane of the array across ${polygonAreaKm2(area).toFixed(2)} km² of terrain, ${window.toLowerCase()}, with the shading of the horizon.`}
      />

      <IndicatorRow>
        <IndicatorCard title="Mean" sub="Across the whole area" value={fmt(t.poa_mean)} unit={short} chip={`spread ${pct(t.poa_std_pct)}%`}>
          {period ? `Per ${period}, over` : "Over"} {grouped(t.pixels)} cells.
        </IndicatorCard>
        <IndicatorCard
          title="Lowest cell"
          sub="The least irradiated"
          value={fmt(t.poa_min)}
          unit={short}
          chip={ofMean == null ? undefined : `${ofMean}% of mean`}
        >
          The highest cell reaches {fmt(t.poa_max)}
          {above == null ? "." : `, ${above}% above the mean.`}
        </IndicatorCard>
        <IndicatorCard
          title="Beam shading"
          sub="Lost to the horizon"
          value={pct(t.shading_mean_pct)}
          unit="%"
          chip={t.shading_max_pct == null ? undefined : `max ${t.shading_max_pct.toFixed(1)}%`}
        >
          Share of the direct irradiation the relief blocks.
        </IndicatorCard>
        <IndicatorCard title="Slope" sub="Mean over the area" value={t.slope_mean_deg.toFixed(1)} unit="°" chip={`max ${deg(t.slope_max_deg)}`}>
          Of the surface the irradiation falls on.
        </IndicatorCard>
      </IndicatorRow>

      <ReadingPanel
        title={finding(spread, t.poa_mean)}
        sub={step == null ? `Area by ${unit}` : `Area by ${unit}, in steps of ${step.toFixed(step < 1 ? 3 : step < 10 ? 1 : 0)}`}
        controls={
          spread?.area_km2 ? (
            <Segmented
              label="Vertical axis"
              value={mode}
              onChange={setMode}
              options={[
                { value: "share", label: "Share" },
                { value: "area", label: "km²" },
              ]}
            />
          ) : undefined
        }
        note={
          <>
            <p>The ruler under the axis is the colour each value has on the map: {basisNote(t.scale)}.</p>
            <p>
              The irradiation is resolved on NASA POWER's 1° radiation cell; what varies across the area is the surface it falls on, from
              the elevation model at 30 m. Solar position is evaluated at the cell, not at each pixel.
            </p>
          </>
        }
        details={
          <>
            <DetailRow label="Beam share of horizontal irradiation" value={`${pct(t.beam_fraction * 100, 0)}%`} />
            {sky && (
              <DetailRow
                label="Diffuse loss"
                value={sky.applied ? `${pct(sky.diffuse_loss_mean_pct)}% mean, ${pct(sky.diffuse_loss_max_pct)}% maximum` : "not applied, terrain too open"}
              />
            )}
            {sky && <DetailRow label="Horizon, mean" value={deg(sky.mean_horizon_deg)} />}
            {sky && <DetailRow label="Horizon, maximum" value={deg(sky.max_horizon_deg)} />}
            <DetailRow label="Horizon traced to" value={`${(t.horizon_max_dist_m / 1000).toFixed(1)} km`} />
            <DetailRow label="Record" value={`${t.hourly_years} years, hourly`} />
          </>
        }
      >
        {spread ? (
          <Histogram
            edges={spread.edges}
            counts={spread.cells}
            areaKm2={spread.area_km2}
            overflow={spread.overflow ? { below: spread.overflow.below, cells: spread.overflow.cells, areaKm2: spread.overflow.area_km2, lowest: t.poa_min } : null}
            mean={t.poa_mean}
            unit={unit}
            decimals={t.scale.decimals}
            stops={t.scale.stops ?? []}
            domain={[t.scale.min, t.scale.max]}
            mode={mode}
          />
        ) : (
          // A result computed before the distribution was counted has the ends and not the shape.
          <p className="py-6 text-[13px] text-[var(--s-text-muted)]">
            This result was computed before the distribution was counted. Run again to see how the area is spread.
          </p>
        )}
      </ReadingPanel>

      <ReadingSource>
        {t.dem_source} · NASA POWER
        <ProvenanceNote provenance={t.power_provenance} />
      </ReadingSource>
    </ReadingPage>
  )
}

import type { energy } from "../../../wailsjs/go/models"
import { formatLat, formatLng } from "../../lib/format"
import { AreaChart } from "./charts"
import { DetailRow, IndicatorCard, IndicatorRow, ProvenanceNote, ReadingHead, ReadingPage, ReadingPanel, ReadingSource } from "./primitives"

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/**
 * The solar resource of a site, on the reading's page: the head, four
 * indicators, and one panel that draws the year.
 *
 * THE YEAR IS THE ANSWER. GHI, DNI and DHI by month, as daily means: the three
 * are not independent -- GHI is DHI plus the projected DNI -- so they are
 * drawn together. The panel's title is counted from the GHI: how far the best
 * month stands above the worst, or that no month stands ten percent above
 * another.
 *
 * A NUMBER IS WRITTEN ONCE. The capacity factor is the specific yield in
 * another unit, so it is in Details and not on a card of its own; the fourth
 * card is what the first three do not say, how much one year differs from
 * the next.
 */

function finding(monthly: energy.SolarMonth[]): string {
  // A month the record does not carry is left out of the comparison rather than read as zero.
  const known = monthly.flatMap((m) => (m.ghi == null ? [] : [{ month: m.month, ghi: m.ghi }]))
  if (!known.length) return "Through the year"
  const best = known.reduce((a, b) => (b.ghi > a.ghi ? b : a))
  const worst = known.reduce((a, b) => (b.ghi < a.ghi ? b : a))
  const more = worst.ghi > 0 ? (100 * (best.ghi - worst.ghi)) / worst.ghi : 0
  if (more < 10) return "The year is even: no month stands 10% above another"
  return `${MONTH_NAMES[best.month - 1]} gives ${more.toFixed(0)}% more than ${MONTH_NAMES[worst.month - 1]}`
}

export function SolarBody({ solar, site }: { solar: energy.SolarAnalysis; site: { lon: number; lat: number } }) {
  const { resource: r, geometry: g, pv } = solar
  const sign = (v: number) => (v >= 0 ? "+" : "−")
  const byMonth = [...r.monthly].sort((a, b) => a.month - b.month)
  return (
    <ReadingPage>
      <ReadingHead
        title="Solar resource"
        about={`What the sun delivers at ${formatLat(site.lat)} ${formatLng(site.lon)}, and what a fixed array would yield from it.`}
      />

      <IndicatorRow>
        <IndicatorCard
          title="Specific yield"
          sub="Of a fixed array"
          value={pv.specific_yield_kwh_kwp_year.toFixed(0)}
          unit="kWh/kWp"
          chip={`PR ${pv.performance_ratio.toFixed(2)}, ${pv.performance_ratio_source}`}
        >
          Per year, for a 1 kWp reference array.
        </IndicatorCard>
        <IndicatorCard
          title="Annual GHI"
          sub="On the horizontal"
          value={r.ghi_annual_kwh_m2.toFixed(0)}
          unit="kWh/m²"
          chip={`P10 ${r.ghi_p10.toFixed(0)} · P90 ${r.ghi_p90.toFixed(0)}`}
        >
          The sum of a year, between a poor year and a good one.
        </IndicatorCard>
        <IndicatorCard
          title="Optimal tilt"
          sub="For the year's total"
          value={g.optimal_tilt_deg.toFixed(1)}
          unit="°"
          chip={`${sign(g.gain_over_horizontal_pct)}${Math.abs(g.gain_over_horizontal_pct).toFixed(1)}% over horizontal`}
        >
          Facing {g.surface_azimuth_deg.toFixed(0)}° from north.
        </IndicatorCard>
        <IndicatorCard
          title="Year-to-year variation"
          sub="Of the annual GHI"
          value={r.ghi_cv_pct.toFixed(2)}
          unit="%"
          chip={`${sign(r.trend_per_year)}${Math.abs(r.trend_per_year).toFixed(2)} kWh/m² per year`}
        >
          Over {r.n_years} years of record; the chip is its linear trend.
        </IndicatorCard>
      </IndicatorRow>

      <ReadingPanel
        title={finding(byMonth)}
        sub="Irradiation by month, as daily means: global, direct and diffuse"
        note={
          <>
            <p>{solar.grid_note}</p>
            <p>
              The modelled performance ratio runs high: soiling, inter-row shading, degradation, availability and cabling are not modelled, so
              it is shown in Details and not applied.
            </p>
          </>
        }
        details={
          <>
            <DetailRow label="Capacity factor" value={`${pv.capacity_factor_pct.toFixed(1)}%`} />
            <DetailRow label="Plane-of-array at the optimum" value={`${g.optimal_poa_kwh_m2_year.toFixed(0)} kWh/m² per year`} />
            <DetailRow label="Annual GHI, standard deviation" value={`${r.ghi_std.toFixed(1)} kWh/m²`} />
            <DetailRow label="Trend, p-value" value={r.trend_p_value.toFixed(3)} />
            <DetailRow label="Clear-sky index" value={r.clear_sky_index == null ? "—" : r.clear_sky_index.toFixed(3)} />
            <DetailRow label="Performance ratio modelled, not applied" value={pv.performance_ratio_modelled.toFixed(3)} />
            {g.tilt_tolerance.map((t) => (
              <DetailRow key={t.deviation_deg} label={`Tilt ${t.deviation_deg.toFixed(0)}° off the optimum`} value={`−${t.loss_pct.toFixed(2)}%`} />
            ))}
            <DetailRow label="Hourly record" value={`${pv.hourly_years} years`} />
          </>
        }
      >
        <div className="reading-chart">
          <AreaChart
            categories={MONTHS}
            unit="kWh/m² per day"
            format={(v) => v.toFixed(2)}
            height={190}
            series={[
              { key: "ghi", label: "Global (GHI)", color: "#d9d9d9", values: byMonth.map((m) => m.ghi ?? 0), fill: true },
              { key: "dni", label: "Direct (DNI)", color: "rgb(97 167 255)", values: byMonth.map((m) => m.dni ?? 0), unlabelled: true },
              { key: "dhi", label: "Diffuse (DHI)", color: "#b8862f", values: byMonth.map((m) => m.dhi ?? 0), unlabelled: true },
            ]}
          />
        </div>
      </ReadingPanel>

      <ReadingSource>
        NASA POWER · radiation cell at {solar.lat.toFixed(2)}, {solar.lon.toFixed(2)}
        <ProvenanceNote provenance={solar.power_provenance} />
      </ReadingSource>
    </ReadingPage>
  )
}

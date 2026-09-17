import { Label, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { energy } from "../../../wailsjs/go/models"
import { formatLat, formatLng } from "../../lib/format"
import {
  DocumentHeader,
  Figure,
  FigureGrid,
  ProvenanceNote,
  Section,
  Stat,
  StatGrid,
} from "./primitives"

const AXIS = { fontSize: 11, fill: "var(--color-muted-foreground)" }

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * GHI, DNI and DHI by month, as daily means. The three are not independent --
 * GHI is DHI plus the projected DNI -- so they are read together, and each
 * carries a dash as well as a colour so they stay separable in greyscale.
 * Ported from TERRA's SolarResourceSection.
 */
function MonthlyChart({ monthly }: { monthly: energy.SolarMonth[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart
        data={monthly.map((m) => ({
          month: MONTHS[m.month - 1] ?? String(m.month),
          ghi: m.ghi,
          dni: m.dni,
          dhi: m.dhi,
        }))}
        margin={{ top: 6, right: 14, left: 4, bottom: 22 }}
      >
        {/* Categorical: twelve evenly spaced months, not an irregular calendar. */}
        <XAxis dataKey="month" stroke="rgb(var(--p-line))" tick={AXIS} tickMargin={6}>
          <Label value="Month" position="insideBottom" offset={-14} style={{ ...AXIS, fontSize: 12 }} />
        </XAxis>
        <YAxis
          stroke="rgb(var(--p-line))"
          tick={AXIS}
          tickFormatter={(v: number) => v.toFixed(1)}
          width={52}
        >
          <Label
            value="Irradiation (kWh m⁻² d⁻¹)"
            angle={-90}
            position="insideLeft"
            style={{ ...AXIS, fontSize: 12, textAnchor: "middle" }}
          />
        </YAxis>
        <Tooltip
          formatter={(v: number) => v.toFixed(2)}
          contentStyle={{
            backgroundColor: "var(--s-float)",
            border: "1px solid rgb(var(--p-line))",
            borderRadius: 4,
            fontSize: 11,
          }}
          labelStyle={{ color: "var(--color-foreground)" }}
        />
        <Legend verticalAlign="top" align="right" height={20} wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
        {[
          { key: "ghi", label: "GHI", stroke: "var(--color-kind-solar)", dash: undefined },
          { key: "dni", label: "DNI", stroke: "var(--color-accent)", dash: "6 3" },
          { key: "dhi", label: "DHI", stroke: "var(--color-muted-foreground)", dash: "2 3" },
        ].map((s) => (
          <Line
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.label}
            stroke={s.stroke}
            strokeWidth={1.8}
            strokeDasharray={s.dash}
            dot={{ r: 1.8, strokeWidth: 0, fill: s.stroke }}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function SolarBody({ solar, site }: { solar: energy.SolarAnalysis; site: { lon: number; lat: number } }) {
  const { resource: r, geometry: g, pv } = solar
  const trendSign = r.trend_per_year >= 0 ? "+" : ""
  return (
    <>
      <DocumentHeader
        product="Solar resource"
        title={`${formatLat(site.lat)}  ${formatLng(site.lon)}`}
        meta={`Radiation cell at ${solar.lat.toFixed(2)}, ${solar.lon.toFixed(2)} · ${r.n_years} years daily, ${pv.hourly_years} years hourly · NASA POWER`}
      />
      <FigureGrid>
        <Figure
          label="Annual GHI"
          value={`${r.ghi_annual_kwh_m2.toFixed(0)} kWh/m²`}
          sub={`P10 ${r.ghi_p10.toFixed(0)} · P90 ${r.ghi_p90.toFixed(0)}`}
        />
        <Figure
          label="Specific yield"
          value={`${pv.specific_yield_kwh_kwp_year.toFixed(0)} kWh/kWp`}
          sub={`per year · PR ${pv.performance_ratio.toFixed(2)} (${pv.performance_ratio_source})`}
        />
        <Figure
          label="Optimal tilt"
          value={`${g.optimal_tilt_deg.toFixed(1)}°`}
          sub={`${g.gain_over_horizontal_pct.toFixed(1)}% over horizontal`}
        />
        <Figure
          label="Capacity factor"
          value={`${pv.capacity_factor_pct.toFixed(1)}%`}
          sub="1 kWp reference array"
        />
      </FigureGrid>

      <div className="mt-6">
        <Section title="Monthly climatology">
          <MonthlyChart monthly={r.monthly} />
        </Section>
        <Section title="Record">
          <StatGrid>
            <Stat label="Annual GHI, standard deviation" value={`${r.ghi_std.toFixed(1)} kWh/m²`} />
            <Stat label="Coefficient of variation" value={`${r.ghi_cv_pct.toFixed(2)}%`} />
            <Stat
              label="Linear trend"
              value={`${trendSign}${r.trend_per_year.toFixed(2)} kWh/m²/yr · p ${r.trend_p_value.toFixed(3)}`}
            />
            <Stat
              label="Clear-sky index"
              value={r.clear_sky_index == null ? "—" : r.clear_sky_index.toFixed(3)}
            />
          </StatGrid>
        </Section>
        <Section title="Array">
          <StatGrid>
            <Stat label="Surface azimuth" value={`${g.surface_azimuth_deg.toFixed(0)}° from north`} />
            <Stat label="Plane-of-array at optimum" value={`${g.optimal_poa_kwh_m2_year.toFixed(0)} kWh/m²/yr`} />
            <Stat label="Performance ratio applied" value={`${pv.performance_ratio.toFixed(3)} (${pv.performance_ratio_source})`} />
            {/* Runs high: soiling, inter-row shading, degradation, availability
                and cabling are not modelled, so it is shown, not applied. */}
            <Stat label="Performance ratio modelled" value={pv.performance_ratio_modelled.toFixed(3)} />
            {g.tilt_tolerance.map((t) => (
              <Stat
                key={t.deviation_deg}
                label={`Tilt ${t.deviation_deg.toFixed(0)}° off optimum`}
                value={`−${t.loss_pct.toFixed(2)}%`}
              />
            ))}
          </StatGrid>
        </Section>
        <Section title="Resolution">
          <p className="text-xs leading-relaxed text-muted-foreground">{solar.grid_note}</p>
          <ProvenanceNote provenance={solar.power_provenance} />
        </Section>
      </div>
    </>
  )
}

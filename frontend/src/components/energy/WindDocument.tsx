import type { energy } from "../../../wailsjs/go/models"
import { analysis } from "../../lib/analysis"
import {
  airDensityKgM3,
  capacityFactorPct,
  capacityMw,
  energyMwh,
  fitErrorPct,
  meanCubeM3S3,
  patternFactor,
  powerDensityWm2,
  sharePct,
  shearExponent,
  speedMs,
  weibullK,
} from "../../lib/energyFormat"
import { useStore } from "../../lib/store"
import {
  DocumentHeader,
  EYEBROW,
  Figure,
  FigureGrid,
  NoResult,
  ProvenanceNote,
  Section,
  Stat,
  StatGrid,
} from "./primitives"

/*
  The wind screening, ported from TERRA's WindScreening.tsx: the same six
  blocks and the same figures, as statistics rather than prose. The qualifiers
  that do work are structural and stay on screen: the chips reading gross and
  unvalidated beside the heading, and the word Gross in the figure labels.
*/

type Wind = energy.WindAnalysis

/** What the reanalysis carries at its own levels, with no extrapolation. */
function ReanalysisLevels({ wind }: { wind: Wind }) {
  const m = wind.measured
  const fit = m.weibull_fit_check_50m
  return (
    <>
      <FigureGrid>
        <Figure label="Mean speed 10 m" value={speedMs(m.mean_speed_10m_ms)} />
        <Figure label="Mean speed 50 m" value={speedMs(m.mean_speed_50m_ms)} />
        <Figure label="Weibull 50 m" value={`k ${weibullK(m.weibull_k_50m)}`} sub={`c ${speedMs(m.weibull_c_50m_ms)}`} />
        <Figure
          label="Power density 50 m"
          value={powerDensityWm2(m.wind_power_density_50m_w_m2)}
          sub={`pattern factor ${patternFactor(m.energy_pattern_factor_50m)}`}
        />
      </FigureGrid>
      <div className="mt-4">
        <StatGrid>
          <Stat
            label="Weibull mean vs record"
            value={`${speedMs(fit.weibull_mean_ms)} / ${speedMs(fit.empirical_mean_ms)} · ${fitErrorPct(fit.mean_error_pct)}`}
          />
          <Stat
            label="Weibull mean cube vs record"
            value={`${meanCubeM3S3(fit.weibull_mean_cube_m3s3)} / ${meanCubeM3S3(fit.empirical_mean_cube_m3s3)} · ${fitErrorPct(fit.mean_cube_error_pct)}`}
          />
          <Stat label="Air density mean" value={airDensityKgM3(m.air_density_mean_kg_m3)} />
          <Stat
            label="Air density range"
            value={`${m.air_density_min_kg_m3.toFixed(3)} – ${airDensityKgM3(m.air_density_max_kg_m3)}`}
          />
        </StatGrid>
      </div>
    </>
  )
}

/** The operating regime at the hub. */
function HubResult({ wind }: { wind: Wind }) {
  const h = wind.hub
  const r = h.operating_regime
  return (
    <StatGrid>
      <Stat label="Hours above cut-in" value={sharePct(r.above_cut_in_pct)} />
      <Stat label="Hours at or above rated" value={sharePct(r.at_or_above_rated_pct)} />
      <Stat label="Hours above cut-out" value={sharePct(r.above_cut_out_pct)} />
      <Stat
        label="Cut-in / rated / cut-out"
        value={`${r.cut_in_ms.toFixed(1)} / ${r.rated_ms.toFixed(1)} / ${r.cut_out_ms.toFixed(1)} m/s`}
      />
      <Stat label="Hub power density" value={powerDensityWm2(h.wind_power_density_w_m2)} />
      <Stat label="Hub Weibull" value={`k ${weibullK(h.weibull_k)}, c ${speedMs(h.weibull_c_ms)}`} />
      <Stat
        label="Gross capacity factor without density correction"
        value={capacityFactorPct(h.gross_capacity_factor_no_density_correction_pct)}
      />
      <Stat label="Extrapolation" value={`${h.extrapolation.height_ratio.toFixed(1)}× the top measured level`} />
    </StatGrid>
  )
}

/** Whether the record supports the extrapolation the hub figures rest on. */
function FieldDiagnostics({ wind }: { wind: Wind }) {
  const q = wind.data_quality
  const shear = q.shear
  return (
    <>
      <FigureGrid>
        <Figure
          label={`Hours below ${q.calm_threshold_ms} m/s`}
          value={sharePct(q.calm_fraction_pct["10m"] ?? 0)}
          sub={`50 m ${sharePct(q.calm_fraction_pct["50m"] ?? 0)}, 2 m ${sharePct(q.calm_fraction_pct["2m"] ?? 0)}`}
        />
        <Figure
          label="Record maximum 10 m"
          value={speedMs(q.record_maximum_ms["10m"] ?? 0)}
          sub={`floor ${q.record_maximum_floor_ms.toFixed(1)} m/s · ${q.record_maximum_plausible ? "met" : "not met"}`}
        />
        <Figure
          label="Shear exponent"
          value={shearExponent(shear.shear_exponent)}
          sub={`day ${shearExponent(shear.shear_exponent_day)}, night ${shearExponent(shear.shear_exponent_night)}`}
        />
        {/* Null when no roughness length produces this exponent in a neutral
            log profile. Printed as a number it would read as a measured 0 m. */}
        <Figure
          label="Implied roughness"
          value={shear.implied_roughness_length_m == null ? "—" : `${shear.implied_roughness_length_m.toFixed(3)} m`}
          sub={
            shear.implied_roughness_length_m == null
              ? `no inversion; assumed ${shear.assumed_roughness_band_m.join("–")} m`
              : `assumed ${shear.assumed_roughness_band_m.join("–")} m · ${shear.consistent_with_assumed_cover ? "consistent" : "not consistent"}`
          }
        />
      </FigureGrid>
      <div className="mt-4">
        <StatGrid>
          <Stat
            label="Record checks"
            value={q.all_checks_passed ? "all passed" : `${q.flags.length} not passed`}
          />
          <Stat label="Record hours" value={`${q.record_hours} / ${q.expected_hours} expected`} />
          <Stat label="Shear band supported" value={shear.expected_shear_exponent_band.map(shearExponent).join(" – ")} />
        </StatGrid>
      </div>
      {!q.all_checks_passed && (
        <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-[11px] leading-relaxed text-muted">
          {q.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </>
  )
}

/** How far the hub result moves with the exponent it was extrapolated on. */
function ShearSensitivity({ wind }: { wind: Wind }) {
  return (
    <ul className="flex flex-col gap-1">
      {wind.shear_sensitivity.map((s) => (
        <li key={`${s.basis}-${s.shear_exponent}`} className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
          {/* Four decimals on purpose: the rows are chosen to differ there. */}
          <span className="w-16 shrink-0 text-ink">{s.shear_exponent.toFixed(4)}</span>
          <span className="w-20 shrink-0 text-right text-muted">
            {s.roughness_length_m == null ? "—" : `${s.roughness_length_m.toFixed(2)} m`}
          </span>
          <span className="min-w-[5rem] flex-1 truncate font-sans text-muted">{s.basis}</span>
          <span className="w-24 shrink-0 text-right text-ink">{s.hub_speed_ms.toFixed(4)} m/s</span>
          <span className="w-16 shrink-0 text-right text-ink">{s.capacity_factor_pct.toFixed(3)}%</span>
          <span className="w-24 shrink-0 text-right text-muted">{s.annual_energy_mwh.toFixed(1)} MWh</span>
        </li>
      ))}
    </ul>
  )
}

/** When the wind blows over the year, and from where. */
function SeasonAndDirection({ wind }: { wind: Wind }) {
  const m = wind.measured
  const roseMax = Math.max(...m.direction_energy_rose_50m.map((s) => Math.max(s.energy_pct, s.hours_pct)), 0.001)
  const speedMax = Math.max(...m.monthly_mean_speed_50m.map((r) => r.mean_speed_ms), 0.001)
  return (
    <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-2">
      <div>
        <p className={`${EYEBROW} mb-2`}>Mean speed at 50 m by month, m/s</p>
        <ul className="flex flex-col gap-1">
          {m.monthly_mean_speed_50m.map((r) => (
            <li key={r.month} className="flex items-center gap-2 text-xs">
              <span className="w-6 shrink-0 font-mono text-[11px] text-muted">{String(r.month).padStart(2, "0")}</span>
              <span className="relative h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-sm bg-sunken">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm bg-info"
                  style={{ width: `${(r.mean_speed_ms / speedMax) * 100}%` }}
                />
              </span>
              <span className="w-12 shrink-0 text-right font-mono tabular-nums text-ink">{r.mean_speed_ms.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className={`${EYEBROW} mb-2`}>
          Direction at 50 m · <span className="text-accent">energy</span> against hours
        </p>
        <ul className="flex flex-col gap-1">
          {m.direction_energy_rose_50m.map((s) => (
            <li key={s.sector} className="flex items-center gap-2 text-xs">
              <span className="w-12 shrink-0 font-mono text-[11px] text-muted">{s.centre_deg.toFixed(1)}°</span>
              <span className="relative h-3 min-w-[4rem] flex-1 overflow-hidden rounded-sm bg-sunken">
                <span className="absolute left-0 top-0 h-1.5 bg-accent" style={{ width: `${(s.energy_pct / roseMax) * 100}%` }} />
                <span className="absolute bottom-0 left-0 h-1.5 bg-muted" style={{ width: `${(s.hours_pct / roseMax) * 100}%` }} />
              </span>
              <span className="w-14 shrink-0 text-right font-mono tabular-nums text-ink">{s.energy_pct.toFixed(2)}%</span>
              <span className="w-14 shrink-0 text-right font-mono tabular-nums text-muted">{s.hours_pct.toFixed(2)}%</span>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Stat
            label="Circular mean 50 m / 10 m"
            value={`${m.direction.circular_mean_deg_50m.toFixed(1)}° / ${m.direction.circular_mean_deg_10m.toFixed(1)}°`}
          />
          <Stat label="Median turning" value={`${m.direction.median_turning_deg.toFixed(1)}°`} />
          <p className="mt-1 text-[11px] text-muted">{m.direction.convention_note}</p>
        </div>
      </div>
    </div>
  )
}

/** The reference power curve, as its parameters: not a turbine chosen for this site. */
function ReferenceCurve({ wind }: { wind: Wind }) {
  const t = wind.turbine
  return (
    <>
      <StatGrid>
        <Stat label="Model" value={t.name} />
        <Stat label="Rated power" value={capacityMw(t.rated_power_w / 1e6)} />
        <Stat label="Rotor / blades" value={`${t.rotor_diameter_m.toFixed(0)} m · ${t.blades}`} />
        <Stat label="Class" value={`${t.iec_class} · turbulence ${t.turbulence_class}`} />
        <Stat label="Curve hub height" value={`${t.hub_height_m.toFixed(0)} m`} />
        <Stat label="Curve points" value={String(t.power_curve_points)} />
      </StatGrid>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{t.citation}</p>
    </>
  )
}

function WindBody({ wind, site }: { wind: Wind; site: { lon: number; lat: number } }) {
  const h = wind.hub
  const cell = wind.grid_cell_centre
  return (
    <>
      <DocumentHeader
        product="Wind screening"
        site={site}
        chips={["gross", "unvalidated"]}
        meta={`MERRA-2 cell at ${cell?.[1]?.toFixed(2) ?? wind.lat.toFixed(2)}, ${cell?.[0]?.toFixed(2) ?? wind.lon.toFixed(2)} · ${wind.record_window} · hub ${wind.hub_height_m.toFixed(0)} m`}
      />
      <FigureGrid>
        <Figure
          label="Hub speed"
          value={speedMs(h.mean_speed_ms)}
          sub={`power law α ${shearExponent(wind.assumptions.shear_exponent)}, extrapolated`}
        />
        <Figure label="Gross capacity factor" value={capacityFactorPct(h.gross_capacity_factor_pct)} sub="reference turbine" />
        <Figure
          label="Gross annual energy"
          value={energyMwh(h.gross_annual_energy_mwh_per_turbine)}
          sub={`per turbine · ${h.hours_per_year.toFixed(0)} h/yr`}
        />
        <Figure label="Mean speed 50 m" value={speedMs(wind.measured.mean_speed_50m_ms)} sub="carried by the reanalysis" />
      </FigureGrid>
      <p className="mt-4 text-[11px] leading-relaxed text-muted">{wind.qualifier}</p>

      <div className="mt-6">
        <Section title="Reanalysis levels">
          <ReanalysisLevels wind={wind} />
        </Section>
        <Section title={`Hub height · ${wind.hub_height_m.toFixed(0)} m, extrapolated`}>
          <HubResult wind={wind} />
        </Section>
        <Section title="Field diagnostics">
          <FieldDiagnostics wind={wind} />
        </Section>
        <Section title="Shear sensitivity">
          <ShearSensitivity wind={wind} />
        </Section>
        <Section title="Season and direction">
          <SeasonAndDirection wind={wind} />
        </Section>
        <Section title="Reference power curve">
          <ReferenceCurve wind={wind} />
        </Section>
        <Section title="Resolution">
          <p className="text-xs leading-relaxed text-muted">{wind.grid_note}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{wind.assumptions.comparison_note}</p>
          <ProvenanceNote provenance={wind.power_provenance} />
        </Section>
      </div>
    </>
  )
}

export function WindDocument() {
  const { wind } = useStore(analysis)
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto bg-surface px-8 py-8">
      <div className="mx-auto max-w-4xl">
        {wind ? <WindBody wind={wind.result} site={wind.site} /> : <NoResult product="Wind screening" command="WIND" />}
      </div>
    </div>
  )
}

import { useState } from "react"
import type { energy } from "../../../wailsjs/go/models"
import { formatLat, formatLng } from "../../lib/format"
import {
  airDensityKgM3,
  capacityFactorPct,
  capacityMw,
  fitErrorPct,
  grouped,
  meanCubeM3S3,
  patternFactor,
  powerDensityWm2,
  sharePct,
  shearExponent,
  speedMs,
  weibullK,
} from "../../lib/energyFormat"
import { DetailRow, IndicatorCard, IndicatorRow, ProvenanceNote, ReadingHead, ReadingNotice, ReadingPage, ReadingPanel, ReadingSource, Segmented } from "./primitives"

/*
  The wind screening, on the reading's page: the head, the line every figure
  is read under, four indicators, the panel that draws where the energy comes
  from, and the table of how far the hub figures move with the shear assumed.
  The figures are those of TERRA's WindScreening.tsx.

  THE QUALIFIERS THAT DO WORK STAY ON SCREEN. wind.py requires its qualifier
  beside the numbers and never behind a disclosure, so its short form is a
  line between the head and the cards, and each card's chip says which of
  gross, extrapolated or reanalysis its own figure is. The engine's whole
  paragraph is behind that line's info button: a paragraph in the open pushed
  the cards off the first screen.

  THE PANEL'S TITLE IS COUNTED: the sectors that together carry three quarters
  of the energy, or the best month against the worst.
*/

type Wind = energy.WindAnalysis

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** The sixteen-point compass name of a bearing, for reading a direction without converting degrees. */
function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`)

/** The fewest sectors that together carry three quarters of the energy, at most four of them. */
function directionFinding(wind: Wind): string {
  const sectors = [...wind.measured.direction_energy_rose_50m].sort((a, b) => b.energy_pct - a.energy_pct)
  let sum = 0
  const taken: typeof sectors = []
  for (const s of sectors) {
    if (sum >= 75 || taken.length === 4) break
    taken.push(s)
    sum += s.energy_pct
  }
  if (!taken.length) return "Energy by direction"
  return `${list(taken.map((s) => compass(s.centre_deg)))} ${taken.length > 1 ? "carry" : "carries"} ${sum.toFixed(0)}% of the energy`
}

function monthFinding(wind: Wind): string {
  const months = wind.measured.monthly_mean_speed_50m
  if (!months.length) return "Mean speed by month"
  const best = months.reduce((a, b) => (b.mean_speed_ms > a.mean_speed_ms ? b : a))
  const worst = months.reduce((a, b) => (b.mean_speed_ms < a.mean_speed_ms ? b : a))
  const more = worst.mean_speed_ms > 0 ? (100 * (best.mean_speed_ms - worst.mean_speed_ms)) / worst.mean_speed_ms : 0
  return `${MONTH_NAMES[best.month - 1]} blows ${more.toFixed(0)}% faster than ${MONTH_NAMES[worst.month - 1]}`
}

/** Energy against hours, by direction: where the two bars differ, the strong winds come from there. */
function ByDirection({ wind }: { wind: Wind }) {
  const rose = wind.measured.direction_energy_rose_50m
  const max = Math.max(...rose.map((s) => Math.max(s.energy_pct, s.hours_pct)), 0.001)
  return (
    <>
      <div className="flex gap-4 pt-1 text-xs" style={{ color: "var(--s-text-muted)" }}>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-[2px]" style={{ background: "var(--accent)" }} /> share of the energy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-[2px] bg-[#d9d9d9]" /> share of the hours
        </span>
      </div>
      <div className="reading-bars">
        {rose.map((s) => (
          <div key={s.sector} className="contents">
            <span className="name" title={`${s.centre_deg.toFixed(1)}°`}>
              {compass(s.centre_deg)} · {s.centre_deg.toFixed(0)}°
            </span>
            <span className="track">
              <span style={{ width: `${(s.energy_pct / max) * 100}%`, background: "var(--accent)" }} />
              <span style={{ width: `${(s.hours_pct / max) * 100}%` }} />
            </span>
            <span className="figure">
              {s.energy_pct.toFixed(1)}% <span style={{ color: "var(--s-text-faint)" }}>· {s.hours_pct.toFixed(1)}%</span>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function ByMonth({ wind }: { wind: Wind }) {
  const months = wind.measured.monthly_mean_speed_50m
  const max = Math.max(...months.map((r) => r.mean_speed_ms), 0.001)
  return (
    <div className="reading-bars">
      {months.map((r) => (
        <div key={r.month} className="contents">
          <span className="name">{MONTH_NAMES[r.month - 1] ?? r.month}</span>
          <span className="track">
            <span style={{ width: `${(r.mean_speed_ms / max) * 100}%` }} />
          </span>
          <span className="figure">{r.mean_speed_ms.toFixed(2)} m/s</span>
        </div>
      ))}
    </div>
  )
}

/** How far the hub result moves with the exponent it was extrapolated on. */
function ShearSensitivity({ wind }: { wind: Wind }) {
  return (
    <div className="overflow-x-auto">
      <table className="reading-table">
        <thead>
          <tr>
            <th>Shear exponent α</th>
            <th>Basis</th>
            <th className="num">Roughness</th>
            <th className="num">Hub speed</th>
            <th className="num">Gross CF</th>
            <th className="num">Gross energy</th>
          </tr>
        </thead>
        <tbody>
          {wind.shear_sensitivity.map((s) => (
            <tr key={`${s.basis}-${s.shear_exponent}`}>
              {/* Four decimals on purpose: the rows are chosen to differ there. */}
              <td>{s.shear_exponent.toFixed(4)}</td>
              <td style={{ color: "var(--s-text-muted)" }}>{s.basis}</td>
              <td className="num">{s.roughness_length_m == null ? "—" : `${s.roughness_length_m.toFixed(2)} m`}</td>
              <td className="num">{s.hub_speed_ms.toFixed(2)} m/s</td>
              <td className="num">{s.capacity_factor_pct.toFixed(1)}%</td>
              <td className="num">{grouped(s.annual_energy_mwh)} MWh</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The span of the gross capacity factor across the exponents tried: what the table is there to show. */
function shearFinding(wind: Wind): string {
  const cf = wind.shear_sensitivity.map((s) => s.capacity_factor_pct)
  if (cf.length < 2) return "With the shear exponent assumed"
  return `The shear assumed moves the gross capacity factor by ${(Math.max(...cf) - Math.min(...cf)).toFixed(1)} points`
}

export function WindBody({ wind, site }: { wind: Wind; site: { lon: number; lat: number } }) {
  const [view, setView] = useState<"direction" | "month">("direction")
  const h = wind.hub
  const m = wind.measured
  const q = wind.data_quality
  const shear = q.shear
  const fit = m.weibull_fit_check_50m
  const r = h.operating_regime
  const t = wind.turbine
  const cell = wind.grid_cell_centre
  const hub = wind.hub_height_m.toFixed(0)
  return (
    <ReadingPage>
      <ReadingHead
        title="Wind screening"
        about={`The wind at ${formatLat(site.lat)} ${formatLng(site.lon)}, as the reanalysis carries it, taken up to a hub at ${hub} m.`}
      />

      {/* One line, whatever it has to say: two stacked took the cards off the first screen. */}
      <ReadingNotice
        more={
          <>
            <p>{wind.qualifier}</p>
            {!q.all_checks_passed && (
              <ul className="list-disc pl-5">
                {q.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </>
        }
      >
        Screening only: gross, unvalidated, extrapolated above 50 m
        {q.all_checks_passed ? "." : ` · ${q.flags.length} of the record's checks did not pass.`}
      </ReadingNotice>

      <IndicatorRow>
        <IndicatorCard title="Hub speed" sub={`Mean at ${hub} m`} value={h.mean_speed_ms.toFixed(2)} unit="m/s" chip="extrapolated">
          By a power law, α {shearExponent(wind.assumptions.shear_exponent)}.
        </IndicatorCard>
        <IndicatorCard title="Capacity factor" sub="Of the reference turbine" value={h.gross_capacity_factor_pct.toFixed(1)} unit="%" chip="gross">
          Before wake, availability and electrical losses.
        </IndicatorCard>
        <IndicatorCard title="Annual energy" sub="Of one turbine" value={grouped(h.gross_annual_energy_mwh_per_turbine)} unit="MWh" chip="gross, per turbine">
          Over {grouped(h.hours_per_year)} hours; not to be multiplied by a plant's size.
        </IndicatorCard>
        <IndicatorCard title="Speed at 50 m" sub="The highest level recorded" value={m.mean_speed_50m_ms.toFixed(2)} unit="m/s" chip="reanalysis">
          The level the hub figures are taken up from.
        </IndicatorCard>
      </IndicatorRow>

      <ReadingPanel
        title={view === "direction" ? directionFinding(wind) : monthFinding(wind)}
        sub={view === "direction" ? "Energy against hours by direction, at 50 m" : "Mean speed by month, at 50 m"}
        controls={
          <Segmented
            label="What the panel draws"
            value={view}
            onChange={setView}
            options={[
              { value: "direction", label: "By direction" },
              { value: "month", label: "By month" },
            ]}
          />
        }
        note={
          <>
            <p>{m.direction.convention_note}</p>
            <p>{wind.grid_note}</p>
            <p>{wind.assumptions.comparison_note}</p>
            <p>{t.citation}</p>
          </>
        }
        details={
          <>
            <DetailRow label="Mean speed 10 m" value={speedMs(m.mean_speed_10m_ms)} />
            <DetailRow label="Weibull 50 m" value={`k ${weibullK(m.weibull_k_50m)}, c ${speedMs(m.weibull_c_50m_ms)}`} />
            <DetailRow label="Power density 50 m" value={powerDensityWm2(m.wind_power_density_50m_w_m2)} />
            <DetailRow label="Energy pattern factor 50 m" value={patternFactor(m.energy_pattern_factor_50m)} />
            <DetailRow label="Weibull mean against the record" value={`${speedMs(fit.weibull_mean_ms)}, ${fitErrorPct(fit.mean_error_pct)}`} />
            <DetailRow label="Weibull mean cube against the record" value={`${meanCubeM3S3(fit.weibull_mean_cube_m3s3)}, ${fitErrorPct(fit.mean_cube_error_pct)}`} />
            <DetailRow label="Air density, mean" value={airDensityKgM3(m.air_density_mean_kg_m3)} />
            <DetailRow label="Air density, range" value={`${m.air_density_min_kg_m3.toFixed(3)} – ${airDensityKgM3(m.air_density_max_kg_m3)}`} />
            <DetailRow
              label="Circular mean direction 50 m"
              value={`${compass(m.direction.circular_mean_deg_50m)} ${m.direction.circular_mean_deg_50m.toFixed(1)}°`}
            />
            <DetailRow
              label="Circular mean direction 10 m"
              value={`${compass(m.direction.circular_mean_deg_10m)} ${m.direction.circular_mean_deg_10m.toFixed(1)}°`}
            />
            <DetailRow label="Median turning" value={`${m.direction.median_turning_deg.toFixed(1)}°`} />
            <DetailRow label="Hub Weibull" value={`k ${weibullK(h.weibull_k)}, c ${speedMs(h.weibull_c_ms)}`} />
            <DetailRow label="Hub power density" value={powerDensityWm2(h.wind_power_density_w_m2)} />
            <DetailRow label="Hours above cut-in" value={sharePct(r.above_cut_in_pct)} />
            <DetailRow label="Hours at or above rated" value={sharePct(r.at_or_above_rated_pct)} />
            <DetailRow label="Hours above cut-out" value={sharePct(r.above_cut_out_pct)} />
            <DetailRow label="Cut-in / rated / cut-out" value={`${r.cut_in_ms.toFixed(1)} / ${r.rated_ms.toFixed(1)} / ${r.cut_out_ms.toFixed(1)} m/s`} />
            <DetailRow label="Gross capacity factor without density correction" value={capacityFactorPct(h.gross_capacity_factor_no_density_correction_pct)} />
            <DetailRow label="Extrapolation" value={`${h.extrapolation.height_ratio.toFixed(1)}× the top level`} />
            <DetailRow
              label={`Hours below ${q.calm_threshold_ms} m/s at 10 m`}
              value={sharePct(q.calm_fraction_pct["10m"] ?? 0)}
            />
            <DetailRow
              label={`Record maximum 10 m, floor ${q.record_maximum_floor_ms.toFixed(1)} m/s`}
              value={`${speedMs(q.record_maximum_ms["10m"] ?? 0)}, ${q.record_maximum_plausible ? "met" : "not met"}`}
            />
            <DetailRow label="Shear exponent, day / night" value={`${shearExponent(shear.shear_exponent_day)} / ${shearExponent(shear.shear_exponent_night)}`} />
            <DetailRow label="Shear band supported" value={shear.expected_shear_exponent_band.map(shearExponent).join(" – ")} />
            {/* Null when no roughness length produces this exponent in a neutral
                log profile. Printed as a number it would read as a measured 0 m. */}
            <DetailRow
              label={`Implied roughness, assumed ${shear.assumed_roughness_band_m.join("–")} m`}
              value={
                shear.implied_roughness_length_m == null
                  ? "no inversion"
                  : `${shear.implied_roughness_length_m.toFixed(3)} m, ${shear.consistent_with_assumed_cover ? "consistent" : "not consistent"}`
              }
            />
            <DetailRow label="Record hours" value={`${grouped(q.record_hours)} of ${grouped(q.expected_hours)}`} />
            <DetailRow label="Reference turbine" value={t.name} />
            <DetailRow label="Rated power" value={capacityMw(t.rated_power_w / 1e6)} />
            <DetailRow label="Rotor / blades" value={`${t.rotor_diameter_m.toFixed(0)} m · ${t.blades}`} />
            <DetailRow label="Class" value={`${t.iec_class}, turbulence ${t.turbulence_class}`} />
          </>
        }
      >
        {view === "direction" ? <ByDirection wind={wind} /> : <ByMonth wind={wind} />}
      </ReadingPanel>

      <ReadingPanel title={shearFinding(wind)} sub="The hub figures under each shear exponent tried">
        <ShearSensitivity wind={wind} />
      </ReadingPanel>

      <ReadingSource>
        MERRA-2 cell at {cell?.[1]?.toFixed(2) ?? wind.lat.toFixed(2)}, {cell?.[0]?.toFixed(2) ?? wind.lon.toFixed(2)} · {wind.record_window}
        <ProvenanceNote provenance={wind.power_provenance} />
      </ReadingSource>
    </ReadingPage>
  )
}

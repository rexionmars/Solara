import { useMemo, useState } from "react"
import type { grid } from "../../../wailsjs/go/models"
import { polygonAreaKm2 } from "../../lib/geo"
import type { Polygon } from "../../lib/project"
import { AreaChart, ORDINAL, RankedBars, Scatter, type Series } from "./charts"
import { grouped } from "../../lib/energyFormat"
import { DetailRow, IndicatorCard, IndicatorRow, ReadingHead, ReadingPage, ReadingPanel, ReadingSource, Segmented } from "./primitives"
import { MONTHS } from "./SolarDocument"

/**
 * What an area already draws from the network, on the reading's page: the
 * head, four indicators, one panel with three views of what is drawn, and a
 * second of what is returned behind the meter.
 *
 * THREE VIEWS IN ONE PANEL, NOT THREE PANELS. Through the year, by tariff
 * class and by municipality are the same energy cut three ways, so they share
 * a place and a switch; side by side they were three boxes of one weight and
 * nothing said which to read first. The two rankings are ordered by one
 * quantity, chosen once for both.
 *
 * CONSUMPTION AND GENERATION ARE NOT NETTED: the register meters them at
 * different places, so the two and their ratio are shown and never a
 * difference. What is returned is INJECTION, not generation -- said on the
 * card's chip and in the second panel's subtitle, always on screen.
 *
 * WHERE IT FALLS is the layer on the map; the reading carries no legend of it.
 */

const LEVELS: { key: string; label: string; short: string }[] = [
  { key: "bt", label: "Low voltage", short: "Low" },
  { key: "mt", label: "Medium voltage", short: "Medium" },
  { key: "at", label: "High voltage", short: "High" },
]

/**
 * A level's colour, by the level and not by its place in a list: an area with
 * no low-voltage unit must not draw medium voltage in low voltage's tone. The
 * year's chart and the table's bars both read it, so a level is one colour.
 */
const LEVEL_COLOR: Record<string, string> = { bt: ORDINAL[0], mt: ORDINAL[1], at: ORDINAL[2] }

const units = (n: number) => `${n.toLocaleString()} unit${n === 1 ? "" : "s"}`
const kw = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString()} kW`)

/** MWh at the magnitude it is actually read at, so an axis does not print nine digits. */
export const short = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(2)} TWh` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} GWh` : `${v.toFixed(0)} MWh`

type Rank = "energy" | "units"
type View = "year" | "class" | "town"

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** A figure and its unit apart, as a card sets them: "2.17 TWh" is 2.17 beside TWh. */
const split = (v: string): [string, string] => {
  const at = v.lastIndexOf(" ")
  return at < 0 ? [v, ""] : [v.slice(0, at), v.slice(at + 1)]
}

/** The largest of a ranking against the one after it: said only of the quantity the ranking is ordered by. */
function rankFinding(rows: { name: string; value: number }[], what: string): string {
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  if (!sorted.length) return `By ${what}`
  if (sorted.length < 2 || !(sorted[1].value > 0)) return `${sorted[0].name} is the only ${what} with units here`
  const times = sorted[0].value / sorted[1].value
  return times >= 1.5 ? `${sorted[0].name} is ${times.toFixed(1)} times the next ${what}` : `${sorted[0].name} and ${sorted[1].name} lead, close to each other`
}

export function DemandBody({ demand, area }: { demand: grid.DemandAnalysis; area: Polygon }) {
  const [rank, setRank] = useState<Rank>("energy")
  const [view, setView] = useState<View>("year")

  const t = demand.totais
  const reg = demand.register
  const consumption = LEVELS.map((l) => ({ ...l, row: demand.consumo[l.key] })).filter((l) => l.row)
  const generation = LEVELS.map((l) => ({ ...l, row: demand.geracao[l.key] })).filter((l) => l.row)
  const allUnits = consumption.reduce((n, l) => n + (l.row?.unidades ?? 0), 0)
  const km2 = polygonAreaKm2(area)
  const conc = demand.analise.concentracao
  const season = demand.analise.sazonalidade
  const covered = demand.cobertura?.cobertura_pct
  const perUnit = allUnits > 0 ? (t.energia_consumida_ano_mwh / allUnits).toFixed(1) : null
  const lowUnits = demand.consumo["bt"]?.unidades
  const lowShare = allUnits > 0 && lowUnits != null ? ((100 * lowUnits) / allUnits).toFixed(1) : null

  const yearly: Series[] = consumption
    .filter((l) => l.row?.energia_mensal_mwh?.length === 12)
    .map((l, i) => ({
      key: l.key,
      label: l.label,
      color: LEVEL_COLOR[l.key],
      values: l.row!.energia_mensal_mwh,
      fill: i === 0,
    }))

  const ceiling = generation[0]?.row?.acima_do_teto.teto_kwh_kwp_ano ?? 0
  const points = useMemo(
    () =>
      generation.flatMap((l) =>
        (l.row?.amostra ?? []).map(([x, y]) => ({ x, y, label: `${l.short} · ${x.toFixed(1)} kWp` }))
      ),
    [generation]
  )
  const sampled = generation.reduce((n, l) => n + (l.row?.amostra?.length ?? 0), 0)
  const generators = generation.reduce((n, l) => n + (l.row?.unidades ?? 0), 0)
  const over = generation.reduce((n, l) => n + (l.row?.acima_do_teto.unidades ?? 0), 0)

  const byRank = (r: { unidades: number; energia_ano_mwh: number }) => (rank === "energy" ? r.energia_ano_mwh : r.unidades)
  const fmtRank = (v: number) => (rank === "energy" ? short(v) : grouped(v))
  const classes = demand.por_classe.map((c, i) => ({ key: c.clas_sub ?? `unnamed-${i}`, name: c.clas_sub ?? "no class", row: c }))
  const towns = demand.por_municipio.map((m, i) => ({ key: m.mun ?? `unnamed-${i}`, name: m.mun ?? "no code", row: m }))
  // A view the register has nothing for is not offered, and the panel falls back to the first that is.
  const views: { value: View; label: string }[] = [
    ...(yearly.length ? [{ value: "year" as const, label: "Through the year" }] : []),
    ...(classes.length ? [{ value: "class" as const, label: "By tariff class" }] : []),
    ...(towns.length ? [{ value: "town" as const, label: "By municipality" }] : []),
  ]
  const shown = views.some((v) => v.value === view) ? view : views[0]?.value
  const ranking = shown === "class" ? classes : towns

  const [consumed, consumedUnit] = split(short(t.energia_consumida_ano_mwh))
  const [returned, returnedUnit] = split(short(t.energia_injetada_ano_mwh))

  const title =
    shown === "year"
      ? season?.amplitude_pct == null
        ? "What the area draws through the year"
        : `${MONTH_NAMES[season.mes_pico - 1]} draws the most and ${MONTH_NAMES[season.mes_vale - 1]} the least, ${season.amplitude_pct}% of a mean month apart`
      : shown === "class"
        ? rankFinding(classes.map((c) => ({ name: c.name, value: byRank(c.row) })), "tariff class")
        : rankFinding(towns.map((m) => ({ name: m.name, value: byRank(m.row) })), "municipality")

  // In the panel's head where the area is wide; above the ranking where it is narrow, so the title keeps its line.
  const rankBy = (
    <Segmented
      label="Rank by"
      value={rank}
      onChange={setRank}
      options={[
        { value: "energy", label: "Energy" },
        { value: "units", label: "Units" },
      ]}
    />
  )

  return (
    <ReadingPage>
      <ReadingHead
        title="Area consumption"
        about={`What ${km2.toFixed(0)} km² draws from the network in a year and returns to it, from ${reg.base}.`}
        // A register that reaches part of the area qualifies every figure below it.
        chips={covered != null && covered < 100 ? [`register covers ${covered}% of the area`] : undefined}
      />

      <IndicatorRow>
        <IndicatorCard title="Consumed" sub="At every voltage level" value={consumed} unit={consumedUnit} chip={perUnit ? `${perUnit} MWh per unit` : undefined}>
          Drawn from the network in the year.
        </IndicatorCard>
        <IndicatorCard title="Returned" sub="By generation in the area" value={returned} unit={returnedUnit} chip="injected, not generated">
          {t.injetada_sobre_consumida_pct == null ? "What crossed the meter towards the network." : `${t.injetada_sobre_consumida_pct.toFixed(1)}% of what is drawn; never a difference between the two.`}
        </IndicatorCard>
        <IndicatorCard title="Units" sub="Connection points in the area" value={grouped(allUnits)} chip={lowShare ? `${lowShare}% at low voltage` : undefined}>
          Each counted where it joins the network.
        </IndicatorCard>
        {conc ? (
          <IndicatorCard title="Half the load in" sub="The densest ground" value={grouped(conc.km2_com_metade)} unit="km²" chip={`${conc.pct_das_celulas_ocupadas}% of occupied cells`}>
            {demand.density ? `By cells of ${demand.density.cell_km} km; the busiest tenth carries ${conc.decil_superior_pct}%.` : "By the cells that hold a unit."}
          </IndicatorCard>
        ) : (
          <IndicatorCard title="Area" sub="The drawing on the map" value={km2.toFixed(0)} unit="km²">
            No density was computed for this run.
          </IndicatorCard>
        )}
      </IndicatorRow>

      {shown && (
        <ReadingPanel
          title={title}
          sub={
            shown === "year"
              ? "Energy by month and voltage level"
              : `Low voltage, by ${shown === "class" ? "tariff class" : "municipality"}, ranked by ${rank === "energy" ? "energy in the year" : "connection points"}`
          }
          controls={
            <>
              {shown !== "year" && <span className="reading-wide-only">{rankBy}</span>}
              {views.length > 1 && <Segmented label="What the panel draws" value={shown} onChange={setView} options={views} />}
            </>
          }
          note={
            <>
              <p>Each unit is counted where it joins the network. A level with no unit inside the area is absent rather than zero.</p>
              {towns.length > 0 && <p>Municipalities are IBGE codes; the register carries no name for them.</p>}
              {demand.density && <p>{demand.density.note}</p>}
            </>
          }
          details={
            <>
              {consumption.map((l) => (
                <DetailRow key={l.key} label={`${l.label}: ${units(l.row!.unidades)}`} value={short(l.row!.energia_ano_mwh)} />
              ))}
              {demand.density && (
                <DetailRow
                  label="Cells that hold a unit"
                  value={`${grouped(demand.density.cells)} of ${grouped(demand.density.grid.nx * demand.density.grid.ny)}`}
                />
              )}
            </>
          }
        >
          <div className="reading-chart">
            {shown === "year" ? (
              <AreaChart categories={MONTHS} series={yearly} unit="MWh" format={short} height={190} />
            ) : (
              <>
                <div className="reading-narrow-only pb-2">{rankBy}</div>
                <RankedBars
                  bars={ranking.map((r) => ({
                    key: r.key,
                    label: r.name,
                    sub: rank === "energy" ? units(r.row.unidades) : short(r.row.energia_ano_mwh),
                    value: byRank(r.row),
                  }))}
                  format={fmtRank}
                  labelWidth={96}
                />
              </>
            )}
          </div>
        </ReadingPanel>
      )}

      {generation.length > 0 && (
        <ReadingPanel
          title={
            generators > 0
              ? `${((100 * over) / generators).toFixed(1)}% of the generators report more than the site can make`
              : "Behind the meter"
          }
          sub={`Behind the meter: energy injected, not generated, against installed power · ${grouped(sampled)} of ${grouped(generators)} drawn`}
          note={
            <>
              <p>
                The energy is what reached the network: self-consumption never crossed the meter, so this is injection and roughly half of what
                these roofs generate. A point above the line has a wrong power or a wrong energy, and is drawn rather than dropped.
              </p>
              <p>{demand.assumptions.teto_de_rendimento.nota}</p>
            </>
          }
          details={
            <>
              {generation.map((l) => (
                <DetailRow
                  key={l.key}
                  label={`${l.label}: ${units(l.row!.unidades)}, ${grouped(l.row!.acima_do_teto.unidades)} over the ceiling`}
                  value={`${short(l.row!.energia_injetada_ano_mwh)} · ${kw(l.row!.potencia_instalada_plausivel_kw)} plausible`}
                />
              ))}
              <DetailRow
                label={`Yield ceiling, ${demand.assumptions.teto_de_rendimento.origem}`}
                value={`${grouped(demand.assumptions.teto_de_rendimento.valor_kwh_kwp_ano)} kWh/kWp per year`}
              />
              <DetailRow label="Energy of a generator" value={demand.assumptions.energia_da_geracao} />
              <DetailRow label="Installed power" value={demand.assumptions.potencia_instalada} />
              <DetailRow label="Where a unit is" value={demand.assumptions.posicao} />
            </>
          }
        >
          <div className="reading-chart">
            {points.length > 0 && ceiling > 0 ? (
              <Scatter
                points={points}
                xLabel="installed kW"
                yLabel="MWh to the network"
                slope={ceiling / 1000}
                slopeLabel={`ceiling ${grouped(ceiling)} kWh/kWp`}
                height={220}
              />
            ) : (
              <p className="py-4 text-[13px] text-[var(--s-text-muted)]">The register holds no generator here with both a power and an energy to draw.</p>
            )}
          </div>
        </ReadingPanel>
      )}

      <ReadingSource>
        {reg.distribuidora.replace(/_/g, " ")} · BDGD {reg.ano}
      </ReadingSource>
    </ReadingPage>
  )
}

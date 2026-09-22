import { useMemo, useState } from "react"
import type { grid } from "../../../wailsjs/go/models"
import { polygonAreaKm2 } from "../../lib/geo"
import type { Polygon } from "../../lib/project"
import { AreaChart, ORDINAL, RankedBars, Scatter, type Series } from "./charts"
import { Legend } from "./Legend"
import { ControlBar, DataTable, Disclosure, KpiCard, Panel, PanelGrid, Stat, Tabs } from "./primitives"

/**
 * What an area already draws from the network, as the BDGD register says it.
 *
 * A SURFACE, NOT A PAGE. The figures are laid out as bounded panels the reader
 * chooses an order through, because a reading that can only be taken from the
 * top is a document, and a document is read once. Every quantity is a mark or
 * a sortable column; the only prose left qualifies a specific number, and the
 * assumptions are folded away rather than stacked above the figures.
 *
 * CONSUMPTION AND GENERATION ARE NOT NETTED. The register meters them at
 * different places for different purposes, so the reading shows the two and
 * their ratio, never a difference presented as a residual load.
 *
 * WHAT THE FIGURES ARE NOT. A generator's energy is what reached the network,
 * so it is injection and not generation; installed power is normalised across
 * a register that mixes kW and W between rows; a unit sits at its connection
 * point and not at its door. The three are in the reading, in the words the
 * sidecar reported them -- not in a tooltip.
 */

const LEVELS: { key: string; label: string; short: string }[] = [
  { key: "bt", label: "Low voltage", short: "Low" },
  { key: "mt", label: "Medium voltage", short: "Medium" },
  { key: "at", label: "High voltage", short: "High" },
]

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const units = (n: number) => `${n.toLocaleString()} unit${n === 1 ? "" : "s"}`
const kw = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString()} kW`)

/** MWh at the magnitude it is actually read at, so an axis does not print nine digits. */
const short = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(2)} TWh` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} GWh` : `${v.toFixed(0)} MWh`

/** Which quantity the class and town panels are ranked and drawn by. */
type Metric = "energy" | "units"

export function DemandBody({ demand, area }: { demand: grid.DemandAnalysis; area: Polygon }) {
  const [metric, setMetric] = useState<Metric>("energy")

  const t = demand.totais
  const consumption = LEVELS.map((l) => ({ ...l, row: demand.consumo[l.key] })).filter((l) => l.row)
  const generation = LEVELS.map((l) => ({ ...l, row: demand.geracao[l.key] })).filter((l) => l.row)
  const allUnits = consumption.reduce((n, l) => n + (l.row?.unidades ?? 0), 0)
  const km2 = polygonAreaKm2(area)
  const conc = demand.analise.concentracao
  const season = demand.analise.sazonalidade

  /**
   * The year, one series per level that has one, on the ordinal ramp.
   *
   * Every level is drawn at once rather than behind a switch: the thing worth
   * seeing is that low voltage swings with the season and the levels above it
   * barely do, and a switch hides exactly that.
   */
  const yearly: Series[] = consumption
    .filter((l) => l.row?.energia_mensal_mwh?.length === 12)
    .map((l, i) => ({
      key: l.key,
      label: l.label,
      color: ORDINAL[i] ?? ORDINAL[ORDINAL.length - 1],
      values: l.row!.energia_mensal_mwh,
      fill: i === 0,
    }))

  /**
   * Every sampled generator, pooled across levels, against the ceiling its own
   * site cannot beat. This is the panel that replaced a count: a reader sees
   * that the rows above the line are the small ones, which the count could
   * only assert.
   */
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

  const byMetric = (r: { unidades: number; energia_ano_mwh: number }) =>
    metric === "energy" ? r.energia_ano_mwh : r.unidades
  const fmtMetric = (v: number) => (metric === "energy" ? short(v) : v.toLocaleString())

  return (
    <div className="@container px-3 pb-8 pt-3">
      {/*
        One row, above everything it scopes. Both ranked panels read the same
        quantity, so the screen can never show a class leading by energy beside
        a town leading by count and leave the reader to notice.
      */}
      <ControlBar>
        <Tabs
          label="Rank by"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "energy", label: "Energy" },
            { value: "units", label: "Units" },
          ]}
        />
      </ControlBar>

      <div className="mb-2.5 grid grid-cols-2 gap-2.5 @xl:grid-cols-4">
        <KpiCard
          label="Consumed"
          value={short(t.energia_consumida_ano_mwh)}
          note="all levels, in the year"
          spark={demand.consumo["bt"]?.energia_mensal_mwh}
        />
        <KpiCard
          label="Returned"
          value={short(t.energia_injetada_ano_mwh)}
          note={
            t.injetada_sobre_consumida_pct == null
              ? "by generation in the area"
              : `${t.injetada_sobre_consumida_pct.toFixed(1)}% of what is drawn`
          }
        />
        <KpiCard label="Units" value={allUnits.toLocaleString()} note="connection points" />
        {conc ? (
          <KpiCard
            label="Half the load in"
            value={conc.km2_com_metade.toLocaleString()}
            unit="km²"
            note={`${conc.pct_das_celulas_ocupadas}% of the occupied cells`}
          />
        ) : (
          <KpiCard label="Area" value={km2.toFixed(0)} unit="km²" note="the drawing on the map" />
        )}
      </div>

      <PanelGrid>
        {yearly.length > 0 && (
          <Panel
            title="Through the year"
            span
            right={
              season?.amplitude_pct == null ? undefined : (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {MONTHS[season.mes_pico - 1]} over {MONTHS[season.mes_vale - 1]} · {season.amplitude_pct}% of the mean
                  month
                </span>
              )
            }
          >
            <AreaChart categories={MONTHS} series={yearly} unit="MWh" format={short} />
          </Panel>
        )}

        <Panel title="What the area draws">
          <DataTable
            rows={consumption}
            rowKey={(l) => l.key}
            sortBy="energy"
            columns={[
              { key: "level", label: "Level", value: (l) => l.short },
              { key: "units", label: "Units", kind: "num", value: (l) => l.row!.unidades },
              {
                key: "energy",
                label: "Energy",
                kind: "bar",
                value: (l) => l.row!.energia_ano_mwh,
                format: (l) => short(l.row!.energia_ano_mwh),
              },
            ]}
          />
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Each unit is counted where it joins the network, a point it shares with the units on the same pole or
            transformer. A level with no unit inside the area is absent rather than zero.
          </p>
        </Panel>

        {demand.density && (
          <Panel
            title="Where it falls"
            right={<span className="shrink-0 text-[10px] text-muted-foreground">{demand.density.cell_km} km cells</span>}
          >
            <Legend scale={demand.density.scale} unit={demand.density.unit} title="Per cell" />
            <div className="mt-2">
              <Stat
                label="Cells that hold a unit"
                value={`${demand.density.cells.toLocaleString()} of ${(
                  demand.density.grid.nx * demand.density.grid.ny
                ).toLocaleString()}`}
              />
              {conc && <Stat label="Carried by the busiest tenth" value={`${conc.decil_superior_pct}%`} />}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{demand.density.note}</p>
          </Panel>
        )}

        {demand.por_classe.length > 0 && (
          <Panel title="By tariff class" right={<span className="text-[10px] text-muted-foreground">low voltage</span>}>
            <RankedBars
              bars={demand.por_classe.map((c, i) => ({
                key: c.clas_sub ?? `unnamed-${i}`,
                label: c.clas_sub ?? "no class",
                sub: metric === "energy" ? units(c.unidades) : short(c.energia_ano_mwh),
                value: byMetric(c),
              }))}
              format={fmtMetric}
              unit={metric === "energy" ? "MWh/year" : "connection points"}
              labelWidth={76}
            />
          </Panel>
        )}

        {demand.por_municipio.length > 0 && (
          <Panel title="By municipality" right={<span className="text-[10px] text-muted-foreground">low voltage</span>}>
            <RankedBars
              bars={demand.por_municipio.map((m, i) => ({
                key: m.mun ?? `unnamed-${i}`,
                label: m.mun ?? "no code",
                sub: metric === "energy" ? units(m.unidades) : short(m.energia_ano_mwh),
                value: byMetric(m),
              }))}
              format={fmtMetric}
              unit="IBGE codes; the register carries no name for them"
              labelWidth={76}
            />
          </Panel>
        )}

        {generation.length > 0 && (
          <Panel
            title="Behind the meter, against what the site can make"
            span
            right={
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {sampled.toLocaleString()} of {generators.toLocaleString()} drawn
              </span>
            }
          >
            {points.length > 0 && ceiling > 0 && (
              <Scatter
                points={points}
                xLabel="installed kW"
                yLabel="MWh to the network"
                slope={ceiling / 1000}
                slopeLabel={`ceiling ${Math.round(ceiling).toLocaleString()} kWh/kWp`}
              />
            )}
            <div className="mt-3">
              <DataTable
                rows={generation}
                rowKey={(l) => l.key}
                sortBy="injected"
                maxHeight={140}
                columns={[
                  { key: "level", label: "Level", value: (l) => l.short },
                  { key: "units", label: "Units", kind: "num", value: (l) => l.row!.unidades },
                  {
                    key: "declared",
                    label: "Declared",
                    kind: "num",
                    value: (l) => l.row!.potencia_instalada_kw,
                    format: (l) => kw(l.row!.potencia_instalada_kw),
                  },
                  {
                    key: "plausible",
                    label: "Plausible",
                    kind: "num",
                    value: (l) => l.row!.potencia_instalada_plausivel_kw,
                    format: (l) => kw(l.row!.potencia_instalada_plausivel_kw),
                  },
                  {
                    key: "over",
                    label: "Over",
                    kind: "num",
                    value: (l) => l.row!.acima_do_teto.unidades,
                    format: (l) =>
                      `${l.row!.acima_do_teto.unidades.toLocaleString()} of ${l.row!.unidades.toLocaleString()}`,
                  },
                  {
                    key: "injected",
                    label: "Injected",
                    kind: "bar",
                    value: (l) => l.row!.energia_injetada_ano_mwh,
                    format: (l) => short(l.row!.energia_injetada_ano_mwh),
                  },
                ]}
              />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              The energy is what reached the network. Self-consumption never crossed the distributor's meter and is not
              in the register, so this is injection and roughly half of what these roofs generate. A row above the line
              has a wrong power or a wrong energy; it is drawn rather than dropped, because where those rows sit is how
              far the register can be trusted at this place.
            </p>
          </Panel>
        )}
      </PanelGrid>

      <div className="mt-2.5">
        <Disclosure title="What this reading assumed">
          <Stat label="Energy of a generator" value={demand.assumptions.energia_da_geracao} />
          <Stat label="Installed power" value={demand.assumptions.potencia_instalada} />
          <Stat label="Where a unit is" value={demand.assumptions.posicao} />
          <Stat
            label={`Yield ceiling · ${demand.assumptions.teto_de_rendimento.origem}`}
            value={`${Math.round(demand.assumptions.teto_de_rendimento.valor_kwh_kwp_ano).toLocaleString()} kWh/kWp/year`}
          />
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            {demand.assumptions.teto_de_rendimento.nota}
          </p>
        </Disclosure>
      </div>
    </div>
  )
}

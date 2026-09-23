import { useMemo, useState } from "react"
import type { grid } from "../../../wailsjs/go/models"
import { polygonAreaKm2 } from "../../lib/geo"
import type { Polygon } from "../../lib/project"
import { Board, type BoardCard, type Place } from "../studio/Board"
import { AreaChart, ORDINAL, RankedBars, Scatter, SERIES, type Series } from "./charts"
import { Legend } from "./Legend"
import { DataTable, Metric, Stat, Tabs } from "./primitives"

/**
 * What an area already draws from the network, as cards on a board.
 *
 * THE SAME FIGURES AS THE DOCUMENT, ARRANGED BY THE READER. Every mark here
 * was in `DemandDocument`; what changed is that the reader drags two cards
 * together to compare them, zooms out to see the run whole, and never scrolls
 * past a figure to reach another one. A reading that can only be taken from
 * the top is a document, and a document is read once.
 *
 * WHERE THE PROSE WENT. Each qualification now hangs off the info button of
 * the card it qualifies, because a paragraph under a chart costs its height
 * on every later visit and is read on the first. Nothing was dropped: the
 * register's three caveats -- injection and not generation, a power column
 * that mixes kW with W, a unit at its connection point and not at its door --
 * are on the cards whose numbers they change.
 *
 * A WIRE MEANS "COMPUTED FROM". Every card on this board descends from one
 * register, and the wires say which reading each figure was taken out of --
 * the classes and the towns out of the consumption table, the assumptions out
 * of the generation sample. It is the derivation, not a suggested order: a
 * reader may still start anywhere.
 *
 * CONSUMPTION AND GENERATION ARE NOT NETTED. The register meters them at
 * different places for different purposes, so the board shows the two and
 * their ratio, never a difference presented as a residual load.
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

/** Which quantity the class and town cards are ranked and drawn by. */
type Metric2 = "energy" | "units"

/**
 * How wide each card is drawn, in board units.
 *
 * Set per card and not by a grid: a twelve-month axis needs the width to label
 * every month, a scatter over two decades needs more than that, and a single
 * figure needs none of it. A grid would give all three the same answer.
 */
const W = { source: 268, figure: 196, table: 384, year: 470, scatter: 560, assumed: 384, density: 368 }

/*
  What a wire is carrying, as colour. The register is the chassis' neutral
  because it is not a quantity; the two ramps below it are the chart palette's
  own drawn/returned pair, so a wire and the marks it feeds agree.
*/
const TONE = { register: "rgb(var(--p-kind-site))", drawn: SERIES.drawn, returned: SERIES.returned } as const

export function DemandBoard({
  demand,
  area,
  places,
  onMove,
  onReset,
}: {
  demand: grid.DemandAnalysis
  area: Polygon
  places?: Readonly<Record<string, Place>>
  onMove?: (id: string, place: Place) => void
  onReset?: () => void
}) {
  const [metric, setMetric] = useState<Metric2>("energy")

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

  const cards: BoardCard[] = []

  const reg = demand.register
  cards.push({
    id: "register",
    w: W.source,
    title: "The register",
    tone: TONE.register,
    right: `${reg.distribuidora} · ${reg.ano}`,
    children: (
      <p className="truncate text-[11px] text-muted-foreground" title={reg.base}>
        {reg.base}
      </p>
    ),
  })

  cards.push({
    id: "consumed",
    w: W.figure,
    bare: true,
    from: ["levels"],
    children: (
      <Metric
        label="Consumed"
        value={short(t.energia_consumida_ano_mwh)}
        note="all levels, in the year"
        spark={demand.consumo["bt"]?.energia_mensal_mwh}
      />
    ),
  })
  cards.push({
    id: "returned",
    from: ["generation"],
    w: W.figure,
    bare: true,
    children: (
      <Metric
        label="Returned"
        value={short(t.energia_injetada_ano_mwh)}
        note={
          t.injetada_sobre_consumida_pct == null
            ? "by generation in the area"
            : `${t.injetada_sobre_consumida_pct.toFixed(1)}% of what is drawn`
        }
      />
    ),
  })
  cards.push({
    id: "units",
    from: ["levels"],
    w: W.figure,
    bare: true,
    children: <Metric label="Units" value={allUnits.toLocaleString()} note="connection points" />,
  })
  cards.push({
    id: "spread",
    from: demand.density ? ["density"] : ["levels"],
    w: W.figure,
    bare: true,
    children: conc ? (
      <Metric
        label="Half the load in"
        value={conc.km2_com_metade.toLocaleString()}
        unit="km²"
        note={`${conc.pct_das_celulas_ocupadas}% of the occupied cells`}
      />
    ) : (
      <Metric label="Area" value={km2.toFixed(0)} unit="km²" note="the drawing on the map" />
    ),
  })

  if (yearly.length > 0) {
    cards.push({
      id: "year",
      from: ["levels"],
      tone: TONE.drawn,
      w: W.year,
      title: "Through the year",
      right:
        season?.amplitude_pct == null
          ? undefined
          : `${MONTHS[season.mes_pico - 1]} over ${MONTHS[season.mes_vale - 1]} · ${season.amplitude_pct}% of the mean month`,
      children: <AreaChart categories={MONTHS} series={yearly} unit="MWh" format={short} height={152} />,
    })
  }

  cards.push({
    id: "levels",
    from: ["register"],
    tone: TONE.drawn,
    w: W.table,
    title: "What the area draws",
    note: "Each unit is counted where it joins the network, a point it shares with the units on the same pole or transformer. A level with no unit inside the area is absent rather than zero.",
    children: (
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
    ),
  })

  if (demand.density) {
    const density = demand.density
    cards.push({
      id: "density",
      from: ["levels"],
      tone: TONE.drawn,
      w: W.density,
      title: "Where it falls",
      right: `${density.cell_km} km cells`,
      note: density.note,
      children: (
        <>
          <Legend scale={density.scale} unit={density.unit} title="Per cell" />
          <div className="mt-2">
            <Stat
              label="Cells that hold a unit"
              value={`${density.cells.toLocaleString()} of ${(density.grid.nx * density.grid.ny).toLocaleString()}`}
            />
            {conc && <Stat label="Carried by the busiest tenth" value={`${conc.decil_superior_pct}%`} />}
          </div>
        </>
      ),
    })
  }

  if (demand.por_classe.length > 0) {
    cards.push({
      id: "classes",
      from: ["levels"],
      tone: TONE.drawn,
      w: W.table,
      title: "By tariff class",
      right: "low voltage",
      children: (
        <RankedBars
          bars={demand.por_classe.map((c, i) => ({
            key: c.clas_sub ?? `unnamed-${i}`,
            label: c.clas_sub ?? "no class",
            sub: metric === "energy" ? units(c.unidades) : short(c.energia_ano_mwh),
            value: byMetric(c),
          }))}
          format={fmtMetric}
          unit={metric === "energy" ? "MWh/year" : "connection points"}
          labelWidth={84}
        />
      ),
    })
  }

  if (demand.por_municipio.length > 0) {
    cards.push({
      id: "towns",
      from: ["levels"],
      tone: TONE.drawn,
      w: W.table,
      title: "By municipality",
      right: "low voltage",
      note: "IBGE codes; the register carries no name for them.",
      children: (
        <RankedBars
          bars={demand.por_municipio.map((m, i) => ({
            key: m.mun ?? `unnamed-${i}`,
            label: m.mun ?? "no code",
            sub: metric === "energy" ? units(m.unidades) : short(m.energia_ano_mwh),
            value: byMetric(m),
          }))}
          format={fmtMetric}
          labelWidth={84}
        />
      ),
    })
  }

  if (generation.length > 0) {
    cards.push({
      id: "generation",
      from: ["register"],
      tone: TONE.returned,
      w: W.scatter,
      title: "Behind the meter, against what the site can make",
      right: `${sampled.toLocaleString()} of ${generators.toLocaleString()} drawn`,
      note: "The energy is what reached the network. Self-consumption never crossed the distributor's meter and is not in the register, so this is injection and roughly half of what these roofs generate. A row above the line has a wrong power or a wrong energy; it is drawn rather than dropped, because where those rows sit is how far the register can be trusted at this place.",
      children: (
        <>
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
        </>
      ),
    })
  }

  cards.push({
    id: "assumed",
    from: generation.length > 0 ? ["generation"] : ["register"],
    w: W.assumed,
    title: "What this reading assumed",
    note: demand.assumptions.teto_de_rendimento.nota,
    children: (
      <>
        <Stat label="Energy of a generator" value={demand.assumptions.energia_da_geracao} />
        <Stat label="Installed power" value={demand.assumptions.potencia_instalada} />
        <Stat label="Where a unit is" value={demand.assumptions.posicao} />
        <Stat
          label={`Yield ceiling · ${demand.assumptions.teto_de_rendimento.origem}`}
          value={`${Math.round(demand.assumptions.teto_de_rendimento.valor_kwh_kwp_ano).toLocaleString()} kWh/kWp/year`}
        />
      </>
    ),
  })

  return (
    <Board
      cards={cards}
      places={places}
      onMove={onMove}
      onReset={onReset}
      /*
        One control, over the board rather than in a card. Both ranked cards
        read the same quantity, so the board can never show a class leading by
        energy beside a town leading by count and leave the reader to notice.
      */
      toolbar={
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/[0.07] bg-card/90 px-2 py-1.5 backdrop-blur">
          <Tabs
            label="Rank by"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "energy", label: "Energy" },
              { value: "units", label: "Units" },
            ]}
          />
        </div>
      }
    />
  )
}

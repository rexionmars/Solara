import { useState } from "react"
import type { grid } from "../../../wailsjs/go/models"
import { polygonAreaKm2 } from "../../lib/geo"
import { ORIGIN_MEANING, REASON_MEANING, km, kv, mw, mwh, pct } from "../../lib/grid"
import type { Polygon } from "../../lib/project"
import { ShareBar } from "./charts"
import { DetailRow, IndicatorCard, IndicatorRow, ReadingHead, ReadingPage, ReadingPanel, ReadingSource, Segmented } from "./primitives"

/**
 * Where an area could join the transmission network, as TERRA's
 * GridCongestionReading reads it.
 *
 * ATTACHMENT FIRST, PROXIMITY AFTER. Where plants of the area are already
 * joined is published by the operator, and it is not the nearest substation:
 * ONS puts a station's 500, 230 and 138 kV buses at one coordinate, so the
 * nearest one is often the wrong voltage. So the published attachment leads,
 * the neighbours' attachments stand in when the area has no metered plant, and
 * distance comes last, as what is within reach of ground that has neither.
 *
 * PROXIMITY AND CURTAILMENT ARE NEVER COMBINED. A site beside a 440 kV line can
 * still lose a seventh of its output, because the constraint is upstream; the
 * two are separate panels and no score is drawn from them.
 *
 * ON THE READING'S PAGE: the head, four indicators, the panel that draws how
 * far each substation and each line in service is, and -- only where plants
 * of the area are metered -- the panel of what they were kept from
 * delivering. What explains a panel is behind its info button; "unconfirmed"
 * and "rating not published" change how a figure is read, and stay beside it.
 */

/** Named things by distance, nearest first: the bar's length is the distance, on one scale for the panel. */
function Distances({ rows }: { rows: { key: string; name: string; km: number }[] }) {
  const sorted = [...rows].sort((a, b) => a.km - b.km)
  const max = Math.max(...sorted.map((r) => r.km), 0.001)
  return (
    <div className="reading-bars">
      {sorted.map((r) => (
        <div key={r.key} className="contents">
          <span className="name" title={r.name}>
            {r.name}
          </span>
          <span className="track">
            <span style={{ width: `${(r.km / max) * 100}%` }} />
          </span>
          <span className="figure">{km(r.km)}</span>
        </div>
      ))}
    </div>
  )
}

export function ConnectionBody({ connection, area }: { connection: grid.ConnectionAnalysis; area: Polygon }) {
  const [view, setView] = useState<"substations" | "lines">("substations")
  const c = connection.connection
  const joined = c.attachment
  const neighbours = c.neighbours
  const curtail = connection.curtailment_at_connected_plants
  const standing = joined.length ? "attached" : neighbours.length ? "neighbours" : c.reachable ? "proximity" : "out of reach"
  const first = joined[0]
  const headroom = joined.length ? c.attached_bus_headroom : c.neighbour_bus_headroom
  const substations = c.substations.map((s) => ({ key: `${s.name}:${s.voltage_kv}`, name: `${s.name} · ${kv(s.voltage_kv)}`, km: s.distance_km }))
  const lines = c.lines.map((l, i) => ({
    key: `${l.name}:${i}`,
    name: `${l.name.replace(/\s+/g, " ")} · ${l.capacity_mva == null ? "rating not published" : `${l.capacity_mva} MVA`}`,
    km: l.distance_km,
  }))
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  return (
    <ReadingPage>
      <ReadingHead
        title="Grid connection"
        about={`Where ${polygonAreaKm2(area).toFixed(2)} km² of ground could join the transmission network, searched ${c.searched_km.toFixed(0)} km around it.`}
        tag={standing}
      />

      <IndicatorRow>
        <IndicatorCard
          title="Joined at"
          sub="Where plants here already connect"
          value={first?.point_code ?? "—"}
          chip={first ? `${kv(first.voltage_kv)}${first.voltage_confirmed ? "" : ", unconfirmed"}` : neighbours.length ? "neighbours only" : "no metered plant"}
        >
          {first ? (first.substation ?? "Bus unmatched") : neighbours.length ? "No plant of the record stands on this ground; its neighbours' points are in Details." : "No plant of the record stands on or near this ground."}
        </IndicatorCard>
        <IndicatorCard
          title="Nearest substation"
          sub="In a straight line"
          value={c.nearest_substation ? c.nearest_substation.distance_km.toFixed(1) : "—"}
          unit={c.nearest_substation ? "km" : undefined}
          chip={c.nearest_substation ? kv(c.nearest_substation.voltage_kv) : "none within reach"}
        >
          {c.nearest_substation?.name ?? "Nothing on the register inside the search."}
        </IndicatorCard>
        <IndicatorCard
          title="Nearest line"
          sub="In service"
          value={c.nearest_line ? c.nearest_line.distance_km.toFixed(1) : "—"}
          unit={c.nearest_line ? "km" : undefined}
          chip={c.nearest_line ? kv(c.nearest_line.voltage_kv) : "none within reach"}
        >
          {c.nearest_line ? (c.nearest_line.capacity_mva == null ? "Rating not published." : `Rated ${c.nearest_line.capacity_mva} MVA.`) : "Nothing on the register inside the search."}
        </IndicatorCard>
        <IndicatorCard
          title="Withheld"
          sub="At the plants already here"
          value={curtail?.withheld_fraction != null ? (curtail.withheld_fraction * 100).toFixed(1) : "—"}
          unit={curtail?.withheld_fraction != null ? "%" : undefined}
          chip={curtail ? count(curtail.plants_in_aoi, "metered plant", "metered plants") : "no record"}
        >
          {curtail ? `Of what the operator expected, ${curtail.window}.` : "An absence of measurement, not a curtailment of zero."}
        </IndicatorCard>
      </IndicatorRow>

      <ReadingPanel
        title={
          c.reachable
            ? `${count(c.substations.length, "substation", "substations")} and ${count(c.lines.length, "line in service", "lines in service")} within reach`
            : "Nothing on the register is within reach"
        }
        sub={c.reachable ? `Distance from the area to each ${view === "substations" ? "substation" : "line"}, nearest first` : undefined}
        controls={
          c.reachable ? (
            <Segmented
              label="What the panel lists"
              value={view}
              onChange={setView}
              options={[
                { value: "substations", label: "Substations" },
                { value: "lines", label: "Lines" },
              ]}
            />
          ) : undefined
        }
        note={
          <>
            <p>{connection.note}</p>
            {c.reachable && (
              <p>
                {c.route_factor.note} Median ×{c.route_factor.median.toFixed(3)}, p90 ×{c.route_factor.p90.toFixed(3)}. A rating is published
                for {Math.round(c.capacity_published_fraction * 100)}% of circuits, so a missing one is unpublished rather than zero.
              </p>
            )}
            {joined.some((a) => !a.voltage_confirmed) && (
              <p>
                An unconfirmed bus was matched by position alone; its voltage is not confirmed by the connection code, so it may be the wrong
                level of the right station.
              </p>
            )}
            {!joined.length && neighbours.length > 0 && (
              <p>
                The neighbours' points are where the plants nearby enter the network: a project here would be asking to join the same part of
                the system. Whether it would be allowed to is an access opinion, which the operator issues and does not publish.
              </p>
            )}
            {headroom[0]?.note && <p>{headroom[0].note}</p>}
          </>
        }
        details={
          joined.length || neighbours.length || headroom.length ? (
            <>
              {joined.map((a) => (
                <DetailRow
                  key={`${a.id_ons}:${a.point_code}`}
                  label={`${a.entity} joins at ${a.point_code}`}
                  value={`${a.substation ?? "unmatched"} · ${kv(a.voltage_kv)}${a.voltage_confirmed ? "" : ", unconfirmed"} · ${mw(a.capacity_mw)}`}
                />
              ))}
              {!joined.length &&
                neighbours.map((n) => (
                  <DetailRow
                    key={`${n.id_ons}:${n.point_code}`}
                    label={`${n.entity}, ${km(n.distance_km)} away, joins at ${n.point_code}`}
                    value={`${n.substation ?? "unmatched"} · ${kv(n.voltage_kv)} · ${mw(n.capacity_mw)}`}
                  />
                ))}
              {headroom.map((h) => (
                <DetailRow
                  key={h.bus}
                  label={`Bus ${h.bus}: ${count(h.lines_in_service, "circuit", "circuits")}, ${count(h.units_attached, "unit", "units")} attached`}
                  value={`${h.line_capacity_mva == null ? "rating not published" : `${Math.round(h.line_capacity_mva).toLocaleString()} MVA`} · ${mw(h.attached_mw)}`}
                />
              ))}
            </>
          ) : undefined
        }
      >
        {c.reachable ? <Distances rows={view === "substations" ? substations : lines} /> : <p className="py-4 text-[13px] text-[var(--s-text-muted)]">{c.note}</p>}
      </ReadingPanel>

      {curtail && (
        <ReadingPanel
          title={`Restricted in ${pct(curtail.restricted_fraction)} of the half hours`}
          sub="What the operator expected of the plants here, by what became of it"
          note={<p>{curtail.basis}</p>}
          details={
            <>
              <DetailRow label="Expected by the operator" value={mwh(curtail.expected_mwh)} />
              <DetailRow label="Most frequent reason" value={curtail.top_reason ? `${curtail.top_reason} · ${REASON_MEANING[curtail.top_reason] ?? "unlisted"}` : "—"} />
              <DetailRow label="Most frequent origin" value={curtail.top_origin ? `${curtail.top_origin} · ${ORIGIN_MEANING[curtail.top_origin] ?? "unlisted"}` : "—"} />
              <DetailRow label="Estimate gap when unrestricted" value={pct(curtail.unrestricted_baseline_fraction)} />
            </>
          }
        >
          <ShareBar
            unit="GWh"
            parts={[
              { key: "delivered", label: "Delivered", color: "#d9d9d9", value: curtail.delivered_mwh / 1000, pct: curtail.expected_mwh > 0 ? (100 * curtail.delivered_mwh) / curtail.expected_mwh : 0 },
              { key: "withheld", label: "Withheld", color: "#b8862f", value: curtail.withheld_mwh / 1000, pct: curtail.expected_mwh > 0 ? (100 * curtail.withheld_mwh) / curtail.expected_mwh : 0 },
            ]}
          />
        </ReadingPanel>
      )}

      <ReadingSource>
        {c.source || "ONS transmission equipment register"} · ANEEL plant register · the local grid store
        {!curtail && connection.curtailment_absent ? ` · curtailment not read: ${connection.curtailment_absent}` : ""}
      </ReadingSource>
    </ReadingPage>
  )
}

import type { grid } from "../../../wailsjs/go/models"
import { polygonAreaKm2 } from "../../lib/geo"
import { ORIGIN_MEANING, REASON_MEANING, km, kv, mw, mwh, pct } from "../../lib/grid"
import type { Polygon } from "../../lib/project"
import { DocumentHeader, Figure, FigureGrid, Section, Stat, StatGrid } from "./primitives"

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
 * two are separate sections and no score is drawn from them.
 */

function Headroom({ rows, lead }: { rows: grid.BusHeadroom[]; lead: string }) {
  return (
    <StatGrid>
      {rows.map((h) => (
        <div key={h.bus} className="py-1">
          <p className="text-xs text-foreground">
            {lead} {h.bus}
          </p>
          <Stat
            label={`Line capacity · ${h.lines_in_service} circuit${h.lines_in_service === 1 ? "" : "s"}`}
            value={h.line_capacity_mva == null ? "rating not published" : `${Math.round(h.line_capacity_mva).toLocaleString()} MVA`}
          />
          <Stat label={`Attached · ${h.units_attached} unit${h.units_attached === 1 ? "" : "s"}`} value={mw(h.attached_mw)} />
        </div>
      ))}
    </StatGrid>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{children}</p>
}

export function ConnectionBody({ connection, area }: { connection: grid.ConnectionAnalysis; area: Polygon }) {
  const c = connection.connection
  const joined = c.attachment
  const neighbours = c.neighbours
  const curtail = connection.curtailment_at_connected_plants
  const standing = joined.length ? "attached" : neighbours.length ? "neighbours" : c.reachable ? "proximity" : "out of reach"

  return (
    <>
      <DocumentHeader
        product="Grid connection"
        title={`${polygonAreaKm2(area).toFixed(2)} km²  ·  searched ${c.searched_km.toFixed(0)} km`}
        meta={`${c.source || "ONS transmission equipment register"} · ANEEL plant register · the local grid store`}
        chips={[standing]}
      />

      <FigureGrid>
        <Figure
          label="Joined at"
          value={joined[0]?.point_code ?? "—"}
          sub={joined[0] ? `${joined[0].substation ?? "bus unmatched"} · ${kv(joined[0].voltage_kv)}` : "no metered plant in the area"}
        />
        <Figure
          label="Nearest substation"
          value={km(c.nearest_substation?.distance_km)}
          sub={c.nearest_substation ? `${c.nearest_substation.name} · ${kv(c.nearest_substation.voltage_kv)}` : "none within reach"}
        />
        <Figure
          label="Nearest line"
          value={km(c.nearest_line?.distance_km)}
          sub={
            c.nearest_line
              ? `${kv(c.nearest_line.voltage_kv)} · ${c.nearest_line.capacity_mva == null ? "rating not published" : `${c.nearest_line.capacity_mva} MVA`}`
              : "none within reach"
          }
        />
        <Figure label="Withheld at the plants here" value={pct(curtail?.withheld_fraction)} sub={curtail ? curtail.window : "no metered plant, or no record"} />
      </FigureGrid>

      <div className="mt-6">
        {!c.reachable && !joined.length && (
          <Section title="Out of reach">
            <p className="text-sm leading-relaxed text-foreground">{c.note}</p>
          </Section>
        )}

        {joined.length > 0 && (
          <Section title="Where this ground is joined">
            <div className="flex flex-col gap-3">
              {joined.map((a) => (
                <div key={`${a.id_ons}:${a.point_code}`}>
                  <Stat label={a.entity} value={a.point_code} />
                  <Stat label="Bus" value={`${a.substation ?? "unmatched"} · ${kv(a.voltage_kv)}`} />
                  <Stat label="Capacity" value={mw(a.capacity_mw)} />
                  {!a.voltage_confirmed && (
                    <Note>
                      The bus was matched by position alone; its voltage is not confirmed by the connection code, so this may be the wrong level of
                      the right station.
                    </Note>
                  )}
                </div>
              ))}
            </div>
            {c.attached_bus_headroom.length > 0 && (
              <div className="mt-4">
                <Headroom rows={c.attached_bus_headroom} lead="What leaves bus" />
                <Note>{c.attached_bus_headroom[0].note}</Note>
              </div>
            )}
          </Section>
        )}

        {joined.length === 0 && neighbours.length > 0 && (
          <Section title="Where the neighbours are joined">
            <div className="flex flex-col gap-2">
              {neighbours.map((n) => (
                <div key={`${n.id_ons}:${n.point_code}`}>
                  <Stat label={`${n.entity} · ${km(n.distance_km)}`} value={n.point_code} />
                  <Stat label="Bus" value={`${n.substation ?? "unmatched"} · ${kv(n.voltage_kv)} · ${mw(n.capacity_mw)}`} />
                </div>
              ))}
            </div>
            {c.neighbour_bus_headroom.length > 0 && (
              <div className="mt-4">
                <Headroom rows={c.neighbour_bus_headroom} lead="Bus" />
              </div>
            )}
            <Note>
              No plant of the record stands on this ground, so none of this is published about it. These are the points the plants nearby
              enter the network at: a project here would be asking to join the same part of the system. Whether it would be allowed to is an
              access opinion, which the operator issues and does not publish.
            </Note>
          </Section>
        )}

        {c.reachable && (
          <Section title={joined.length ? "Also within reach" : "Nearest on the register"}>
            <StatGrid>
              <div>
                <p className="mb-1 text-xs text-foreground">Substations</p>
                {c.substations.map((s) => (
                  <Stat key={`${s.name}:${s.voltage_kv}`} label={`${s.name} · ${kv(s.voltage_kv)}`} value={km(s.distance_km)} />
                ))}
              </div>
              <div>
                <p className="mb-1 text-xs text-foreground">Lines in service</p>
                {c.lines.map((l, i) => (
                  <Stat
                    key={`${l.name}:${i}`}
                    label={`${l.name.replace(/\s+/g, " ")} · ${l.capacity_mva == null ? "unrated" : `${l.capacity_mva} MVA`}`}
                    value={km(l.distance_km)}
                  />
                ))}
              </div>
            </StatGrid>
            <Note>
              {c.route_factor.note} Median ×{c.route_factor.median.toFixed(3)}, p90 ×{c.route_factor.p90.toFixed(3)}. A rating is published for{" "}
              {Math.round(c.capacity_published_fraction * 100)}% of circuits, so a missing one is unpublished rather than zero.
            </Note>
          </Section>
        )}

        <Section title="At the plants already joined here">
          {curtail ? (
            <>
              <StatGrid>
                <Stat label="Metered plants in the area" value={String(curtail.plants_in_aoi)} />
                <Stat label="Window" value={curtail.window} />
                <Stat label="Expected by the operator" value={mwh(curtail.expected_mwh)} />
                <Stat label="Delivered" value={mwh(curtail.delivered_mwh)} />
                <Stat label="Withheld" value={`${mwh(curtail.withheld_mwh)} · ${pct(curtail.withheld_fraction)}`} />
                <Stat label="Half hours under restriction" value={pct(curtail.restricted_fraction)} />
                <Stat
                  label="Most frequent reason"
                  value={curtail.top_reason ? `${curtail.top_reason} · ${REASON_MEANING[curtail.top_reason] ?? "unlisted"}` : "—"}
                />
                <Stat
                  label="Most frequent origin"
                  value={curtail.top_origin ? `${curtail.top_origin} · ${ORIGIN_MEANING[curtail.top_origin] ?? "unlisted"}` : "—"}
                />
                <Stat label="Estimate gap when unrestricted" value={pct(curtail.unrestricted_baseline_fraction)} />
              </StatGrid>
              <Note>{curtail.basis}</Note>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {connection.curtailment_absent
                ? `Not read: ${connection.curtailment_absent}`
                : "No metered plant stands in this area, so the record says nothing about what a plant here would lose. That is an absence of measurement, not a curtailment of zero."}
            </p>
          )}
        </Section>

        <Note>{connection.note}</Note>
      </div>
    </>
  )
}

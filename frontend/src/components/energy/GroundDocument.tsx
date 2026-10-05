import type { energy } from "../../../wailsjs/go/models"
import { groundClassLabel } from "../../lib/ground"
import type { Polygon } from "../../lib/project"
import { RuleCurve, ShareBar } from "./charts"
import { DetailRow, IndicatorCard, IndicatorRow, ReadingHead, ReadingPage, ReadingPanel, ReadingSource } from "./primitives"

/**
 * The usable-ground reading, on the reading's page: how much of the land
 * neither rule excludes, what each rule takes, and what another rule would
 * have left.
 *
 * EVERY SHARE NAMES ITS WHOLE. There are two: the area that was drawn, and
 * the land inside it once the permanent water is out. An area that reaches
 * the sea is a different number against each, so no percentage here stands
 * without "of the area" or "of land" beside it. The rules act on the land
 * alone, so the figures about a rule, and both curves, are of the land.
 *
 * A NUMBER IS WRITTEN ONCE. The indicators carry the shares; the bar under
 * them carries each part's size, and a part's share is the length of its
 * stretch. Where the ground is, is on the map.
 *
 * WHAT STAYS ON SCREEN AND WHAT IS BEHIND THE INFO BUTTON. The flood rule is
 * a lower bound and the water is permanent water only: the short form of each
 * is in a card's title or its chip, always visible. The sentence that
 * explains it is a panel's note.
 */

const pct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : v.toFixed(digits))
const deg = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}°`)

/**
 * Which rule takes more of the land, said only when one clearly does: a
 * quarter more than the other. Otherwise the two are said to take alike.
 */
function finding(slope: number, flood: number, flooded: boolean): string {
  if (!flooded) return "Slope is the only rule applied to the land"
  if (flood > slope * 1.25) return "Low ground excludes more of the land than slope does"
  if (slope > flood * 1.25) return "Slope excludes more of the land than low ground does"
  return "Slope and low ground exclude about as much of the land"
}

export function GroundBody({ ground, area: _area }: { ground: energy.UsableGroundAnalysis; area: Polygon }) {
  /*
    A result computed before water was told apart carries neither the land nor
    the water fields. It is read as what it was: no water map, every measured
    cell counted as land -- which is also what its own caveat says.
  */
  const g = {
    ...ground,
    land_km2: ground.land_km2 ?? ground.area_km2,
    water_km2: ground.water_km2 ?? 0,
    usable_of_land_pct: ground.usable_of_land_pct ?? (ground.land_km2 == null ? ground.usable_pct : undefined),
    water: ground.water ?? { source: "", attribution: "", mapped: false, unmapped_km2: 0 },
  }
  const flooded = g.rules.hand_min_m > 0
  const parts = g.classes.map((c) => ({ key: c.key, label: groundClassLabel(c.key), color: c.colour, value: c.area_km2, pct: c.pct }))
  return (
    <ReadingPage>
      <ReadingHead
        title="Usable ground"
        about="The land of the area that is neither too steep nor too low above its drainage for a plant to stand on."
        chips={["terrain only"]}
      />

      <IndicatorRow>
        <IndicatorCard title="Usable" sub="Neither rule excludes it" value={pct(g.usable_of_land_pct)} unit="% of land" chip={`${g.usable_pct.toFixed(1)}% of the area`}>
          The land is what is left of the area once its permanent water is out.
        </IndicatorCard>
        <IndicatorCard title="Land" sub="The ground the rules act on" value={g.land_km2.toFixed(1)} unit="km²" chip={`of ${g.area_km2.toFixed(1)} km² measured`}>
          {g.water.mapped ? "The rest is permanent water." : "No water map covers this area: every measured cell counts as land."}
        </IndicatorCard>
        <IndicatorCard
          title="Excluded by slope"
          sub="Too steep to build on"
          value={pct(g.excluded_by_slope_pct)}
          unit="% of land"
          chip={`steeper than ${g.rules.slope_max_deg}°`}
        >
          Counts the ground the flood rule excludes as well.
        </IndicatorCard>
        <IndicatorCard
          title="Excluded by flood, at least"
          sub="Too low above its drainage"
          value={flooded ? pct(g.excluded_by_flood_pct) : "—"}
          unit={flooded ? "% of land" : undefined}
          chip={flooded ? "a lower bound" : "the rule is off"}
        >
          {flooded ? `Ground under ${g.rules.hand_min_m} m above the nearest drainage.` : "No height above drainage was asked for."}
        </IndicatorCard>
      </IndicatorRow>

      <ReadingPanel
        title={finding(g.classes.find((c) => c.key === "slope")?.area_km2 ?? 0, g.classes.find((c) => c.key === "flood")?.area_km2 ?? 0, flooded)}
        sub="The area that was drawn, by what excludes each part of it"
        note={
          <>
            <p>{g.caveats.water}</p>
            {g.no_data_km2 > 0 && <p>{`${g.no_data_km2.toFixed(1)} km² more of the area carry no elevation and are in no part.`}</p>}
          </>
        }
        details={
          <>
            <DetailRow label="Mean slope of the land" value={deg(g.slope_mean_deg)} />
            <DetailRow label="Maximum slope of the land" value={deg(g.slope_max_deg)} />
            <DetailRow label="Median height above drainage" value={g.hand_median_m == null ? "—" : `${g.hand_median_m.toFixed(1)} m`} />
            <DetailRow label="A cell is drainage from" value={`${g.rules.drainage_km2} km² upstream`} />
            <DetailRow label="Cell" value={`${g.cell_m[0].toFixed(1)} × ${g.cell_m[1].toFixed(1)} m`} />
            <DetailRow label="Drainage buffer around the area" value={`${(g.buffer_m / 1000).toFixed(1)} km`} />
          </>
        }
      >
        <ShareBar parts={parts} unit="km²" />
      </ReadingPanel>

      <ReadingPanel
        title="Had a rule been another"
        sub="Usable share of the land as one rule moves and the other is held"
        note={
          <>
            <p>{`The slope curve holds the flood rule at ${g.rules.hand_min_m} m; the flood curve holds the slope rule at ${g.rules.slope_max_deg}°.`}</p>
            <p>{g.caveats.hand}</p>
          </>
        }
      >
        <div className="reading-two">
          <RuleCurve
            points={g.sensitivity.slope.map((p) => ({ x: p.value, y: p.usable_pct }))}
            at={g.rules.slope_max_deg}
            xUnit="°"
            xLabel="Maximum slope"
            yLabel="Usable, of land"
          />
          <RuleCurve
            points={g.sensitivity.hand.map((p) => ({ x: p.value, y: p.usable_pct }))}
            at={g.rules.hand_min_m}
            xUnit="m"
            xLabel="Minimum height above drainage"
            yLabel="Usable, of land"
            color="#0072b2"
          />
        </div>
      </ReadingPanel>

      <ReadingSource>
        {g.dem_source}
        {g.water.mapped ? ` · ${g.water.source} · ${g.water.attribution}` : ""}
      </ReadingSource>
    </ReadingPage>
  )
}

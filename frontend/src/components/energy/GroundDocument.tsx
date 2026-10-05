import type { energy } from "../../../wailsjs/go/models"
import { groundClassLabel, groundRules } from "../../lib/ground"
import type { Polygon } from "../../lib/project"
import { RuleCurve, ShareBar } from "./charts"
import { DocumentHeader, KpiCard, Panel, PanelGrid, Stat } from "./primitives"

/**
 * The usable-ground reading: how much of the area neither rule excludes, what
 * each rule takes, and what another rule would have left.
 *
 * EVERY SHARE NAMES ITS WHOLE. There are two: the area that was drawn, and
 * the land inside it once the permanent water is out. An area that reaches
 * the sea is a different number against each, so no percentage here stands
 * without "of the area" or "of the land" beside it. The rules act on the land
 * alone, so the figures about a rule, and both curves, are of the land.
 *
 * A NOTE SITS UNDER THE NUMBER IT QUALIFIES, and only there. The two caveats
 * the sidecar sends change how a figure must be read -- the flood rule is a
 * lower bound, and the water class is permanent water only -- so each is set
 * beside the figures it bounds rather than gathered in a section nobody reads.
 */

function Note({ children }: { children: string }) {
  return <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{children}</p>
}

const pct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : v.toFixed(digits))
const deg = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}°`)

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
  const noLand = g.land_km2 <= 0
  const parts = g.classes.map((c) => ({
    key: c.key,
    label: groundClassLabel(c.key),
    color: c.colour,
    value: c.area_km2,
    pct: c.pct,
    pct2: c.pct_of_land ?? (ground.land_km2 == null ? c.pct : null),
  }))
  return (
    <>
      <DocumentHeader
        product="Usable ground"
        // The area alone: its two shares are on the first figure below, each beside its whole.
        title={`${g.usable_km2.toFixed(1)} km² usable`}
        meta={`${groundRules(ground)} · ${g.dem_source} · ${g.pixels.toLocaleString()} cells of ${g.cell_m[0].toFixed(0)} m`}
        chips={["terrain only"]}
      />
      <div className="mb-2.5 grid grid-cols-2 gap-2.5 @3xl:grid-cols-4">
        <KpiCard
          label="Usable"
          value={g.usable_km2.toFixed(1)}
          unit="km²"
          note={`${g.usable_pct.toFixed(1)}% of the area · ${pct(g.usable_of_land_pct)}% of its land`}
        />
        <KpiCard
          label="Land"
          value={g.land_km2.toFixed(1)}
          unit="km²"
          note={`of ${g.area_km2.toFixed(1)} km² measured; ${g.water_km2.toFixed(1)} km² is permanent water`}
        />
        <KpiCard
          label="Excluded by slope"
          value={pct(g.excluded_by_slope_pct)}
          unit={noLand ? undefined : "% of land"}
          note={`steeper than ${g.rules.slope_max_deg}°`}
        />
        <KpiCard
          label="Excluded by flood, at least"
          value={flooded ? pct(g.excluded_by_flood_pct) : "—"}
          unit={flooded && !noLand ? "% of land" : undefined}
          note={flooded ? `under ${g.rules.hand_min_m} m above drainage; a lower bound` : "the rule is off"}
        />
      </div>

      <PanelGrid>
        <Panel title="Layer">
          <img
            src={g.overlay_url}
            alt="Usable ground, by what excludes each cell"
            className="max-h-[22rem] w-full rounded border border-border bg-sunk object-contain [image-rendering:pixelated]"
          />
        </Panel>
        <Panel title="The area by what excludes it">
          <ShareBar parts={parts} unit="km²" of={["of area", "of land"]} />
          <Note>{g.caveats.water}</Note>
          {g.no_data_km2 > 0 && <Note>{`${g.no_data_km2.toFixed(1)} km² more of the area carry no elevation and are in neither share.`}</Note>}
        </Panel>
        <Panel title="Had the slope rule been another">
          <RuleCurve
            points={g.sensitivity.slope.map((p) => ({ x: p.value, y: p.usable_pct }))}
            at={g.rules.slope_max_deg}
            xUnit="°"
            xLabel="Maximum slope"
            yLabel="Usable, of land"
          />
          <Note>{`Usable share of the land, with the flood rule held at ${g.rules.hand_min_m} m.`}</Note>
        </Panel>
        <Panel title="Had the flood rule been another">
          <RuleCurve
            points={g.sensitivity.hand.map((p) => ({ x: p.value, y: p.usable_pct }))}
            at={g.rules.hand_min_m}
            xUnit="m"
            xLabel="Minimum height above drainage"
            yLabel="Usable, of land"
            color="#0072b2"
          />
          <Note>{g.caveats.hand}</Note>
        </Panel>
        <Panel title="Terrain of the land">
          <Stat label="Mean slope" value={deg(g.slope_mean_deg)} />
          <Stat label="Maximum slope" value={deg(g.slope_max_deg)} />
          <Stat label="Median height above drainage" value={g.hand_median_m == null ? "—" : `${g.hand_median_m.toFixed(1)} m`} />
        </Panel>
        <Panel title="How it was read">
          <Stat label="Elevation model" value={g.dem_source} />
          <Stat label="Cell" value={`${g.cell_m[0].toFixed(1)} × ${g.cell_m[1].toFixed(1)} m`} />
          <Stat label="Drainage buffer around the area" value={`${(g.buffer_m / 1000).toFixed(1)} km`} />
          <Stat label="A cell is drainage from" value={`${g.rules.drainage_km2} km² upstream`} />
          <Stat label="Water" value={g.water.mapped ? g.water.source : "no map over this area"} />
          {g.water.mapped && <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{g.water.attribution}</p>}
          <p className="selectable mt-2 break-all font-mono text-[11px] text-muted-foreground">GeoTIFF (uint8 classes): {g.raster_tif}</p>
        </Panel>
      </PanelGrid>
    </>
  )
}

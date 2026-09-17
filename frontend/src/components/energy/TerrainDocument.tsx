import type { energy } from "../../../wailsjs/go/models"
import { polygonAreaKm2 } from "../../lib/geo"
import { seasonLabel } from "../../lib/params"
import type { Polygon } from "../../lib/project"
import { Legend } from "./Legend"
import {
  DocumentHeader,
  Figure,
  FigureGrid,
  ProvenanceNote,
  Section,
  Stat,
  StatGrid,
} from "./primitives"

const pct = (v: number | undefined | null, digits = 2) => (v == null ? "—" : `${v.toFixed(digits)}%`)

export function TerrainBody({ terrain, area }: { terrain: energy.SolarTerrainAnalysis; area: Polygon }) {
  const t = terrain
  const fmt = (v: number) => v.toFixed(t.scale.decimals)
  const sky = t.sky_view
  return (
    <>
      <DocumentHeader
        product="Solar terrain"
        title={`${polygonAreaKm2(area).toFixed(2)} km²  ·  ${seasonLabel(t.season)}`}
        meta={`${t.dem_source} · ${t.pixels.toLocaleString()} cells inside the area · ${t.hourly_years} years hourly, NASA POWER`}
      />
      <FigureGrid>
        <Figure label="Mean" value={fmt(t.poa_mean)} sub={t.unit} />
        <Figure label="Minimum" value={fmt(t.poa_min)} sub={t.unit} />
        <Figure label="Maximum" value={fmt(t.poa_max)} sub={t.unit} />
        <Figure label="Spatial spread" value={pct(t.poa_std_pct)} sub="standard deviation over mean" />
      </FigureGrid>

      <div className="mt-6">
        <Section title="Layer">
          <div className="grid grid-cols-1 gap-5 @2xl:grid-cols-[1fr_16rem]">
            <img
              src={t.overlay_url}
              alt={`Solar terrain layer, ${seasonLabel(t.season)}`}
              className="max-h-[28rem] w-full rounded border border-border bg-sunk object-contain [image-rendering:pixelated]"
            />
            <Legend scale={t.scale} unit={t.unit} title={seasonLabel(t.season)} />
          </div>
        </Section>
        <Section title="Terrain">
          <StatGrid>
            <Stat label="Mean slope" value={`${t.slope_mean_deg.toFixed(1)}°`} />
            <Stat label="Maximum slope" value={`${t.slope_max_deg.toFixed(1)}°`} />
            <Stat label="Horizon traced to" value={`${(t.horizon_max_dist_m / 1000).toFixed(1)} km`} />
            <Stat label="Elevation model" value={t.dem_source} />
          </StatGrid>
        </Section>
        <Section title="Shading">
          <StatGrid>
            {/* The shading loss applies to the beam, so its share is what the
                figure below is weighed by before it reaches the totals. */}
            <Stat label="Beam share of horizontal irradiation" value={pct(t.beam_fraction * 100, 0)} />
            <Stat label="Horizon shading, mean" value={pct(t.shading_mean_pct)} />
            <Stat label="Horizon shading, maximum" value={pct(t.shading_max_pct, 1)} />
          </StatGrid>
        </Section>
        {sky && (
          <Section title="Sky view">
            <StatGrid>
              <Stat label="Diffuse loss applied" value={sky.applied ? "yes" : "no, terrain too open"} />
              <Stat label="Mean horizon" value={`${sky.mean_horizon_deg.toFixed(1)}°`} />
              <Stat label="Maximum horizon" value={`${sky.max_horizon_deg.toFixed(1)}°`} />
              <Stat label="Threshold for applying it" value={`${sky.threshold_deg.toFixed(1)}° mean horizon`} />
              <Stat label="Diffuse loss, mean" value={pct(sky.diffuse_loss_mean_pct)} />
              <Stat label="Diffuse loss, maximum" value={pct(sky.diffuse_loss_max_pct)} />
            </StatGrid>
          </Section>
        )}
        <Section title="Resolution and output">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The irradiation is resolved on NASA POWER's 1° radiation cell; what varies across the area is the
            surface it falls on, from the elevation model at 30 m. Solar position is evaluated at the cell, not at
            each pixel.
          </p>
          <p className="selectable mt-2 break-all font-mono text-[11px] text-muted-foreground">GeoTIFF (float32): {t.raster_tif}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            The GeoTIFF and the layer are saved with the project (File › Save), and can be taken out with File › Export ›
            Terrain Layer as GeoTIFF. An unsaved project's rasters are removed when the application closes.
          </p>
          <ProvenanceNote provenance={t.power_provenance} />
        </Section>
      </div>
    </>
  )
}

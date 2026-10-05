package energy

import (
	"errors"
	"fmt"
	"math"
)

// Polygon is a GeoJSON Polygon in WGS84 longitude and latitude: an outer ring
// and optional holes, each closed by repeating its first position.
type Polygon struct {
	Type        string        `json:"type"`
	Coordinates [][][]float64 `json:"coordinates"`
}

// Validate refuses what the sidecar would otherwise fail on only after a
// digital elevation model had been downloaded for it.
func (p Polygon) Validate() error {
	if p.Type != "Polygon" {
		return fmt.Errorf("the area must be a GeoJSON Polygon, got %q", p.Type)
	}
	if len(p.Coordinates) == 0 {
		return errors.New("the area has no outer ring")
	}
	for i, ring := range p.Coordinates {
		if len(ring) < 4 {
			return fmt.Errorf("ring %d has %d positions; a closed ring needs at least 4", i, len(ring))
		}
		for _, pos := range ring {
			if len(pos) < 2 || !isLonLat(pos[0], pos[1]) {
				return fmt.Errorf("ring %d has a position that is not a longitude and latitude", i)
			}
		}
		first, last := ring[0], ring[len(ring)-1]
		if first[0] != last[0] || first[1] != last[1] {
			return fmt.Errorf("ring %d is not closed", i)
		}
	}
	return nil
}

func isLonLat(lon, lat float64) bool {
	return !math.IsNaN(lon) && !math.IsNaN(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90
}

// SolarTerrainRequest asks for the plane-of-array irradiation over an area's
// terrain. Optional fields are pointers for the reason given on SolarRequest.
type SolarTerrainRequest struct {
	Area Polygon `json:"area"`
	// Default 10.
	HourlyYears *int `json:"hourly_years,omitempty"`
	// "annual" (default), "winter", "summer", "winter_crop", "anisotropy" for
	// the winter-over-summer ratio, or "shading" for the share of beam
	// irradiation the horizon blocks. The annual map averages a geometry that
	// reverses within the year, so the window is explicit.
	Season *string `json:"season,omitempty"`
}

// RenderScale is the colour domain a layer was drawn on. A client cannot infer
// it and must not guess: two layers drawn on different domains look comparable
// and are not.
type RenderScale struct {
	Palette string  `json:"palette"`
	Min     float64 `json:"min"`
	Max     float64 `json:"max"`
	// A value with an absolute meaning on this scale, if the quantity has one:
	// anisotropy has parity at 1.0, irradiation has none.
	Reference *float64 `json:"reference"`
	// "own", "shared" or "fixed": how the domain was chosen.
	Basis      string  `json:"basis"`
	SharedWith *string `json:"shared_with"`
	// Decimal places the quantity is meaningful to.
	Decimals int `json:"decimals"`
	// The palette's colour stops, low to high, as the sidecar drew them. The
	// legend is built from these, so it cannot drift from the raster; TERRA
	// kept a second copy of every palette in TypeScript.
	Stops []string `json:"stops"`
}

// SkyView is how much of the sky dome the terrain leaves visible, and the
// threshold that decided whether the diffuse loss was applied. Reported either
// way: "not applied" and "applied at zero" are different statements.
type SkyView struct {
	Applied            bool     `json:"applied"`
	MeanHorizonDeg     float64  `json:"mean_horizon_deg"`
	MaxHorizonDeg      float64  `json:"max_horizon_deg"`
	ThresholdDeg       float64  `json:"threshold_deg"`
	DiffuseLossMeanPct *float64 `json:"diffuse_loss_mean_pct"`
	DiffuseLossMaxPct  *float64 `json:"diffuse_loss_max_pct"`
}

// Distribution is how the cells of a layer are spread between its minimum and
// its maximum, in equal intervals: Edges has one more entry than Cells and its
// last is the layer's maximum. Its first is the layer's minimum unless a long
// low tail was set aside in Overflow, whose Below it then is.
type Distribution struct {
	Edges []float64 `json:"edges"`
	Cells []int     `json:"cells"`
	// Absent when the area of a cell is not known.
	AreaKm2  []float64             `json:"area_km2"`
	Overflow *DistributionOverflow `json:"overflow"`
}

// DistributionOverflow is the cells below the first interval, counted once: a
// tail too long and too thin for equal intervals to show beside the rest.
type DistributionOverflow struct {
	Below   float64  `json:"below"`
	Cells   int      `json:"cells"`
	AreaKm2 *float64 `json:"area_km2"`
}

// Bounds is a geographic extent in degrees.
type Bounds struct {
	LonMin float64 `json:"lon_min"`
	LatMin float64 `json:"lat_min"`
	LonMax float64 `json:"lon_max"`
	LatMax float64 `json:"lat_max"`
}

// SolarTerrainAnalysis is the plane-of-array irradiation over the area. The
// atmospheric resource has no structure at this scale; the irradiation reaching
// an inclined surface does, because the surface is terrain.
type SolarTerrainAnalysis struct {
	POAMin    float64 `json:"poa_min"`
	POAMax    float64 `json:"poa_max"`
	POAMean   float64 `json:"poa_mean"`
	POAStdPct float64 `json:"poa_std_pct"`
	// Absent from a result computed before the distribution was counted.
	Distribution *Distribution `json:"distribution,omitempty"`
	SlopeMeanDeg float64       `json:"slope_mean_deg"`
	SlopeMaxDeg  float64       `json:"slope_max_deg"`
	Pixels       int           `json:"pixels"`
	HourlyYears  int           `json:"hourly_years"`
	DEMSource    string        `json:"dem_source"`
	Season       string        `json:"season"`
	Unit         string        `json:"unit"`
	// Read this, not POAMin/POAMax, when building a legend: a seasonal layer
	// shares its domain with the other season and is narrower than it.
	Scale           RenderScale `json:"scale"`
	ShadingMeanPct  *float64    `json:"shading_mean_pct"`
	ShadingMaxPct   *float64    `json:"shading_max_pct"`
	HorizonMaxDistM float64     `json:"horizon_max_dist_m"`
	// Share of the horizontal irradiation carried by the beam, which is what
	// the shading loss is scaled by before it reaches the totals.
	BeamFraction float64  `json:"beam_fraction"`
	SkyView      *SkyView `json:"sky_view,omitempty"`
	// Where the webview loads the rendered layer from. Served out of this
	// session's results directory rather than sent as a base64 data URI,
	// which is where TERRA's bridge failed on large payloads.
	OverlayURL string `json:"overlay_url"`
	// Absolute path of the float32 GeoTIFF, for export.
	RasterTIF       string           `json:"raster_tif"`
	Extent          Bounds           `json:"extent"`
	PowerProvenance *PowerProvenance `json:"power_provenance,omitempty"`
}

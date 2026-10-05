package energy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/rexionmars/TerraEnergyEngine/internal/sidecar"
)

/*
The defaults the sidecar applies to a parameter the request omits.

The request types leave an unset field out so the sidecar picks the value (see
the package comment). The interface still has to show what that value is, and
it reads it from the sidecar's parameter_defaults action rather than from a copy
of the Python constants: a copy would go on displaying the old figure after the
constant changed, while every run silently applied the new one. The "Default"
notes on the request fields are documentation, not a source the interface reads.
*/

// SolarDefaults are the values solar_resource applies to an omitted field.
type SolarDefaults struct {
	ClimatologyYears int     `json:"climatology_years"`
	HourlyYears      int     `json:"hourly_years"`
	SurfaceAzimuth   float64 `json:"surface_azimuth"`
	// The reference ratio applied when the request carries none.
	PerformanceRatio float64 `json:"performance_ratio"`
}

// WindDefaults are the values wind_resource applies to an omitted field.
type WindDefaults struct {
	RecordYears      int       `json:"record_years"`
	HubHeightM       float64   `json:"hub_height_m"`
	CalmThresholdMS  float64   `json:"calm_threshold_ms"`
	RecordMaxFloorMS float64   `json:"record_max_floor_ms"`
	RoughnessBandM   []float64 `json:"roughness_band_m"`
}

// TerrainDefaults are the values solar_terrain applies to an omitted field,
// and every season it accepts, in the order the interface lists them.
type TerrainDefaults struct {
	HourlyYears int      `json:"hourly_years"`
	Season      string   `json:"season"`
	Seasons     []string `json:"seasons"`
}

// ConnectionDefaults are the values grid_congestion applies to an omitted field.
type ConnectionDefaults struct {
	SearchRadiusKM float64 `json:"search_radius_km"`
}

// DemandDefaults are the values demand_area applies to an omitted field. The
// ceiling is the product's own convention, applied when the request carries no
// yield read at the place itself.
type DemandDefaults struct {
	YieldCeilingKWhKWp float64 `json:"yield_ceiling_kwh_kwp"`
	CellKM             float64 `json:"cell_km"`
}

// GroundDefaults are the rules usable_ground applies when the request types none.
type GroundDefaults struct {
	SlopeMaxDeg float64 `json:"slope_max_deg"`
	HandMinM    float64 `json:"hand_min_m"`
}

// ParameterDefaults is the parameter_defaults reply.
type ParameterDefaults struct {
	Solar      SolarDefaults      `json:"solar"`
	Wind       WindDefaults       `json:"wind"`
	Terrain    TerrainDefaults    `json:"terrain"`
	Connection ConnectionDefaults `json:"connection"`
	Demand     DemandDefaults     `json:"demand"`
	Ground     GroundDefaults     `json:"ground"`
}

// FetchParameterDefaults runs the parameter_defaults action. It goes through
// Query, not Run, so it answers while an analysis is running.
func FetchParameterDefaults(ctx context.Context, r *sidecar.Runner) (*ParameterDefaults, error) {
	raw, err := r.Query(ctx, "parameter_defaults")
	if err != nil {
		return nil, err
	}
	return decodeParameterDefaults(raw)
}

// decodeParameterDefaults refuses a reply missing a section rather than
// returning its zero values, which the interface would show as defaults of 0
// years and 0 m.
func decodeParameterDefaults(raw []byte) (*ParameterDefaults, error) {
	var wrapped struct {
		Solar   *SolarDefaults   `json:"solar"`
		Wind    *WindDefaults    `json:"wind"`
		Terrain *TerrainDefaults `json:"terrain"`

		Connection *ConnectionDefaults `json:"connection"`
		Demand     *DemandDefaults     `json:"demand"`
		Ground     *GroundDefaults     `json:"ground"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("decode the parameter defaults: %w", err)
	}
	if wrapped.Solar == nil || wrapped.Wind == nil || wrapped.Terrain == nil || wrapped.Connection == nil ||
		wrapped.Demand == nil || wrapped.Ground == nil {
		return nil, errors.New("the sidecar returned incomplete parameter defaults")
	}
	if len(wrapped.Wind.RoughnessBandM) != 2 {
		return nil, fmt.Errorf("the default roughness band needs two lengths, got %d", len(wrapped.Wind.RoughnessBandM))
	}
	return &ParameterDefaults{Solar: *wrapped.Solar, Wind: *wrapped.Wind, Terrain: *wrapped.Terrain,
		Connection: *wrapped.Connection, Demand: *wrapped.Demand, Ground: *wrapped.Ground}, nil
}

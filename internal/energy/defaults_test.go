package energy

import (
	"reflect"
	"testing"
)

// A reply in the shape parameter_defaults writes, values included.
const defaultsReply = `{
	"solar": {"climatology_years": 30, "hourly_years": 10, "surface_azimuth": 0.0, "performance_ratio": 0.8},
	"wind": {"record_years": 10, "hub_height_m": 110.0, "calm_threshold_ms": 0.5, "record_max_floor_ms": 10.0, "roughness_band_m": [0.03, 0.1]},
	"terrain": {"hourly_years": 10, "season": "annual", "seasons": ["annual", "winter", "summer", "winter_crop", "anisotropy", "shading"]}
}`

func TestDecodeParameterDefaults(t *testing.T) {
	got, err := decodeParameterDefaults([]byte(defaultsReply))
	if err != nil {
		t.Fatal(err)
	}
	want := &ParameterDefaults{
		Solar: SolarDefaults{ClimatologyYears: 30, HourlyYears: 10, SurfaceAzimuth: 0, PerformanceRatio: 0.8},
		Wind: WindDefaults{RecordYears: 10, HubHeightM: 110, CalmThresholdMS: 0.5, RecordMaxFloorMS: 10,
			RoughnessBandM: []float64{0.03, 0.1}},
		Terrain: TerrainDefaults{HourlyYears: 10, Season: "annual",
			Seasons: []string{"annual", "winter", "summer", "winter_crop", "anisotropy", "shading"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

// A missing section must not reach the interface as a row of zero defaults.
func TestDecodeParameterDefaults_RefusesAnIncompleteReply(t *testing.T) {
	for name, raw := range map[string]string{
		"no terrain":    `{"solar": {}, "wind": {"roughness_band_m": [0.03, 0.1]}}`,
		"half a band":   `{"solar": {}, "wind": {"roughness_band_m": [0.03]}, "terrain": {}}`,
		"not an object": `[]`,
	} {
		if _, err := decodeParameterDefaults([]byte(raw)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

package energy

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"
)

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func ptr[T any](v T) *T { return &v }

func TestSolarPayload_OmitsUnsetFields(t *testing.T) {
	got := keys(solarPayload(SolarRequest{Lon: -48, Lat: -15}, "/cache"))
	want := []string{"action", "lat", "lon", "power_cache_dir"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("keys %v, want %v", got, want)
	}
}

// The defect this package exists to avoid: TERRA sent an unset field as zero.
// A zero the caller did set has to arrive as zero, not be dropped.
func TestSolarPayload_SendsAZeroTheCallerSet(t *testing.T) {
	p := solarPayload(SolarRequest{Lon: -48, Lat: -15, SurfaceAzimuth: ptr(0.0)}, "")
	v, ok := p["surface_azimuth"]
	if !ok || v != 0.0 {
		t.Fatalf("surface_azimuth = %v (present %v), want 0", v, ok)
	}
	if _, ok := p["power_cache_dir"]; ok {
		t.Fatal("an empty cache dir must be omitted, leaving the sidecar its fallback")
	}
}

func TestWindPayload_SendsTheBandOnlyWhole(t *testing.T) {
	if _, err := windPayload(WindRequest{RoughnessBandM: []float64{0.03}}, ""); err == nil {
		t.Fatal("a one-value roughness band was accepted")
	}
	p, err := windPayload(WindRequest{RoughnessBandM: []float64{0.03, 0.1}, CalmThresholdMS: ptr(0.0)}, "")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(p["roughness_band_m"], []float64{0.03, 0.1}) {
		t.Fatalf("band %v", p["roughness_band_m"])
	}
	if p["calm_threshold_ms"] != 0.0 {
		t.Fatalf("calm threshold %v, want the zero that was set", p["calm_threshold_ms"])
	}
}

// A null the sidecar sends for a quantity with no answer must stay null, not
// become a measured zero.
func TestWindAnalysis_KeepsANullRoughness(t *testing.T) {
	var w WindAnalysis
	raw := `{"data_quality": {"shear": {"implied_roughness_length_m": null}}}`
	if err := json.Unmarshal([]byte(raw), &w); err != nil {
		t.Fatal(err)
	}
	if w.DataQuality.Shear.ImpliedRoughnessLengthM != nil {
		t.Fatal("null roughness decoded as a value")
	}
}

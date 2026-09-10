/*
Package energy runs the energy products in the sidecar and decodes their results.

The computation is in Python, in sidecar/terra_energy_engine/energy. This
package owns what each action is sent and the shape of what comes back, and it
sends only the fields the caller set: a field left unset is omitted, so the
sidecar applies its own default, and a zero the caller set arrives as zero.
*/
package energy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/rexionmars/TerraEnergyEngine/internal/sidecar"
)

func solarPayload(req SolarRequest, cacheDir string) map[string]any {
	p := map[string]any{"action": "solar_resource", "lon": req.Lon, "lat": req.Lat}
	if cacheDir != "" {
		p["power_cache_dir"] = cacheDir
	}
	if req.ClimatologyYears != nil {
		p["climatology_years"] = *req.ClimatologyYears
	}
	if req.HourlyYears != nil {
		p["hourly_years"] = *req.HourlyYears
	}
	if req.SurfaceAzimuth != nil {
		p["surface_azimuth"] = *req.SurfaceAzimuth
	}
	if req.PerformanceRatio != nil {
		p["performance_ratio"] = *req.PerformanceRatio
	}
	return p
}

func windPayload(req WindRequest, cacheDir string) (map[string]any, error) {
	p := map[string]any{"action": "wind_resource", "lon": req.Lon, "lat": req.Lat}
	if cacheDir != "" {
		p["power_cache_dir"] = cacheDir
	}
	if req.RecordYears != nil {
		p["record_years"] = *req.RecordYears
	}
	if req.HubHeightM != nil {
		p["hub_height_m"] = *req.HubHeightM
	}
	if req.CalmThresholdMS != nil {
		p["calm_threshold_ms"] = *req.CalmThresholdMS
	}
	if req.RecordMaxFloorMS != nil {
		p["record_max_floor_ms"] = *req.RecordMaxFloorMS
	}
	switch len(req.RoughnessBandM) {
	case 0:
	case 2:
		p["roughness_band_m"] = req.RoughnessBandM
	default:
		// Refused here rather than dropped: TERRA's runner sent the band only
		// when it had two values, so a malformed band silently became the
		// default band and the response described an assumption nobody made.
		return nil, fmt.Errorf("the roughness band needs two lengths, got %d", len(req.RoughnessBandM))
	}
	return p, nil
}

// AnalyzeSolar runs the solar_resource action.
func AnalyzeSolar(ctx context.Context, r *sidecar.Runner, req SolarRequest, cacheDir string, onProgress func(sidecar.Progress)) (*SolarAnalysis, error) {
	raw, err := r.Run(ctx, solarPayload(req, cacheDir), onProgress)
	if err != nil {
		return nil, err
	}
	var wrapped struct {
		Solar *SolarAnalysis `json:"solar"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("decode the solar result: %w", err)
	}
	if wrapped.Solar == nil {
		return nil, errors.New("the sidecar returned no solar result")
	}
	return wrapped.Solar, nil
}

// AnalyzeWind runs the wind_resource action.
func AnalyzeWind(ctx context.Context, r *sidecar.Runner, req WindRequest, cacheDir string, onProgress func(sidecar.Progress)) (*WindAnalysis, error) {
	payload, err := windPayload(req, cacheDir)
	if err != nil {
		return nil, err
	}
	raw, err := r.Run(ctx, payload, onProgress)
	if err != nil {
		return nil, err
	}
	// The payload key is "wind", not "wind_resource": the action names the
	// question, the key names the result.
	var wrapped struct {
		Wind *WindAnalysis `json:"wind"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("decode the wind result: %w", err)
	}
	if wrapped.Wind == nil {
		return nil, errors.New("the sidecar returned no wind result")
	}
	return wrapped.Wind, nil
}

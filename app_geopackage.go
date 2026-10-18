package main

import (
	"context"
	"encoding/json"
	"time"
)

type GeoPackageLayer struct {
	Style    map[string]any `json:"style,omitempty"`
	Name     string         `json:"name"`
	Label    string         `json:"label"`
	Geometry string         `json:"geometry"`
	Count    int64          `json:"count"`
	BBox     []float64      `json:"bbox"`
	Error    *string        `json:"error"`
}

type GeoPackageCatalog struct {
	Path   string            `json:"path"`
	Name   string            `json:"name"`
	Layers []GeoPackageLayer `json:"layers"`
}

type GeoPackagePreview struct {
	GeoJSON map[string]any `json:"geojson"`
	Limited bool           `json:"limited"`
	Skipped int            `json:"skipped"`
	Indexed bool           `json:"indexed"`
}

// InspectGeoPackage lists a source's layers when restoring a project reference.
func (a *App) InspectGeoPackage(path string) (*GeoPackageCatalog, error) {
	out, err := a.readGeoPackage(map[string]any{"action": "gpkg_inspect", "path": path})
	if err != nil {
		return nil, err
	}
	var result GeoPackageCatalog
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GeoPackageFeatures reads a bounded preview of one layer in the visible map extent.
func (a *App) GeoPackageFeatures(path, layer string, bbox []float64) (*GeoPackagePreview, error) {
	out, err := a.readGeoPackage(map[string]any{"action": "gpkg_features", "path": path, "layer": layer, "bbox": bbox})
	if err != nil {
		return nil, err
	}
	var result GeoPackagePreview
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (a *App) readGeoPackage(req map[string]any) (json.RawMessage, error) {
	r, err := a.analysisRunner()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 45*time.Second)
	defer cancel()
	// Read is independent of the analysis slot: panning a reference layer must
	// neither cancel an energy analysis nor occupy its progress channel.
	return r.Read(ctx, req)
}

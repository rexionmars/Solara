package main

import (
	"context"
	"encoding/json"
	"time"
)

// GeoPackageField is one attribute column and the type it declares: integer,
// real, text, boolean, date, datetime or blob. Title is the alias recorded in
// gpkg_data_columns, when there is one.
type GeoPackageField struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Title string `json:"title,omitempty"`
}

type GeoPackageLayer struct {
	Style    map[string]any    `json:"style,omitempty"`
	Name     string            `json:"name"`
	Label    string            `json:"label"`
	Geometry string            `json:"geometry"`
	Count    int64             `json:"count"`
	BBox     []float64         `json:"bbox"`
	Error    *string           `json:"error"`
	Fields   []GeoPackageField `json:"fields"`
	PK       *string           `json:"pk"`
}

type GeoPackageCatalog struct {
	Path   string            `json:"path"`
	Name   string            `json:"name"`
	Layers []GeoPackageLayer `json:"layers"`
}

// GeoPackageCells counts a crowded view per Web Mercator cell: Items holds
// [x, y, count, lon, lat] for each cell of tile zoom Zoom, placed at the mean
// of its features.
type GeoPackageCells struct {
	Zoom  int         `json:"zoom"`
	Items [][]float64 `json:"items"`
}

type GeoPackagePreview struct {
	GeoJSON map[string]any   `json:"geojson"`
	Cells   *GeoPackageCells `json:"cells,omitempty"`
	InView  int64            `json:"in_view,omitempty"`
	Limited bool             `json:"limited"`
	Skipped int              `json:"skipped"`
	Indexed bool             `json:"indexed"`
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

// GeoPackageFeatures reads a bounded preview of one layer in the visible map
// extent, carrying only the attributes named in fields and the primary key.
// Past 5,000 features in view, an indexed layer comes back counted per cell
// at the map's zoom instead.
func (a *App) GeoPackageFeatures(path, layer string, bbox []float64, fields []string, zoom float64) (*GeoPackagePreview, error) {
	if fields == nil {
		fields = []string{}
	}
	out, err := a.readGeoPackage(map[string]any{"action": "gpkg_features", "path": path, "layer": layer, "bbox": bbox, "fields": fields, "zoom": zoom})
	if err != nil {
		return nil, err
	}
	var result GeoPackagePreview
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GeoPackageFeature reads one feature whole, by its primary key: every
// attribute uncut and the geometry neither clipped nor simplified.
func (a *App) GeoPackageFeature(path, layer string, fid int64) (map[string]any, error) {
	out, err := a.readGeoPackage(map[string]any{"action": "gpkg_feature", "path": path, "layer": layer, "fid": fid})
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, err
	}
	return result, nil
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

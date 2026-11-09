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

// GeoPackageKind is one kind of geometry a layer's features hold, as the WKB
// names it ("Point", "MultiPolygon"), or "Null", "Empty" or "Unreadable".
type GeoPackageKind struct {
	Kind  string `json:"kind"`
	Count int64  `json:"count"`
}

type GeoPackageLayer struct {
	Style    map[string]any `json:"style,omitempty"`
	Name     string         `json:"name"`
	Label    string         `json:"label"`
	Geometry string         `json:"geometry"`
	// What the features hold, read when Geometry is a generic declaration
	// (GEOMETRY) that permits any kind; null otherwise, or when the catalogue
	// ran out of time to read it.
	Kinds  []GeoPackageKind  `json:"kinds"`
	Count  int64             `json:"count"`
	BBox   []float64         `json:"bbox"`
	Error  *string           `json:"error"`
	Fields []GeoPackageField `json:"fields"`
	PK     *string           `json:"pk"`
}

// GeoPackageCount is a value and how many features hold it: an attribute's
// value, or a key of a column of JSON objects.
type GeoPackageCount struct {
	Value any   `json:"value"`
	Count int64 `json:"count"`
}

// GeoPackageRange is the least, greatest, mean and median of a number column
// (the lower middle value when the count is even), or the earliest and latest
// of a date column, which has neither.
type GeoPackageRange struct {
	Min    any `json:"min"`
	Max    any `json:"max"`
	Mean   any `json:"mean,omitempty"`
	Median any `json:"median,omitempty"`
}

/*
GeoPackageFieldProfile is what one attribute holds, counted over every feature.

Role is read off the values, never the name: empty, constant, identifier
(every value its own), category, number, date, text, json (an object per
feature, listed by Keys) or binary. It is absent when the profile ran out of
time before this column. Mismatched counts values whose storage disagrees with
the declared number type, such as text in a REAL column.
*/
type GeoPackageFieldProfile struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Title    string `json:"title,omitempty"`
	Filled   int64  `json:"filled"`
	Role     string `json:"role,omitempty"`
	Distinct *int64 `json:"distinct,omitempty"`
	// Distinct is a floor: a number column past a thousand values is not counted further.
	DistinctCapped bool              `json:"distinct_capped,omitempty"`
	Mismatched     int64             `json:"mismatched,omitempty"`
	Top            []GeoPackageCount `json:"top,omitempty"`
	Keys           []GeoPackageCount `json:"keys,omitempty"`
	KeyCount       int64             `json:"key_count,omitempty"`
	Range          *GeoPackageRange  `json:"range,omitempty"`
	// Features per equal-width bin between Range.Min and Range.Max.
	Histogram []int64 `json:"histogram,omitempty"`
}

type GeoPackageGeometryProfile struct {
	Declared string           `json:"declared"`
	Kinds    []GeoPackageKind `json:"kinds"`
}

// GeoPackageProfile is one layer read in full. Incomplete names the columns,
// and the geometry column, the time did not allow; nothing is estimated.
type GeoPackageProfile struct {
	Name       string                    `json:"name"`
	Count      int64                     `json:"count"`
	PK         *string                   `json:"pk"`
	Geometry   GeoPackageGeometryProfile `json:"geometry"`
	Fields     []GeoPackageFieldProfile  `json:"fields"`
	Incomplete []string                  `json:"incomplete"`
	Seconds    float64                   `json:"seconds"`
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

// ProfileGeoPackageLayer reads one layer in full: the kinds of geometry its
// features hold and what each attribute is filled with. A layer of a million
// features takes some seconds; it runs beside an analysis, as map reads do.
func (a *App) ProfileGeoPackageLayer(path, layer string) (*GeoPackageProfile, error) {
	out, err := a.readGeoPackage(map[string]any{"action": "gpkg_profile", "path": path, "layer": layer})
	if err != nil {
		return nil, err
	}
	var result GeoPackageProfile
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

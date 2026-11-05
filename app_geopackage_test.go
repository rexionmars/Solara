package main

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/rexionmars/TerraEnergyEngine/internal/sidecar"
)

func TestOpenProject_GeoPackageCatalogWithoutChangingSource(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Infrastructure.GPKG")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
		pragma application_id = 1196444487;
		create table gpkg_contents (table_name text, identifier text, data_type text, min_x real, min_y real, max_x real, max_y real);
		create table gpkg_geometry_columns (table_name text, column_name text, geometry_type_name text, srs_id integer);
		create table gpkg_spatial_ref_sys (srs_id integer, organization text, organization_coordsys_id integer, definition text);
		create table assets (fid integer primary key, geom blob, name text);
		insert into gpkg_contents values ('assets', 'Assets', 'features', -39, -5, -38, -4);
		insert into gpkg_geometry_columns values ('assets', 'geom', 'POINT', 4326);
		insert into gpkg_spatial_ref_sys values (4326, 'EPSG', 4326, '');
		insert into assets (geom, name) values (X'47500001E6100000010100000000000000000043C000000000000010C0', 'Substation');
	`)
	if err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	runner, err := sidecar.NewRunner()
	if err != nil {
		t.Fatal(err)
	}
	a := &App{ctx: context.Background(), runner: runner, resultsDir: t.TempDir()}
	opened, err := a.OpenProject(path)
	if err != nil {
		t.Fatal(err)
	}
	if opened.GeoPackage == nil || len(opened.GeoPackage.Layers) != 1 {
		t.Fatalf("missing GeoPackage catalog: %+v", opened)
	}
	if opened.Content != "" || len(opened.RunDirs) != 0 {
		t.Fatal("GeoPackage was treated as a JSON project or restored raster runs")
	}
	layer := opened.GeoPackage.Layers[0]
	if layer.Count != 1 || layer.Name != "assets" {
		t.Fatalf("wrong catalog: %+v", opened.GeoPackage)
	}
	if layer.PK == nil || *layer.PK != "fid" || len(layer.Fields) != 2 || layer.Fields[1] != (GeoPackageField{Name: "name", Type: "text"}) {
		t.Fatalf("wrong schema: pk %v, fields %+v", layer.PK, layer.Fields)
	}
	if layer.Kinds != nil {
		t.Fatalf("a declared POINT layer was read for its kinds: %+v", layer.Kinds)
	}
	profile, err := a.ProfileGeoPackageLayer(path, "assets")
	if err != nil {
		t.Fatal(err)
	}
	if profile.Count != 1 || len(profile.Geometry.Kinds) != 1 || profile.Geometry.Kinds[0] != (GeoPackageKind{Kind: "Point", Count: 1}) {
		t.Fatalf("wrong geometry profile: %+v", profile)
	}
	if len(profile.Fields) != 1 || profile.Fields[0].Role != "constant" || profile.Fields[0].Filled != 1 ||
		len(profile.Fields[0].Top) != 1 || profile.Fields[0].Top[0].Value != "Substation" {
		t.Fatalf("wrong field profile: %+v", profile.Fields)
	}
	feature, err := a.GeoPackageFeature(path, "assets", 1)
	if err != nil {
		t.Fatal(err)
	}
	if props, _ := feature["properties"].(map[string]any); props["name"] != "Substation" || feature["geometry"] == nil {
		t.Fatalf("wrong feature: %+v", feature)
	}

	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("opening modified the source GeoPackage")
	}
}

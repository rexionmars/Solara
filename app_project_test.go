package main

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// writeRun creates a run directory in root holding the given files, which may
// sit in subdirectories.
func writeRun(t *testing.T, root, id string, files map[string]string) {
	t.Helper()
	for name, body := range files {
		p := filepath.Join(root, id, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// dirNames lists the subdirectories of dir, sorted.
func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

func TestSaveProject_CopiesTheRunsAndPrunesTheOthers(t *testing.T) {
	results := t.TempDir()
	writeRun(t, results, "run1", map[string]string{"solar_poa.png": "png", "nested/solar_poa.tif": "tif"})
	writeRun(t, results, "run2", map[string]string{"solar_poa.png": "png2"})
	a := &App{resultsDir: results}
	path := filepath.Join(t.TempDir(), "Site.solara")

	got, err := a.saveProjectTo(path, `{"v":1}`, []string{"run1", "run2", "run1"})
	if err != nil {
		t.Fatal(err)
	}
	if got != path || readFile(t, path) != `{"v":1}` {
		t.Fatalf("saved to %s with %q", got, readFile(t, got))
	}
	data := filepath.Join(filepath.Dir(path), "Site.solara-data")
	if names := dirNames(t, data); !reflect.DeepEqual(names, []string{"run1", "run2"}) {
		t.Fatalf("data folder holds %v", names)
	}
	if readFile(t, filepath.Join(data, "run1", "nested", "solar_poa.tif")) != "tif" {
		t.Fatal("a nested file was not copied")
	}

	// Saved again naming one run: the other goes, and the document is replaced.
	if _, err := a.saveProjectTo(path, `{"v":2}`, []string{"run2"}); err != nil {
		t.Fatal(err)
	}
	if names := dirNames(t, data); !reflect.DeepEqual(names, []string{"run2"}) {
		t.Fatalf("after pruning the data folder holds %v", names)
	}
	if readFile(t, path) != `{"v":2}` {
		t.Fatal("the document was not replaced")
	}
	// No staging file or directory is left beside the project.
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("the project directory holds %d entries, want the file and its data folder", len(entries))
	}

	// Saved naming no run: the data folder goes.
	if _, err := a.saveProjectTo(path, `{"v":3}`, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(data); !os.IsNotExist(err) {
		t.Fatalf("the data folder of a project with no runs survived: %v", err)
	}
}

func TestSaveProject_AddsTheExtension(t *testing.T) {
	a := &App{resultsDir: t.TempDir()}
	dir := t.TempDir()
	got, err := a.saveProjectTo(filepath.Join(dir, "Site"), "{}", nil)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(dir, "Site.solara"); got != want {
		t.Fatalf("saved to %s, want %s", got, want)
	}
	// A name that has the extension in another case keeps it.
	got, err = a.saveProjectTo(filepath.Join(dir, "Other.SOLARA"), "{}", nil)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(got) != "Other.SOLARA" {
		t.Fatalf("saved as %s", filepath.Base(got))
	}
}

// Only a .solara file opens; .terra is TERRA's.
func TestOpenProject_RefusesAnotherExtension(t *testing.T) {
	a := &App{resultsDir: t.TempDir()}
	for _, name := range []string{"Site.terra", "Site.json", "Site"} {
		path := filepath.Join(t.TempDir(), name)
		if err := os.WriteFile(path, []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := a.openProjectFrom(path); err == nil {
			t.Fatalf("%s was opened", name)
		}
	}
}

// A run the session no longer holds is kept from the data folder; one found in
// neither place is an error, and the document is not written over.
func TestSaveProject_KeepsARunOnlyTheDataFolderHolds(t *testing.T) {
	a := &App{resultsDir: t.TempDir()}
	path := filepath.Join(t.TempDir(), "Site.solara")
	data := filepath.Join(filepath.Dir(path), "Site.solara-data")
	writeRun(t, data, "old", map[string]string{"layer.png": "kept"})

	if _, err := a.saveProjectTo(path, "{}", []string{"old"}); err != nil {
		t.Fatal(err)
	}
	if readFile(t, filepath.Join(data, "old", "layer.png")) != "kept" {
		t.Fatal("the run in the data folder was not kept")
	}

	if _, err := a.saveProjectTo(path, "changed", []string{"old", "missing"}); err == nil {
		t.Fatal("a run in neither place was accepted")
	}
	if readFile(t, path) != "{}" {
		t.Fatal("a failed save replaced the document")
	}
}

func TestSaveProject_RefusesUnsafeRunIDs(t *testing.T) {
	results := t.TempDir()
	a := &App{resultsDir: results}
	path := filepath.Join(t.TempDir(), "Site.solara")
	for _, id := range []string{"", ".", "..", "../run", `a\b`, "a/b", ".hidden"} {
		if _, err := a.saveProjectTo(path, "{}", []string{id}); err == nil {
			t.Errorf("run id %q was accepted", id)
		}
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("a refused save wrote the document")
	}
}

func TestOpenProject_RestoresTheRunsIntoAFreshSession(t *testing.T) {
	first := &App{resultsDir: t.TempDir()}
	writeRun(t, first.resultsDir, "run1", map[string]string{"solar_poa.png": "png", "nested/solar_poa.tif": "tif"})
	path, err := first.saveProjectTo(filepath.Join(t.TempDir(), "Site"), `{"doc":true}`, []string{"run1"})
	if err != nil {
		t.Fatal(err)
	}
	// Something in the data folder that is not a run.
	data := filepath.Join(filepath.Dir(path), "Site.solara-data")
	if err := os.WriteFile(filepath.Join(data, "notes.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeRun(t, data, ".run9.partial-123", map[string]string{"half.png": "x"})

	second := &App{resultsDir: t.TempDir()}
	// A run the session already holds is not overwritten.
	writeRun(t, second.resultsDir, "run2", map[string]string{"layer.png": "session"})
	writeRun(t, data, "run2", map[string]string{"layer.png": "project"})

	opened, err := second.openProjectFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Path != path || opened.Content != `{"doc":true}` {
		t.Fatalf("opened %s with %q", opened.Path, opened.Content)
	}
	want := map[string]string{
		"run1": filepath.Join(second.resultsDir, "run1"),
		"run2": filepath.Join(second.resultsDir, "run2"),
	}
	if !reflect.DeepEqual(opened.RunDirs, want) {
		t.Fatalf("run dirs %v, want %v", opened.RunDirs, want)
	}
	if readFile(t, filepath.Join(second.resultsDir, "run1", "nested", "solar_poa.tif")) != "tif" {
		t.Fatal("the run was not restored")
	}
	if readFile(t, filepath.Join(second.resultsDir, "run2", "layer.png")) != "session" {
		t.Fatal("a run the session held was overwritten")
	}
	if names := dirNames(t, second.resultsDir); !reflect.DeepEqual(names, []string{"run1", "run2"}) {
		t.Fatalf("the results directory holds %v", names)
	}
}

func TestOpenProject_WithoutADataFolder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Bare.solara")
	if err := os.WriteFile(path, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	opened, err := (&App{resultsDir: t.TempDir()}).openProjectFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	// Empty, not nil: nil reaches the interface as null, not as {}.
	if opened.RunDirs == nil || len(opened.RunDirs) != 0 {
		t.Fatalf("run dirs %#v", opened.RunDirs)
	}
}

func TestExportInside_CopiesAResultFile(t *testing.T) {
	root := t.TempDir()
	writeRun(t, root, "run1", map[string]string{"solar_poa.tif": "tif"})
	dest := filepath.Join(t.TempDir(), "export.tif")
	if err := exportInside(root, filepath.Join(root, "run1", "solar_poa.tif"), dest); err != nil {
		t.Fatal(err)
	}
	if readFile(t, dest) != "tif" {
		t.Fatal("the export does not hold the result")
	}
}

func TestExportInside_RefusesAPathOutsideTheResults(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "results")
	writeRun(t, root, "run1", map[string]string{"solar_poa.tif": "tif"})
	secret := filepath.Join(parent, "secret.txt")
	if err := os.WriteFile(secret, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A sibling whose name starts with the root's must not pass a prefix test.
	writeRun(t, parent, "results-other", map[string]string{"x.tif": "x"})
	dest := filepath.Join(t.TempDir(), "out")
	for _, src := range []string{
		secret,
		filepath.Join(root, "..", "secret.txt"),
		filepath.Join(root, "run1", "..", "..", "secret.txt"),
		filepath.Join(parent, "results-other", "x.tif"),
		root,
		filepath.Join(root, "run1"),
	} {
		if err := exportInside(root, src, dest); err == nil {
			t.Errorf("%s was exported", src)
		}
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("a refused export wrote the destination")
	}
}

func TestFilterFor(t *testing.T) {
	f := filterFor("Site solar.TIF")
	if len(f) != 1 || f[0].DisplayName != "GeoTIFF (*.tif)" || f[0].Pattern != "*.tif" {
		t.Fatalf("filter %+v", f)
	}
	if f := filterFor("README"); f != nil {
		t.Fatalf("a name without an extension got %+v", f)
	}
}

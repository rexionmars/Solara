package sidecar

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestBundledEngineResolution(t *testing.T) {
	for _, layout := range []string{"adjacent", "resources"} {
		t.Run(layout, func(t *testing.T) {
			if layout == "resources" && runtime.GOOS != "darwin" {
				t.Skip("macOS bundle layout")
			}
			root := t.TempDir()
			executable := filepath.Join(root, "Solara")
			engineDir := filepath.Join(root, "engine")
			if layout == "resources" {
				executable = filepath.Join(root, "Contents", "MacOS", "Solara")
				engineDir = filepath.Join(root, "Contents", "Resources", "engine")
			}
			name := "solara-engine"
			if runtime.GOOS == "windows" {
				name += ".exe"
			}
			if err := os.MkdirAll(engineDir, 0755); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(engineDir, name)
			if err := os.WriteFile(path, []byte("fixture"), 0755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("TERRA_ENERGY_APP_DIR", "")
			t.Setenv("TERRA_ENERGY_PYTHON", "")
			runner, err := newRunner(executable)
			if err != nil {
				t.Fatal(err)
			}
			if filepath.Clean(runner.Python()) != path || runner.script != "" {
				t.Fatalf("unexpected runner: %#v", runner)
			}
			t.Setenv("TERRA_ENERGY_APP_DIR", filepath.Join(root, "missing-source"))
			if _, err := newRunner(executable); err == nil {
				t.Fatal("explicit source override must not silently use bundle")
			}
		})
	}
}

package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func resultsApp(t *testing.T) (*App, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "run1"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "run1", "layer.png"), []byte("png"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A file outside every run directory, which no URL may reach.
	if err := os.WriteFile(filepath.Join(filepath.Dir(root), "secret.txt"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(filepath.Join(filepath.Dir(root), "secret.txt")) })
	return &App{resultsDir: root}, root
}

func serve(a *App, method, path string) *httptest.ResponseRecorder {
	fallthroughHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})
	rec := httptest.NewRecorder()
	a.resultsMiddleware(fallthroughHandler).ServeHTTP(rec, httptest.NewRequest(method, "http://wails.localhost"+path, nil))
	return rec
}

func TestResultsMiddleware_ServesARunFile(t *testing.T) {
	a, _ := resultsApp(t)
	rec := serve(a, http.MethodGet, "/results/run1/layer.png")
	if rec.Code != http.StatusOK || rec.Body.String() != "png" {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestResultsMiddleware_LeavesOtherPathsToTheFrontend(t *testing.T) {
	a, _ := resultsApp(t)
	if rec := serve(a, http.MethodGet, "/index.html"); rec.Code != http.StatusTeapot {
		t.Fatalf("a frontend path was not passed on: %d", rec.Code)
	}
}

func TestResultsMiddleware_RefusesPathsOutOfARunDirectory(t *testing.T) {
	a, _ := resultsApp(t)
	for _, path := range []string{
		"/results/../secret.txt",
		"/results/run1/../../secret.txt",
		"/results/%2e%2e/secret.txt",
		"/results/run1",
		"/results/run1/",
		"/results/run1/a/b",
		`/results/run1\..\..\secret.txt`,
	} {
		rec := serve(a, http.MethodGet, path)
		if rec.Code == http.StatusOK {
			t.Errorf("%s served %q", path, rec.Body.String())
		}
	}
	if rec := serve(a, http.MethodPost, "/results/run1/layer.png"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST answered %d", rec.Code)
	}
}

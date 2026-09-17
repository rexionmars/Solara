package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

/*
The results directory: where the analyses write their rasters, and the route
the webview loads them from.

Each run writes into its own subdirectory of a directory created for this
session and removed at shutdown. The webview fetches a rendered layer by URL,
through resultsMiddleware, instead of receiving it through a bound method.
Everything a bound method returns is marshalled to JSON and handed to the
webview as one string, so a raster there has to be base64; TERRA sent its
layers that way and its bridge failed on the large ones.
*/

// resultsRoute is the URL prefix of the results directory.
const resultsRoute = "/results/"

// newResultsDir creates this session's results directory.
func newResultsDir() (string, error) {
	return os.MkdirTemp("", "terra-energy-results-")
}

// newRunDir creates a subdirectory for one run and returns it with its id.
func (a *App) newRunDir() (dir, id string, err error) {
	if a.resultsDir == "" {
		return "", "", errors.New("no results directory: " + errString(a.resultsErr))
	}
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	id = hex.EncodeToString(b)
	dir = filepath.Join(a.resultsDir, id)
	if err := os.Mkdir(dir, 0o700); err != nil {
		return "", "", err
	}
	return dir, id, nil
}

func errString(err error) string {
	if err == nil {
		return "unknown reason"
	}
	return err.Error()
}

// resultURL is the URL a file in a run's directory is served at.
func resultURL(runID, file string) string {
	return resultsRoute + runID + "/" + file
}

// safeSegment reports whether s can name a run directory or a file in one:
// never empty, never a dot segment, never containing a separator.
func safeSegment(s string) bool {
	return s != "" && s != "." && s != ".." && !strings.ContainsAny(s, `/\`)
}

/*
resultsMiddleware serves GET /results/<run>/<file> from the results directory
and hands every other request to the embedded frontend.

The path is taken apart into exactly two segments and each is checked on its
own, rather than joined and then checked, so no request can name a file
outside a run directory. Middleware rather than an AssetServer Handler: the
handler is reached only when the assets report a miss, and the single-page
frontend answers an unknown path with index.html instead.
*/
func (a *App) resultsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel, ok := strings.CutPrefix(r.URL.Path, resultsRoute)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		parts := strings.Split(rel, "/")
		if a.resultsDir == "" || len(parts) != 2 || !safeSegment(parts[0]) || !safeSegment(parts[1]) {
			http.NotFound(w, r)
			return
		}
		// A run's files do not change once written, but a run id is reused
		// by nothing, so there is no benefit in caching across runs either.
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, filepath.Join(a.resultsDir, parts[0], parts[1]))
	})
}

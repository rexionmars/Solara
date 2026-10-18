# Releases

Download the archive for your platform from [GitHub Releases](https://github.com/rexionmars/Solara/releases).
Extract the complete archive before opening the app. The calculation engine, Python
3.12 and its scientific/geospatial dependencies are included. No Python installation
or checkout is required. The `engine` directory must stay beside the Windows/Linux
executable; on macOS it is inside `Solara.app`.

| Download | Platform |
|---|---|
| `darwin-arm64.zip` | macOS 15+ on Apple Silicon |
| `darwin-amd64.zip` | macOS 15+ on Intel |
| `windows-amd64.zip` | Windows 10/11 x64, with Microsoft WebView2 Runtime |
| `linux-amd64.tar.gz` | Ubuntu 24.04+ x64, with GTK 3 and WebKitGTK 4.1 |

On Linux, install `libgtk-3-0` and `libwebkit2gtk-4.1-0` with your package manager.
On Windows, install Microsoft's WebView2 Evergreen Runtime if it is absent.
macOS packages are ad-hoc signed, without Apple notarization. Windows packages
are not Authenticode signed. Developer signing certificates are not configured.

Public data still needs Internet access. Grid analyses still require a separately
configured PostgreSQL/PostGIS store and its datasets; those are not distributed.
The `contract` directory describes the database interface. Planning and local
GeoPackage reads do not require that store.

Each archive has a `.sha256` file; `SHA256SUMS.txt` lists all archives. Verify a
Linux/macOS download with `shasum -a 256 <archive>` and compare the published hash.
On Windows, use PowerShell `Get-FileHash <archive> -Algorithm SHA256`.
Per-platform `dependencies.txt` assets record the Python versions used in that build.

## Maintainer workflow

The **Desktop releases** GitHub Actions workflow builds all four native targets.
Changes to packaging open a build on PRs. **Run workflow** performs the same build
and uploads Actions artifacts without publishing a release or creating a tag.

To publish, first merge and test the intended code on `master`, then create and
push an annotated SemVer tag from that commit:

```sh
git switch master
git pull --ff-only
git tag -a v0.1.0 -m 'Solara 0.1.0'
git push origin v0.1.0
```

Replace the example version with the intended unused version. Tags with a
prerelease suffix, such as `v0.2.0-rc.1`, publish a GitHub prerelease and do not
replace the latest stable release. The workflow rejects malformed versions and
tagged commits outside `master`. It stamps the application version from the tag
and uses the numeric part for native bundle metadata, without committing generated
version changes back to the repository.

Publication waits for every platform to pass tests and a relocated frozen-engine
smoke test, including importing every registered action and solving the synthetic
PyPSA study with HiGHS. Assets are uploaded to a draft before publication, so a
failed matrix cannot publish a partial release. A failed upload can be rerun while
the release is a draft. Published releases are never overwritten: fix the code and
publish a new version. No signing secrets are required for this initial pipeline.

## Local packaging

Use the native OS and architecture you want to distribute. Install the Wails
2.13.0 CLI, the Go version in `go.mod`, Node 22 and Python 3.12, plus the
[Wails platform build dependencies](https://wails.io/docs/gettingstarted/installation/).
In an isolated Python environment, install `requirements-release.txt` and pytest.
Then use the build steps in `.github/workflows/release.yml`. The final package
command requires the built desktop app in `build/bin` and the frozen engine in
`build/engine/solara-engine`. It assembles, archives, extracts and tests the
package, writing distributable assets under `build/release/assets`.

Source-based development and the existing `TERRA_ENERGY_APP_DIR` and
`TERRA_ENERGY_PYTHON` overrides continue to work. Without overrides a packaged app
always chooses its bundled engine, even when launched from a source checkout.

"""
Copy the drawings the interface uses out of KDE's Breeze icon theme into
public/icons/breeze, under the names lib/art.ts asks for.

    python3 frontend/scripts/breeze_icons.py <a checkout of github.com/KDE/breeze-icons>

Breeze is LGPL-3.0-or-later (COPYING-ICONS, copied beside the drawings). Two
things are changed on the way, and the README written beside them says so:

  - A drawing of one ink is Breeze's dark text colour, #232629, which is for a
    light window. It is rewritten to this interface's own text colour, since a
    picture in an <img> cannot take the colour of the text around it.
  - A drawing with a size and no viewBox is given one, so that it scales.

A checkout made with --filter=blob:none --no-checkout is enough: each file is
asked of git by name.
"""
import posixpath
import re
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "icons" / "breeze"

# The interface's --p-text (index.css).
INK = "#dddddd"
BREEZE_INK = "#232629"
# Where Breeze keeps drawings of one ink; everything else is in colour and is left as it is.
ONE_INK = ("icons/actions/", "icons/devices/22/", "icons/places/22/", "icons/status/22/")

# What each drawing means here -> the Breeze icon that says it.
ICONS = {
    "about": "actions/22/help-about",
    "account": "actions/22/user-identity",
    "adjust": "actions/22/configure",
    "area": "actions/22/map-flat",
    "basemap": "categories/32/applications-internet",
    "cancel": "actions/22/dialog-cancel",
    "check": "actions/22/dialog-ok-apply",
    "connection": "actions/22/network-connect",
    "coordinates": "actions/22/crosshairs",
    "csv": "mimetypes/32/text-csv",
    "data": "actions/22/table",
    "delete": "actions/22/edit-delete",
    "demand": "apps/48/utilities-energy-monitor",
    "export": "actions/22/document-export",
    "folder": "places/32/folder",
    "folder-open": "places/32/folder-open",
    "frame-all": "actions/22/go-home",
    "frame-selected": "actions/22/zoom-fit-selection",
    "fullscreen": "actions/22/view-fullscreen",
    "geotiff": "mimetypes/32/image-tiff",
    "help": "actions/22/help-contents",
    "hide": "actions/22/view-hidden",
    "json": "mimetypes/32/application-json",
    "keymap": "devices/22/input-keyboard",
    "layers": "actions/22/layer-visible-on",
    "layout": "actions/22/view-split-left-right",
    "legend": "actions/22/view-list-details",
    "locate": "actions/22/edit-find",
    "logout": "actions/22/system-log-out",
    "measure": "apps/48/kruler",
    "new": "actions/22/document-new",
    "north": "actions/22/compass",
    "project": "actions/22/project-development",
    "quit": "actions/22/application-exit",
    "redo": "actions/22/edit-redo",
    "rename": "actions/22/edit-rename",
    "reports": "actions/22/view-list-text",
    "reset": "actions/22/edit-reset",
    "reveal": "actions/22/document-open-folder",
    "run-again": "actions/22/view-refresh",
    "run-graph": "actions/22/distribute-graph-directed",
    "save": "actions/22/document-save",
    "save-as": "actions/22/document-save-as",
    "scripting": "apps/48/utilities-terminal",
    "select": "actions/22/edit-select",
    "select-none": "actions/22/edit-select-none",
    "show": "actions/22/view-visible",
    "site": "actions/22/find-location",
    "solar": "applets/48/weather-clear",
    "store": "places/22/server-database",
    "table": "mimetypes/32/x-office-spreadsheet",
    "undo": "actions/22/edit-undo",
    "weather": "applets/48/weather-few-clouds",
    "wind": "applets/48/weather-clear-wind",
    "zoom-in": "actions/22/zoom-in",
    "zoom-out": "actions/22/zoom-out",
}


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout


def read(repo: Path, path: str, depth: int = 0) -> str:
    """The file at `path`, through the symbolic links Breeze keeps between names."""
    entry = git(repo, "ls-tree", "HEAD", path).split()
    if not entry:
        raise SystemExit(f"Breeze has no {path}")
    text = git(repo, "show", f"HEAD:{path}")
    if entry[0] == "120000":
        if depth > 8:
            raise SystemExit(f"{path} is a link that does not end")
        return read(repo, posixpath.normpath(posixpath.join(posixpath.dirname(path), text)), depth + 1)
    return text


def scalable(svg: str) -> str:
    head = re.search(r"<svg\b[^>]*>", svg, flags=re.S)
    if not head or "viewBox" in head.group(0):
        return svg
    w = re.search(r'\bwidth="([\d.]+)', head.group(0))
    h = re.search(r'\bheight="([\d.]+)', head.group(0))
    if not (w and h):
        return svg
    return svg.replace("<svg", f'<svg viewBox="0 0 {w.group(1)} {h.group(1)}"', 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    repo = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.svg"):
        old.unlink()
    for name, where in sorted(ICONS.items()):
        path = f"icons/{where}.svg"
        svg = scalable(read(repo, path))
        if path.startswith(ONE_INK):
            svg = re.sub(BREEZE_INK, INK, svg, flags=re.I)
        (OUT / f"{name}.svg").write_text(svg)
    (OUT / "COPYING-ICONS").write_text(git(repo, "show", "HEAD:COPYING-ICONS"))
    commit = git(repo, "rev-parse", "HEAD").strip()
    rows = "\n".join(f"| `{name}.svg` | `icons/{where}.svg` |" for name, where in sorted(ICONS.items()))
    (OUT / "README.md").write_text(
        f"""# Breeze icons

These drawings are from KDE's Breeze icon theme, <https://invent.kde.org/frameworks/breeze-icons>,
at commit `{commit}`. They are licensed under the GNU Lesser General Public
License, version 3 or later; see `COPYING-ICONS`.

They are copied by `frontend/scripts/breeze_icons.py`, which changes two things:

- In the drawings of one ink, Breeze's dark text colour `{BREEZE_INK}` is
  rewritten to `{INK}`, this interface's text colour on its dark ground.
- A drawing with a size and no `viewBox` is given one.

| File here | File in Breeze |
|---|---|
{rows}
"""
    )
    print(f"{len(ICONS)} drawings in {OUT}")


if __name__ == "__main__":
    main()

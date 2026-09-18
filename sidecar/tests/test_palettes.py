"""The ramps a rendered layer is drawn on, and the PNG it is written to."""

from __future__ import annotations

import re

import numpy as np

from terra_energy_engine.imagery import composite as comp


def test_palette_hex_matches_the_stops_the_raster_is_drawn_with():
    """The legend is built from these; they must be the renderer's own stops."""
    for name, stops in comp.CONTINUOUS_STOPS.items():
        hexes = comp.palette_hex(name)
        assert len(hexes) == len(stops)
        assert all(re.fullmatch(r"#[0-9a-f]{6}", h) for h in hexes)
        first = tuple(int(hexes[0][i:i + 2], 16) for i in (1, 3, 5))
        assert first == tuple(int(round(c * 255)) for c in stops[0])


def test_the_ramp_ends_on_its_first_and_last_stop():
    stops = comp.CONTINUOUS_STOPS["inferno"]
    rgb = comp._lerp_cmap(np.array([0.0, 1.0], dtype=np.float32), stops)
    assert np.allclose(rgb[0], stops[0], atol=1e-6)
    assert np.allclose(rgb[1], stops[-1], atol=1e-6)


def test_write_rgba_png_round_trips(tmp_path):
    import rasterio

    rgba = np.zeros((3, 4, 4), dtype=np.uint8)
    rgba[..., 0] = 200
    rgba[1, 2, 3] = 255
    out = tmp_path / "layer.png"
    comp.write_rgba_png(rgba, out)
    with rasterio.open(out) as src:
        back = np.moveaxis(src.read(), 0, -1)
    assert back.shape == rgba.shape
    assert (back == rgba).all()

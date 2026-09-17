"""
The colour ramps the solar layers are drawn on, and the PNG they are written to.

Cut down from TERRA's terra/imagery/composite.py, which also renders Sentinel-2
band composites and spectral indices; this application reads no imagery, so
only the three solar ramps, the interpolation between their stops and the PNG
writer came over. The stops are TERRA's, unchanged.
"""

from __future__ import annotations

import numpy as np


def _lerp_cmap(t: np.ndarray, stops: list[tuple[float, float, float]]) -> np.ndarray:
    """Map t in [0,1] through RGB color stops → (…, 3) float 0–1."""
    t = np.clip(t, 0.0, 1.0)
    n = len(stops) - 1
    idx = np.minimum((t * n).astype(np.int32), n - 1)
    f = t * n - idx
    stops_a = np.array(stops, dtype=np.float32)
    c0 = stops_a[idx]
    c1 = stops_a[idx + 1]
    return c0 + (c1 - c0) * f[..., None]


# The solar quantities use perceptually uniform ramps rather than a diverging,
# hue-coded one: red-green reads as a judgement, which is wrong for a physical
# quantity, and it is the axis most affected by colour-vision deficiency. Each
# is 17 evenly spaced samples of the matplotlib lookup table; interpolating
# linearly between them departs from the true ramp by at most 6.7/255
# (inferno), 5.4/255 (viridis) and 7.6/255 (RdBu reversed).

# Irradiation.
_INFERNO = [
    (0.0015, 0.0005, 0.0139),
    (0.0423, 0.0281, 0.1411),
    (0.1293, 0.0473, 0.2908),
    (0.2383, 0.0366, 0.3964),
    (0.3415, 0.0623, 0.4294),
    (0.4412, 0.0993, 0.4316),
    (0.5409, 0.1347, 0.4151),
    (0.6401, 0.1714, 0.3811),
    (0.7357, 0.2159, 0.3302),
    (0.8224, 0.2752, 0.2661),
    (0.8943, 0.3534, 0.1936),
    (0.9470, 0.4492, 0.1153),
    (0.9784, 0.5579, 0.0349),
    (0.9879, 0.6753, 0.0653),
    (0.9746, 0.7977, 0.2063),
    (0.9476, 0.9174, 0.4107),
    (0.9884, 0.9984, 0.6449),
]

# Horizon shading loss.
_VIRIDIS = [
    (0.2670, 0.0049, 0.3294),
    (0.2823, 0.0950, 0.4173),
    (0.2788, 0.1755, 0.4834),
    (0.2590, 0.2515, 0.5247),
    (0.2297, 0.3224, 0.5457),
    (0.1994, 0.3876, 0.5546),
    (0.1727, 0.4488, 0.5579),
    (0.1490, 0.5081, 0.5573),
    (0.1276, 0.5669, 0.5506),
    (0.1206, 0.6258, 0.5335),
    (0.1579, 0.6838, 0.5017),
    (0.2461, 0.7389, 0.4520),
    (0.3692, 0.7889, 0.3829),
    (0.5160, 0.8312, 0.2943),
    (0.6785, 0.8637, 0.1895),
    (0.8456, 0.8873, 0.0997),
    (0.9932, 0.9062, 0.1439),
]

# The winter-over-summer ratio. Diverging is right here because the quantity
# has a reference: one means the two seasons deliver the same irradiation.
_RDBU_R = [
    (0.0196, 0.1882, 0.3804),
    (0.0885, 0.3211, 0.5649),
    (0.1634, 0.4450, 0.6975),
    (0.2471, 0.5557, 0.7541),
    (0.4207, 0.6764, 0.8187),
    (0.6065, 0.7898, 0.8803),
    (0.7615, 0.8685, 0.9246),
    (0.8780, 0.9257, 0.9519),
    (0.9691, 0.9665, 0.9649),
    (0.9839, 0.8976, 0.8468),
    (0.9825, 0.8007, 0.7061),
    (0.9603, 0.6678, 0.5363),
    (0.8946, 0.5038, 0.3998),
    (0.8171, 0.3322, 0.2810),
    (0.7285, 0.1550, 0.1974),
    (0.5769, 0.0554, 0.1493),
    (0.4039, 0.0000, 0.1216),
]

# Named ramps, so a response can say which one drew its raster.
CONTINUOUS_STOPS = {
    "inferno": _INFERNO,
    "viridis": _VIRIDIS,
    "rdbu_r": _RDBU_R,
}


def palette_hex(name: str) -> list[str]:
    """
    A ramp's stops as #rrggbb, low to high.

    Sent with every rendered layer so the interface draws its legend from the
    stops that drew the raster. TERRA transcribed each ramp into TypeScript
    by hand, a second copy nothing kept equal to this one.
    """
    return [
        '#{:02x}{:02x}{:02x}'.format(*(int(round(c * 255)) for c in stop))
        for stop in CONTINUOUS_STOPS[name]
    ]


def write_rgba_png(rgba: np.ndarray, out_path) -> None:
    """
    Write (H,W,4) uint8 PNG via rasterio.

    The PNG is deliberately not georeferenced -- the GeoTIFF beside it and the
    extent in the response carry that -- so rasterio's warning saying so is
    silenced. Left on, it reached stderr, which is the sidecar's progress
    channel, as a line that is not a progress object.
    """
    import warnings

    import rasterio
    from rasterio.errors import NotGeoreferencedWarning
    from rasterio.transform import Affine

    h, w = rgba.shape[:2]
    profile = {
        "driver": "PNG",
        "height": h,
        "width": w,
        "count": 4,
        "dtype": "uint8",
        "transform": Affine.identity(),
    }
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with rasterio.open(out_path, "w", **profile) as dst:
            for i in range(4):
                dst.write(rgba[:, :, i], i + 1)

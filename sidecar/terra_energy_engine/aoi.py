"""
The study area as the application sends it: a GeoJSON polygon.

From TERRA's terra/aoi.py, without the KML reader its notebooks used.
"""

from __future__ import annotations

from shapely.geometry import shape


def polygon_from_geojson(geom):
    """Build a shapely geometry from a GeoJSON geometry dict."""
    return shape(geom)

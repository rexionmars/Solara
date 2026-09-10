"""
The sun as a shared service: where it was, and what the record says arrived.

Read by the photovoltaic chain and the wind screening, which share nothing but
a location. It therefore sits below both rather than inside either, and it
imports nothing from the rest of the package.

Copied from TERRA's terra/sun, where the canopy simulation reads it as well.
The two copies are kept identical in what they compute; a fix made in one
belongs in the other.

This file is deliberately empty of code. A convenience re-export here would
make importing one submodule execute the others, so a heavy import written at
the top of any of them would reach every consumer of the package. The two heavy
dependencies in it -- pvlib in position.prepare_hourly and scipy in
record.linear_trend -- are deferred inside those function bodies today; the
empty __init__ is what keeps that property from depending on where a future
import happens to be written.
"""

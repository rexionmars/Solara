"""
The ground: elevation as the catalogue serves it, and what is derived from it.

`dem` reads a product over a window, merging the tiles it crosses; `hand`
computes height above nearest drainage over what was read. Both are consumed by
the flood envelope and by the solar terrain and siting chains, which is why
they sit below the products rather than inside one of them.

`usable` and `actions` are the one product that lives here: how much of an area
is neither too steep nor too close to the drainage, which reads nothing but
the ground.
"""

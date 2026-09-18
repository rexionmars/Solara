"""
The electrical system a site would join, read from a local PostGIS store.

The energy products answer what a site's resource is worth. None of them
answers about the system the plant would be connected to, and in the Brazilian
Northeast that system withholds a large share of what the resource delivers.
This package is the other half, carried over from TERRA's terra/grid.

    ONS     dados.ons.org.br: the operator's account of the national system,
            its transmission register and what each plant was told not to
            generate.
    ANEEL   the register that says where a plant is, which ONS never does.

Only the reading side is here. The store is loaded by TERRA, which owns the
schema (terra/grid/store.py SCHEMA) and the loaders; this application reads the
same database and never writes to it.

    store.py        the connection, the registers as layers, and coverage
    congestion.py   the transmission network an area would have to reach
    curtailment.py  what the plants already connected there experienced
    actions.py      the questions the shell can ask
"""

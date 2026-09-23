"""
What an area consumes, and what it already generates behind the meter.

Read from the BDGD the distributors file with ANEEL: every consumer unit with
its energy month by month, and every distributed generator with its installed
power and the energy it put on the network. The register is loaded into the
store's `bdgd` schema, which is not TERRA's and which this application does not
write.

WHAT A COORDINATE MEANS HERE. A unit's position is its connection point, which
the units on the same pole or transformer share, and for a few it is the middle
of a network segment. It is far finer than the municipality and it is not the
position of a building, so a reading counts units inside an area and never
draws one at an address.

TWO THINGS THE REGISTER DOES NOT SAY PLAINLY, both carried in the reply rather
than corrected silently:

ENERGY OF A GENERATOR IS WHAT IT PUT ON THE NETWORK. Measured at Cosern 2024
against the solar product at the same place, the median generator reports 51
percent of the yield the site is modelled to produce. What a distributor meters
is what crossed its meter, so self-consumption is invisible here. Read as
injection it is the right figure for a network question; read as generation it
is half of one.

INSTALLED POWER MIXES ITS UNIT BETWEEN ROWS. Some rows carry kW and some carry
W: split at 75, the two halves give median energy-over-power of 1,150 and of
exactly 1.00, a clean factor of a thousand. POWER_SPLIT_KW normalises on that,
which is a heuristic and is reported as one.
"""

from __future__ import annotations

import json

from terra_energy_engine import protocol

# Above this, installed power is read as watts; see the note above. 75 kW is
# also where the micro generation band ends, so a row above it in kW would be
# outside the band the register covers.
POWER_SPLIT_KW = 75.0

# The months, as the register names them.
MONTHS = [f'{i:02d}' for i in range(1, 13)]

NORMALISED_KWP = (f'case when u.pot_inst <= {POWER_SPLIT_KW} '
                  f'then u.pot_inst else u.pot_inst / 1000.0 end')


def energy_prefixes(conn, table: str) -> list[str]:
    """
    How this register names its monthly energy.

    Low and medium voltage carry one series, ENE_01..12. High voltage carries
    two, peak and off peak, and a reading that summed only one of them would
    report a fraction as the whole.
    """
    with conn.cursor() as cur:
        cur.execute("""
            select column_name from information_schema.columns
             where table_schema = 'bdgd' and table_name = %s
               and column_name in ('ene_01', 'ene_p_01', 'ene_f_01')
        """, (table,))
        found = {r[0] for r in cur.fetchall()}
    prefixes = [p for p, col in (('ene', 'ene_01'), ('ene_p', 'ene_p_01'),
                                 ('ene_f', 'ene_f_01')) if col in found]
    if not prefixes:
        raise protocol.Unavailable(f'bdgd.{table} carries no monthly energy')
    return prefixes


def _month(prefixes: list[str], m: str, alias: str = 'u') -> str:
    return ' + '.join(f'coalesce({alias}.{p}_{m}, 0)' for p in prefixes)


def _sum(prefixes: list[str], alias: str = 'u') -> str:
    return ' + '.join(_month(prefixes, m, alias) for m in MONTHS)


def table_exists(conn, table: str) -> bool:
    """Whether the schema carries this register; not every load has every one."""
    with conn.cursor() as cur:
        cur.execute("select to_regclass(%s) is not null", (f'bdgd.{table}',))
        return bool(cur.fetchone()[0])


def columns(conn, table: str) -> set[str]:
    """The columns one register carries; they are not the same in every one."""
    with conn.cursor() as cur:
        cur.execute("""
            select column_name from information_schema.columns
             where table_schema = 'bdgd' and table_name = %s
        """, (table,))
        return {r[0] for r in cur.fetchall()}


def _require_schema(conn) -> None:
    """
    Refuse rather than answer over an empty schema.

    An installation whose store has the network but not the register gets a
    failure that names the loader, the way a missing rollup names its refresh.
    """
    with conn.cursor() as cur:
        cur.execute("select to_regclass('bdgd.unidade_ponto')")
        if cur.fetchone()[0] is None:
            raise protocol.Unavailable(
                'the store has no bdgd.unidade_ponto, the register of consumer '
                'units this reading counts. It is loaded from a BDGD '
                'geodatabase with bdgd_para_postgis.py.')


def holdings(conn) -> list[dict]:
    """Which distributor and base year the schema holds, and how much of each."""
    with conn.cursor() as cur:
        cur.execute("""
            select distribuidora, ano, count(*),
                   count(*) filter (where geom is null)
              from bdgd.unidade_ponto
             group by 1, 2 order by 1, 2
        """)
        return [{'distribuidora': d, 'ano': a, 'unidades': n, 'sem_ponto': lost}
                for d, a, n, lost in cur.fetchall()]


def inside(conn, aoi_geojson) -> list[tuple[str, int]]:
    """Which holdings have any unit inside the area."""
    with conn.cursor() as cur:
        cur.execute("""
            select distribuidora, ano from bdgd.unidade_ponto
             where geom is not null
               and st_within(geom, st_setsrid(st_geomfromgeojson(%s), 4674))
             group by 1, 2
        """, (json.dumps(aoi_geojson),))
        return [(d, a) for d, a in cur.fetchall()]


def _chosen(held: list[dict], req_dist, req_year, overlapping=None) -> tuple[str, int]:
    """
    The holding a reading is about.

    A store with one distributor loaded needs no choice, and neither does an
    area that only one distributor reaches: concession areas do not overlap, so
    the area itself usually answers the question. Only where more than one
    remains is the request asked to name which, rather than answered about
    whichever sorts first.
    """
    if not held:
        raise protocol.Unavailable(
            'bdgd.unidade_ponto is empty; load a distributor with '
            'bdgd_para_postgis.py before asking what an area consumes.')
    if req_dist or req_year:
        match = [h for h in held
                 if (not req_dist or h['distribuidora'] == req_dist)
                 and (not req_year or h['ano'] == int(req_year))]
        if not match:
            names = ', '.join(f"{h['distribuidora']} {h['ano']}" for h in held)
            raise protocol.Unavailable(
                f'the store holds no {req_dist or "any"} for {req_year or "any year"}. '
                f'It holds: {names}.')
        chosen = max(match, key=lambda h: h['ano'])
        return chosen['distribuidora'], chosen['ano']
    if overlapping:
        reach = {d for d, _ in overlapping}
        if len(reach) == 1:
            year = max(a for d, a in overlapping)
            return next(iter(reach)), year
        held = [h for h in held if h['distribuidora'] in reach] or held
    dists = {h['distribuidora'] for h in held}
    if len(dists) > 1:
        names = ', '.join(sorted(dists))
        raise protocol.Unavailable(
            f'the store holds more than one distributor ({names}); the request '
            f'has to name which one it is about.')
    chosen = max(held, key=lambda h: h['ano'])
    return chosen['distribuidora'], chosen['ano']


def _inside(table: str, nivel: str, especie: str) -> str:
    """The units of one register inside the area, without counting one twice."""
    return f"""
        from bdgd.{table} u
        where u.distribuidora = %(dist)s and u.ano = %(ano)s
          and exists (
            select 1 from bdgd.unidade_ponto p
             where p.cod_uc = u.cod_id and p.distribuidora = u.distribuidora
               and p.ano = u.ano and p.nivel = '{nivel}' and p.especie = '{especie}'
               and p.geom is not null
               and st_within(p.geom, st_setsrid(st_geomfromgeojson(%(aoi)s), 4674))
          )
    """


def _consumption(conn, params: dict, table: str, nivel: str) -> dict | None:
    """Units and energy of one consumer register inside the area."""
    e = energy_prefixes(conn, table)
    with conn.cursor() as cur:
        cur.execute(f"""
            select count(*), sum({_sum(e)}) / 1000.0,
                   {', '.join(f'sum({_month(e, m)}) / 1000.0' for m in MONTHS)}
            {_inside(table, nivel, 'consumo')}
        """, params)
        row = cur.fetchone()
    if not row or not row[0]:
        return None
    n, total, *months = row
    return {
        'unidades': int(n),
        'energia_ano_mwh': round(float(total or 0), 1),
        'energia_mensal_mwh': [round(float(m or 0), 1) for m in months],
    }


def _by(conn, params: dict, table: str, nivel: str, column: str, limit: int) -> list[dict]:
    e = energy_prefixes(conn, table)
    with conn.cursor() as cur:
        cur.execute(f"""
            select u.{column}, count(*), sum({_sum(e)}) / 1000.0
            {_inside(table, nivel, 'consumo')}
            group by 1 order by 3 desc nulls last limit {int(limit)}
        """, params)
        return [{column: v, 'unidades': int(n), 'energia_ano_mwh': round(float(e or 0), 1)}
                for v, n, e in cur.fetchall()]


# How many generator rows travel with the reading so the document can draw the
# register instead of counting it. A cloud needs enough points to show its
# shape and no more: past a few thousand the marks overlap into a blob and the
# reply starts costing more than the picture is worth.
SAMPLE_ROWS = 4000


def _generation_sample(conn, params: dict, table: str, nivel: str) -> list[list[float]]:
    """
    Up to SAMPLE_ROWS generators as (installed kW, energy MWh) pairs.

    WHY A SAMPLE TRAVELS AT ALL. The count of rows that cannot be true is a
    fact the reader has to take on trust. The same rows plotted against the
    ceiling show HOW far past it they are, and whether the wrong rows are the
    small ones or the large ones -- which no count can answer.

    Ordered by the hash of the identifier, not at random: the same area read
    twice must draw the same cloud, or the picture changes under a reader who
    only pressed the button again.
    """
    e = energy_prefixes(conn, table)
    with conn.cursor() as cur:
        cur.execute(f"""
            select {NORMALISED_KWP}, ({_sum(e)}) / 1000.0
            {_inside(table, nivel, 'geracao')}
              and {NORMALISED_KWP} > 0
            order by md5(u.cod_id) limit {SAMPLE_ROWS}
        """, params)
        return [[round(float(kw), 3), round(float(mwh or 0), 3)] for kw, mwh in cur.fetchall()]


def _generation(conn, params: dict, table: str, nivel: str, ceiling) -> dict | None:
    """
    The generation behind the meter inside the area.

    `ceiling` is a specific yield in kWh/kWp/year, normally the one the solar
    product read at this place. A unit reporting more than its site can produce
    has a register error in its power or its energy, and is counted rather than
    dropped: the count is the reading's own measure of how much the register
    can be trusted here.
    """
    e = energy_prefixes(conn, table)
    with conn.cursor() as cur:
        cur.execute(f"""
            select count(*),
                   sum({NORMALISED_KWP}),
                   sum({_sum(e)}) / 1000.0,
                   count(*) filter (where {NORMALISED_KWP} > 0
                         and ({_sum(e)}) / {NORMALISED_KWP} > %(ceiling)s),
                   sum({NORMALISED_KWP}) filter (where {NORMALISED_KWP} > 0
                         and ({_sum(e)}) / {NORMALISED_KWP} > %(ceiling)s)
            {_inside(table, nivel, 'geracao')}
        """, {**params, 'ceiling': float(ceiling)})
        row = cur.fetchone()
    if not row or not row[0]:
        return None
    n, kwp, mwh, over_n, over_kw = row
    # The total and what is left of it once the rows that cannot be true are
    # set aside. Both are reported: the first is what the register says, the
    # second is what can be relied on, and the gap is the register's error.
    plausible = float(kwp or 0) - float(over_kw or 0)
    return {
        'unidades': int(n),
        'potencia_instalada_kw': round(float(kwp or 0), 1),
        'potencia_instalada_plausivel_kw': round(plausible, 1),
        'energia_injetada_ano_mwh': round(float(mwh or 0), 1),
        'amostra': _generation_sample(conn, params, table, nivel),
        'acima_do_teto': {
            'teto_kwh_kwp_ano': round(float(ceiling), 1),
            'unidades': int(over_n or 0),
            'potencia_kw': round(float(over_kw or 0), 1),
            'nota': ('Units reporting more energy than the site can produce. '
                     'The power or the energy of these rows is wrong; they are '
                     'counted, not removed.'),
        },
    }


# ------------------------------------------------------------- the density layer
#
# The reading counts; the layer says WHERE inside the area the counting fell.
# Without it an area of six hundred square kilometres reports one number for a
# city and its empty edge alike.

# The layer's cell, in kilometres. A kilometre over an urban area puts a few
# hundred connection points in a cell, which is coarse enough to hide a street
# and fine enough to separate a neighbourhood from a dune field.
CELL_KM = 1.0
MAX_CELLS = 400_000          # about 630 by 630, past which the PNG is the cost
PALETTE_DEMAND = 'inferno'


def _cell_degrees(cell_km: float, lat: float) -> tuple[float, float]:
    """The cell in degrees at this latitude. A degree of longitude shortens."""
    import math

    dlat = cell_km / 111.32
    dlon = cell_km / (111.32 * max(math.cos(math.radians(lat)), 0.2))
    return dlon, dlat


def density_grid(conn, aoi_geojson, params: dict, cell_km: float, work_dir):
    """
    Consumption per cell over the area, rendered as a layer for the map.

    The value is the year's energy of the units whose connection point falls in
    the cell, which is not the same as the energy consumed on that ground: a
    point carries every unit hanging off it, so a block fed from one
    transformer lands on one cell. It is a map of the network's load, drawn at
    the network's own resolution.

    An empty cell is transparent rather than zero: there is a difference
    between ground that consumes nothing and ground the register does not
    reach, and the layer must not draw the second as the first.
    """
    import numpy as np

    from terra_energy_engine.energy import overlays as overlays_mod
    from terra_energy_engine.imagery import composite as comp

    with conn.cursor() as cur:
        cur.execute("""
            select st_xmin(g), st_ymin(g), st_xmax(g), st_ymax(g)
              from (select st_setsrid(st_geomfromgeojson(%(aoi)s), 4674) g) t
        """, params)
        x0, y0, x1, y1 = (float(v) for v in cur.fetchone())

    dlon, dlat = _cell_degrees(cell_km, (y0 + y1) / 2.0)
    nx, ny = max(1, int(round((x1 - x0) / dlon))), max(1, int(round((y1 - y0) / dlat)))
    # A very large area is drawn on a coarser cell rather than refused: the
    # reading still answers, and the cell it was drawn at is reported.
    while nx * ny > MAX_CELLS:
        cell_km *= 1.5
        dlon, dlat = _cell_degrees(cell_km, (y0 + y1) / 2.0)
        nx, ny = max(1, int(round((x1 - x0) / dlon))), max(1, int(round((y1 - y0) / dlat)))

    total = np.zeros((ny, nx), dtype=np.float64)
    counted = np.zeros((ny, nx), dtype=np.int64)
    for table, nivel in (('ucbt', 'bt'), ('ucmt', 'mt'), ('ucat', 'at')):
        if not table_exists(conn, table):
            continue
        e = energy_prefixes(conn, table)
        with conn.cursor() as cur:
            cur.execute(f"""
                select least({nx - 1}, greatest(0, floor((st_x(p.geom) - %(x0)s) / %(dlon)s)::int)),
                       least({ny - 1}, greatest(0, floor((st_y(p.geom) - %(y0)s) / %(dlat)s)::int)),
                       sum({_sum(e)}) / 1000.0, count(*)
                  from bdgd.{table} u
                  join bdgd.unidade_ponto p
                    on p.cod_uc = u.cod_id and p.distribuidora = u.distribuidora
                   and p.ano = u.ano and p.nivel = '{nivel}' and p.especie = 'consumo'
                 where u.distribuidora = %(dist)s and u.ano = %(ano)s
                   and p.geom is not null
                   and st_within(p.geom, st_setsrid(st_geomfromgeojson(%(aoi)s), 4674))
                 group by 1, 2
            """, {**params, 'x0': x0, 'y0': y0, 'dlon': dlon, 'dlat': dlat})
            for ix, iy, mwh, n in cur.fetchall():
                # The image's first row is the north edge; the grid's first row
                # is the south one.
                total[ny - 1 - int(iy), int(ix)] += float(mwh or 0)
                counted[ny - 1 - int(iy), int(ix)] += int(n)

    valid = counted > 0
    if not valid.any():
        return None

    vals = total[valid]
    # The domain is the 2nd to 98th percentile of the cells that hold anything:
    # one substation-fed cell otherwise takes the whole ramp and the city reads
    # as empty. The endpoints say what they are in the legend.
    vmin = float(np.percentile(vals, 2))
    vmax = float(np.percentile(vals, 98))
    if not vmax > vmin:
        vmin, vmax = float(vals.min()), float(vals.max() + 1e-9)

    # WHERE THE LOAD IS, AND HOW GATHERED. Both come off the grid that was
    # just built, and both are things a table of totals cannot say: how much of
    # the area's consumption sits in how little of its ground, and where the
    # middle of that consumption falls against the middle of the area.
    flat = np.sort(total[valid])[::-1]
    cumulative = np.cumsum(flat)
    half = int(np.searchsorted(cumulative, cumulative[-1] / 2.0) + 1)
    decile = max(1, int(round(0.1 * flat.size)))
    cell_km2 = cell_km * cell_km
    rows, cols = np.nonzero(valid)
    weight = total[valid]
    wsum = float(weight.sum()) or 1.0
    load_lon = x0 + (float((cols * weight).sum()) / wsum + 0.5) * dlon
    load_lat = y0 + ((ny - 1 - float((rows * weight).sum()) / wsum) + 0.5) * dlat
    mid_lon, mid_lat = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    import math

    dx_km = (load_lon - mid_lon) * 111.32 * math.cos(math.radians(mid_lat))
    dy_km = (load_lat - mid_lat) * 111.32
    bearing = ['leste', 'nordeste', 'norte', 'noroeste', 'oeste',
               'sudoeste', 'sul', 'sudeste'][int(round(math.degrees(
                   math.atan2(dy_km, dx_km)) % 360 / 45.0)) % 8]

    png = work_dir / 'demand_density.png'
    comp.write_rgba_png(
        overlays_mod.terrain_rgba(total, valid, vmin, vmax, PALETTE_DEMAND), png
    )
    return {
        'overlay_png': str(png),
        'extent': {
            'lon_min': x0, 'lat_min': y0,
            'lon_max': x0 + nx * dlon, 'lat_max': y0 + ny * dlat,
        },
        'cell_km': round(cell_km, 3),
        'cells': int(valid.sum()),
        'grid': {'nx': nx, 'ny': ny},
        'unit': 'MWh/ano por célula',
        'scale': {
            'palette': PALETTE_DEMAND,
            'min': round(vmin, 1),
            'max': round(vmax, 1),
            'reference': None,
            'basis': 'own',
            'shared_with': None,
            'decimals': 1,
            'stops': comp.palette_hex(PALETTE_DEMAND),
        },
        'note': (
            'Each cell holds the year of the units whose connection point '
            'falls in it, so a block fed from one transformer lands on one '
            'cell. Empty cells are transparent, not zero: the register reaches '
            'what it reaches.'
        ),
        # What the grid says that the totals cannot.
        'concentracao': {
            'celulas_com_metade': half,
            'km2_com_metade': round(half * cell_km2, 1),
            'pct_das_celulas_ocupadas': round(100.0 * half / flat.size, 1),
            'decil_superior_pct': round(100.0 * float(cumulative[decile - 1]) / float(cumulative[-1]), 1),
        },
        'centro_de_carga': {
            'lon': round(load_lon, 5), 'lat': round(load_lat, 5),
            'desloc_km': round(math.hypot(dx_km, dy_km), 1),
            'rumo': bearing,
        },
    }


# A rooftop in the sunniest place in Brazil, at the modelled performance ratio
# and no shading: nothing fixed can beat it. Only used when the caller passes
# no ceiling of its own, and said so in the reply.
DEFAULT_CEILING_KWH_KWP = 1900.0


def findings(consumo: dict, geracao: dict, density, por_classe: list) -> dict:
    """
    The quantities derived from the registers rather than read off them: the
    swing of the year, how gathered the load is, which class leads, and how
    many generators declare what their site cannot make.

    NO SENTENCE IS WRITTEN FROM THESE. Each one is shown as a labelled figure
    beside the numbers it was derived from -- the swing under the twelve
    months, the concentration under the density layer -- and never gathered
    into a summary that states in prose what the figures below already say.
    A derived quantity with no place to sit does not belong here either.

    Everything here is arithmetic on the register. Nothing is modelled.
    """
    out: dict = {}

    months = (consumo.get('bt') or {}).get('energia_mensal_mwh') or []
    if len(months) == 12 and max(months) > 0:
        mean = sum(months) / 12.0
        hi, lo = max(months), min(months)
        out['sazonalidade'] = {
            'mes_pico': months.index(hi) + 1,
            'mes_vale': months.index(lo) + 1,
            'pico_mwh': round(hi, 1),
            'vale_mwh': round(lo, 1),
            # The swing a network has to carry, as a share of the ordinary month.
            'amplitude_pct': round(100.0 * (hi - lo) / mean, 1) if mean else None,
        }

    # NO SELF-SUPPLY RATIO IS DERIVED HERE, and none should be added back.
    # A kWh-per-kW for the standing fleet divides the energy of every generator
    # by the power of only the plausible ones, so its two sides do not count
    # the same rows; the power itself comes from NORMALISED_KWP, which guesses
    # kW against W at a 75 kW split and mistakes a genuine large plant for a
    # small one. Sizing new capacity from that figure carries both errors, and
    # the injection in the numerator is not generation. The ratio the reading
    # does report is injected over consumed, in `totais`, named for what it is.

    if por_classe:
        lead = por_classe[0]
        units_total = sum(c['unidades'] for c in por_classe) or 1
        energy_total = sum(c['energia_ano_mwh'] for c in por_classe) or 1.0
        out['mix'] = {
            'classe': lead['clas_sub'],
            'pct_da_energia': round(100.0 * lead['energia_ano_mwh'] / energy_total, 1),
            'pct_das_unidades': round(100.0 * lead['unidades'] / units_total, 1),
        }

    over = [(g['acima_do_teto']['unidades'], g['unidades'],
             g['potencia_instalada_kw'] - g['potencia_instalada_plausivel_kw'],
             g['potencia_instalada_kw'])
            for g in geracao.values() if g]
    if over:
        n_over = sum(o[0] for o in over)
        n_all = sum(o[1] for o in over) or 1
        kw_over = sum(o[2] for o in over)
        kw_all = sum(o[3] for o in over) or 1.0
        out['confianca_do_registro'] = {
            'geradores_impossiveis': n_over,
            'geradores': n_all,
            'pct_dos_geradores': round(100.0 * n_over / n_all, 1),
            'pct_da_potencia': round(100.0 * kw_over / kw_all, 1),
        }

    if density:
        out['concentracao'] = density['concentracao']
        out['centro_de_carga'] = density['centro_de_carga']
    return out


def towns(conn, dist: str, ano: int) -> dict:
    """
    What every municipality of this register consumes, as a layer.

    A LAYER IS NOT A READING, and this is the difference: a reading answers
    about a ground the reader chose, and until they have chosen one the map
    says nothing about where consumption is. This answers before any choice, so
    choosing is done over something visible -- the same argument the plant
    register's layer is written on.

    Keyed on the IBGE municipality code the register carries, which is the code
    IBGE's own meshes are keyed on, so the shape is joined to the figure
    without a name match. The UFs are returned with it because the meshes are
    published one state at a time, and the caller has to know which to ask for.

    Consumption and generation are counted apart and never netted, the way
    every other figure of this product is.
    """
    out: dict[str, dict] = {}
    for table, especie in (('ucbt', 'consumo'), ('ucmt', 'consumo'), ('ucat', 'consumo'),
                           ('ugbt', 'geracao'), ('ugmt', 'geracao'), ('ugat', 'geracao')):
        if not table_exists(conn, table):
            continue
        have = columns(conn, table)
        if 'mun' not in have:
            continue
        e = energy_prefixes(conn, table)
        power = f', sum({NORMALISED_KWP})' if 'pot_inst' in have else ', 0'
        with conn.cursor() as cur:
            cur.execute(f"""
                select u.mun, count(*), sum({_sum(e)}) / 1000.0 {power}
                  from bdgd.{table} u
                 where u.distribuidora = %(dist)s and u.ano = %(ano)s and u.mun is not null
                 group by 1
            """, {'dist': dist, 'ano': ano})
            for mun, n, mwh, kw in cur.fetchall():
                row = out.setdefault(str(mun), {
                    'mun': str(mun), 'unidades': 0, 'energia_ano_mwh': 0.0,
                    'geradores': 0, 'injetada_ano_mwh': 0.0, 'potencia_kw': 0.0,
                })
                if especie == 'consumo':
                    row['unidades'] += int(n)
                    row['energia_ano_mwh'] += float(mwh or 0)
                else:
                    row['geradores'] += int(n)
                    row['injetada_ano_mwh'] += float(mwh or 0)
                    row['potencia_kw'] += float(kw or 0)

    rows = sorted(out.values(), key=lambda r: -r['energia_ano_mwh'])
    for r in rows:
        for k in ('energia_ano_mwh', 'injetada_ano_mwh', 'potencia_kw'):
            r[k] = round(r[k], 1)
    return {
        'distribuidora': dist,
        'ano': ano,
        # The two first digits of an IBGE municipality code are its state's.
        'ufs': sorted({r['mun'][:2] for r in rows if len(r['mun']) >= 2}),
        'municipios': rows,
        'unit': 'MWh/ano',
        'nota': (
            'Consumption of the units the register places in each municipality. '
            'A unit is counted where its connection point is, and generation is '
            'reported beside consumption, never subtracted from it.'
        ),
    }


def coverage(conn, aoi_geojson, dist: str, ano: int) -> dict | None:
    """
    How much of the asked-for area this register can answer about.

    THE REGISTER ENDS AT THE CONCESSION AND THE AREA DOES NOT KNOW THAT. A
    ground drawn across two states is answered with the units of whichever
    distributor is loaded, and every figure -- the totals, the year, the
    concentration -- is then about the part it reached, under a heading that
    names only which register was read. Over a hand-drawn area of central
    Ceara with Cosern loaded, that was 7.4 percent of the ground.

    The concession is the union of the tariff sets (CONJ), 59 polygons here
    whose union is 53,501 km2 against the 52,811 km2 of Rio Grande do Norte.
    Areas are measured on the geography, so they are square kilometres and not
    square degrees.

    Returns None where the register carries no tariff set, which is a fact the
    reading is missing rather than a coverage of zero.
    """
    if not table_exists(conn, 'conj'):
        return None
    with conn.cursor() as cur:
        cur.execute("""
            with aoi as (select st_setsrid(st_geomfromgeojson(%(aoi)s), 4674) g),
                 conc as (select st_union(geom) g from bdgd.conj
                           where distribuidora = %(dist)s and ano = %(ano)s)
            select st_area(aoi.g::geography) / 1e6,
                   st_area(conc.g::geography) / 1e6,
                   st_area(st_intersection(aoi.g, conc.g)::geography) / 1e6
              from aoi, conc
        """, {'aoi': json.dumps(aoi_geojson), 'dist': dist, 'ano': ano})
        row = cur.fetchone()
    if not row or row[1] is None:
        return None
    area_km2, concession_km2, both_km2 = (float(v or 0) for v in row)
    return {
        'area_km2': round(area_km2, 1),
        'concessao_km2': round(concession_km2, 1),
        'dentro_km2': round(both_km2, 1),
        'cobertura_pct': round(100.0 * both_km2 / area_km2, 1) if area_km2 else None,
        'nota': (
            'The share of the asked-for area this distributor is the register '
            'of. What lies outside it is served by another distributor, whose '
            'register is not loaded, and is missing from every figure here.'
        ),
    }


def concessions(conn) -> dict:
    """
    Where each register the store holds actually reaches, as a layer.

    THE QUESTION THIS ANSWERS IS "CAN I ASK HERE AT ALL". A demand reading is
    always about one distributor, and the register exists only where that
    distributor is the distributor. Asking about Piaui with a Rio Grande do
    Norte register returns almost nothing, and until this is on the map there
    is no way to know that before spending the query. Like the municipal
    layer, it takes no area and no window: it answers BEFORE any ground is
    chosen, which is the only moment the answer is useful.

    WHAT THE SHAPE IS, EXACTLY. The union of the `conj` of one holding -- the
    tariff sets the register carries. That is where this LOAD has data, which
    is not the same thing as the distributor's legal concession, and the
    layer's label has to say the first and not the second. A set the load did
    not bring is ground this layer calls outside when the concession includes
    it.

    Simplified to about 200 m. The shape is used to decide which state or
    municipality to ask about, and a boundary good to a kilometre answers that;
    the full mesh would be megabytes for a question nobody asks at that
    resolution. `coverage()` measures against the UNSIMPLIFIED geometry, so the
    percentage a reading reports is never the one this layer would give.

    The geometry is SIRGAS 2000 (4674), which the map reads as WGS 84. They
    differ by under a metre in Brazil, which is far inside the simplification
    above.
    """
    held = holdings(conn)
    if not table_exists(conn, 'conj'):
        return {
            'holdings': held,
            'concessoes': [],
            'nota': (
                'This store has no bdgd.conj, the tariff sets the reach is '
                'drawn from, so where each register reaches cannot be shown. '
                'Load it with bdgd_para_postgis.py.'),
        }

    out = []
    for h in held:
        with conn.cursor() as cur:
            cur.execute("""
                with u as (
                    select st_union(geom) g from bdgd.conj
                     where distribuidora = %(dist)s and ano = %(ano)s
                )
                select st_asgeojson(
                           st_simplifypreservetopology(g, %(tol)s), 6, 0),
                       st_area(g::geography) / 1e6,
                       st_npoints(g)
                  from u
            """, {'dist': h['distribuidora'], 'ano': h['ano'], 'tol': 0.002})
            row = cur.fetchone()
        # A holding whose sets did not come with the load is reported as a
        # holding without a reach, not skipped: the caller has to be able to
        # say WHICH register it cannot draw.
        if not row or not row[0]:
            out.append({**h, 'geometry': None, 'area_km2': None})
            continue
        out.append({
            **h,
            'geometry': json.loads(row[0]),
            'area_km2': round(float(row[1] or 0), 1),
            'vertices': int(row[2] or 0),
        })

    return {
        'holdings': held,
        'concessoes': out,
        'nota': (
            'Where each register loaded in the store has data, as the union of '
            'its tariff sets. It is not the distributor legal concession: a set '
            'the load did not bring is ground shown as outside. A reading over '
            'ground outside every shape here comes back empty.'),
    }


def demand_context(conn, aoi_geojson, req, work_dir=None) -> dict:
    """What the area consumes and generates, from the register the store holds."""
    _require_schema(conn)
    held = holdings(conn)
    dist, ano = _chosen(held, req.get('distribuidora'), req.get('ano'),
                        overlapping=inside(conn, aoi_geojson))
    params = {'dist': dist, 'ano': ano, 'aoi': json.dumps(aoi_geojson)}

    # Before counting anything: an area this register does not reach at all is
    # refused, rather than answered with the nothing it happens to hold there.
    reach = coverage(conn, aoi_geojson, dist, ano)
    if reach and reach['dentro_km2'] <= 0:
        raise protocol.Unavailable(
            f'{dist} is not the distributor of this area: its concession and '
            f'the area do not meet. The store holds ' +
            ', '.join(f"{h['distribuidora']} {h['ano']}" for h in held) + '.')

    ceiling = req.get('specific_yield_ceiling_kwh_kwp')
    ceiling_source = 'request'
    if ceiling is None:
        ceiling, ceiling_source = DEFAULT_CEILING_KWH_KWP, 'convenção do produto'

    por_classe = None  # filled below; findings reads it
    consumo = {nivel: _consumption(conn, params, table, nivel)
               for table, nivel in (('ucbt', 'bt'), ('ucmt', 'mt'), ('ucat', 'at'))}
    geracao = {nivel: _generation(conn, params, table, nivel, ceiling)
               for table, nivel in (('ugbt', 'bt'), ('ugmt', 'mt'), ('ugat', 'at'))}

    density = None
    if work_dir is not None:
        cell_km = protocol.request_positive(req, 'cell_km', CELL_KM)
        density = density_grid(conn, aoi_geojson, params, float(cell_km), work_dir)

    por_classe = _by(conn, params, 'ucbt', 'bt', 'clas_sub', 8)
    total = sum(c['energia_ano_mwh'] for c in consumo.values() if c)
    injected = sum(g['energia_injetada_ano_mwh'] for g in geracao.values() if g)
    return {
        'register': {
            'distribuidora': dist, 'ano': ano,
            'base': f'BDGD {dist}, ano-base {ano}',
            'holdings': held,
        },
        'consumo': consumo,
        'geracao': geracao,
        'totais': {
            'energia_consumida_ano_mwh': round(total, 1),
            'energia_injetada_ano_mwh': round(injected, 1),
            'injetada_sobre_consumida_pct': (
                round(100.0 * injected / total, 2) if total else None),
        },
        'cobertura': reach,
        'density': density,
        'analise': findings(consumo, geracao, density, por_classe),
        'por_classe': por_classe,
        'por_municipio': _by(conn, params, 'ucbt', 'bt', 'mun', 8),
        'assumptions': {
            'energia_da_geracao': (
                'Injected into the network, not generated: what the meter saw. '
                'Self-consumption is not in the register.'),
            'potencia_instalada': (
                f'Normalised at {POWER_SPLIT_KW:.0f}: rows above it are read as '
                f'watts. The register mixes the two units between rows.'),
            'posicao': (
                'Each unit sits at its connection point, shared with the units '
                'on the same pole or transformer, and for a few at the middle '
                'of a network segment.'),
            'teto_de_rendimento': {
                'valor_kwh_kwp_ano': round(float(ceiling), 1),
                'origem': ceiling_source,
                'nota': ('Pass the specific yield the solar product read at '
                         'this place to audit the register against the site '
                         'itself rather than against a convention.'),
            },
        },
    }

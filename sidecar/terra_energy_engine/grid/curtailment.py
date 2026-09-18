"""
What the plants already connected near an area experienced: the energy the
operator withheld from them, over the window the record holds.

Only the summary TERRA's connection reading carries is here. The breakdowns by
reason, hour, month and plant are TERRA's curtailment product, which this
application does not have. Carried over from TERRA's terra/grid/curtailment.py.
"""

from __future__ import annotations

from terra_energy_engine import protocol


def _require_rollup(conn) -> None:
    """
    Refuse rather than fall back, which is this slice's rule and not a mood.

    br.pv_daily is the join between the detail record and the curtailment
    record, computed once per load instead of once per question: over an area
    of seventeen plants the direct query takes 78.5 seconds and this takes 71
    milliseconds, with the period counts identical.

    KEEPING THE DIRECT QUERY AS A FALLBACK WOULD BE TWO IMPLEMENTATIONS OF ONE
    ANSWER, and TERRA's terra/grid/actions.py already states why that is refused: an
    installation without the store gets a failure that says what is missing,
    not a slower answer that might disagree with the fast one. The two DID
    disagree while both existed -- the view was first written without the
    cluster membership's time bound, and it inflated the period count for the
    19 percent of plants that change cluster.

    An empty view is a load that has not been followed by a refresh, which is
    one command and is named here.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('br.pv_daily')")
        if cur.fetchone()[0] is None:
            raise protocol.Unavailable(
                'the store has no br.pv_daily, the daily rollup the connection '
                'reading sums. It is built in TERRA with store.refresh_rollup.')
        cur.execute('SELECT count(*) FROM br.pv_daily')
        if cur.fetchone()[0] == 0:
            raise protocol.Unavailable(
                'br.pv_daily is empty, which is a load that was not followed '
                'by a refresh. Run store.refresh_rollup in TERRA; it takes about '
                'a minute over the published span.')


def curtailment_context(conn, aoi_geojson, start: str, end: str):
    """
    What the operator curtailed at the plants inside an AOI, over a window.

    THE ANSWER energy_model CANNOT MODEL. Every step of the loss waterfall is
    physics: geometry, temperature, inverter. Curtailment is a decision taken
    elsewhere in the system, about the grid rather than the site, and a plant
    that was told not to generate produced nothing its resource explains.

    THE ENERGY AND THE REASON COME FROM DIFFERENT RECORDS, AND ONLY ONE OF THEM
    HAS THE ENERGY. The curtailment record's val_geracaolimitada is the CAP the
    operator imposed, not the energy withheld -- summing it counts megawatt
    ceilings as megawatt-hours -- and val_geracaoreferenciafinal, which would
    give the energy, is absent on 42,238 of 42,384 rows of one cluster. What
    the record does carry reliably is WHEN a restriction was in force and WHY.
    The energy is in the detail record instead, per plant: at 935 W/m2 on the
    array, Castilho 1 was estimated at 41.792 MW and verified at 6.112 MW under
    reason ENE. So this reads the amount from the detail record and the reason
    from the curtailment record, joined on the cluster and the instant.

    ESTIMATED MINUS VERIFIED IS ONS'S OWN ACCOUNTING, NOT A MEASUREMENT. The
    estimate is the operator's model of what the plant would have produced, so
    the difference carries that model's error and can be negative. Reported as
    published rather than clipped, because clipping would turn a two-sided
    error into a one-sided bias in every total above it.

    THE ATTRIBUTION OF THE REASON IS THE CLUSTER'S. ONS curtails a cluster, so
    the reason and origin describe every plant in it. The energy does not have
    that problem: it is per plant, and only the plants inside the AOI are
    summed.

    Returns None when the AOI contains no plant the record covers.
    """
    import json

    _require_rollup(conn)

    with conn.cursor() as cur:
        cur.execute(
            """
            WITH dentro AS (
                SELECT p.ceg_core FROM br.plant p
                WHERE p.geom IS NOT NULL
                  AND ST_Intersects(p.geom, ST_GeomFromGeoJSON(%s))
            )
            SELECT count(DISTINCT r.id_ons)                          AS plants,
                   sum(r.periods)                                    AS periods,
                   sum(r.withheld_mwh)                               AS withheld,
                   sum(r.expected_mwh)                               AS expected,
                   sum(r.delivered_mwh)                              AS delivered,
                   sum(r.periods) FILTER (WHERE r.reason_code IS NOT NULL)
                       AS restricted,
                   -- The same difference over the half hours with NO
                   -- restriction in force: the operator's estimate against its
                   -- own meter, at the same plants over the same window. It is
                   -- the floor of what this difference means, and without it a
                   -- withheld fraction cannot be told from model error.
                   sum(r.withheld_mwh) FILTER (WHERE r.reason_code IS NULL)
                       AS free_gap,
                   sum(r.expected_mwh) FILTER (WHERE r.reason_code IS NULL)
                       AS free_expected,
                   sum(r.withheld_mwh) FILTER (WHERE r.reason_code IS NOT NULL)
                       AS restricted_gap,
                   -- Weighted by the periods each row stands for. mode() over
                   -- the rollup would count a day of one reason equally with a
                   -- single half hour of another, which is not what the raw
                   -- query answered: there, one row was one half hour.
                   (SELECT x.reason_code FROM br.pv_daily x
                     JOIN dentro USING (ceg_core)
                    WHERE x.reason_code IS NOT NULL
                      AND x.day >= %s::date AND x.day <= %s::date
                    GROUP BY x.reason_code
                    ORDER BY sum(x.periods) DESC LIMIT 1)          AS top_reason,
                   (SELECT x.origin_code FROM br.pv_daily x
                     JOIN dentro USING (ceg_core)
                    WHERE x.origin_code IS NOT NULL
                      AND x.day >= %s::date AND x.day <= %s::date
                    GROUP BY x.origin_code
                    ORDER BY sum(x.periods) DESC LIMIT 1)          AS top_origin
            FROM br.pv_daily r
            JOIN dentro USING (ceg_core)
            WHERE r.day >= %s::date AND r.day <= %s::date
            """,
            (json.dumps(aoi_geojson), start, end, start, end, start, end))
        cols = [d.name for d in cur.description]
        row = dict(zip(cols, cur.fetchone(), strict=True))

    if not row['plants']:
        return None

    expected = float(row['expected'] or 0.0)
    withheld = float(row['withheld'] or 0.0)
    free_expected = float(row['free_expected'] or 0.0)
    free_gap = float(row['free_gap'] or 0.0)
    baseline = (free_gap / free_expected) if free_expected > 0 else None
    restricted_gap = float(row['restricted_gap'] or 0.0)
    return {
        'plants_in_aoi': int(row['plants']),
        'window': f'{start}..{end}',
        'expected_mwh': round(expected, 1),
        'delivered_mwh': round(float(row['delivered'] or 0.0), 1),
        'withheld_mwh': round(withheld, 1),
        'withheld_fraction': (round(withheld / expected, 4)
                              if expected > 0 else None),
        # THE TOTAL IS A SUM OF TWO DIFFERENT THINGS AND SAYING SO IS THE ONLY
        # WAY IT ADDS UP. withheld_mwh spans every half hour in the window, so
        # it carries both the energy taken while a restriction was in force and
        # the operator's estimate error while none was -- and the second is
        # frequently NEGATIVE, because plants often out-produce the estimate
        # when free. At one AOI the restricted periods account for 192,976 MWh
        # and the free ones for -39,442, which is why the by_reason table sums
        # to more than the headline. Split here so a reader is not left to
        # discover that the two do not agree.
        'withheld_under_restriction_mwh': round(restricted_gap, 1),
        'estimate_gap_when_free_mwh': round(free_gap, 1),
        'periods': int(row['periods']),
        'periods_under_restriction': int(row['restricted'] or 0),
        # float(), and it is not decoration. sum() over an integer column
        # returns NUMERIC in Postgres, so psycopg hands back a Decimal and
        # Decimal / Decimal is a Decimal -- which json.dumps(default=str)
        # serialises as a STRING. Go then refuses the whole payload with
        # "cannot unmarshal string into float64", and the reading fails at the
        # transport with a message about nothing that went wrong. The two
        # counts above are already cast; this quotient was the one that was
        # not, and it only became a Decimal when the query moved from count(*)
        # to sum().
        'restricted_fraction': (
            round(float(row['restricted']) / float(row['periods']), 4)
            if row['periods'] else None),
        'top_reason': row['top_reason'],
        'top_origin': row['top_origin'],
        # The same quantity where no restriction was in force, and the reason
        # withheld_fraction must not be read alone.
        #
        # SUBTRACT, DO NOT DIVIDE. The floor crosses zero -- it runs -10 to +8
        # percent across clusters -- so a signal-to-floor ratio is undefined
        # near the crossing and returns 9,341x for a cluster whose floor is
        # 0.0 percent. The difference is the quantity with meaning: curtailment
        # net of the operator's model bias, in the same units as the figure
        # above it.
        #
        # MEASURED, over the whole record: the difference holds at a median of
        # 36.1 points across ten quarters, sd 7.6, range 27.0 to 48.4; and at a
        # median of 37.0 points across 84 clusters, sd 15.3. The two groupings
        # of the same data agree on the centre and disagree on the spread,
        # which is what a floor that is a property of the PLANT rather than of
        # the period looks like. So a withheld fraction is comparable over time
        # for one AOI, and is not comparable between AOIs without its floor.
        # (84 of 93 clusters; nine carry too few restricted half hours to
        # measure, and dropping them biases this toward the stable ones.)
        'unrestricted_baseline_fraction': (None if baseline is None
                                           else round(baseline, 4)),
        'kind': 'empirical',
        'basis': (
            'Withheld energy is the operator\'s estimated generation minus its '
            'verified generation, summed over the plants inside the AOI. The '
            'estimate is a model of ONS\'s, so the difference carries its error '
            'and is reported unclipped. The reason and origin are attributed to '
            'the CLUSTER a plant belonged to at the time, so they describe '
            'plants outside the AOI as well. '
            'unrestricted_baseline_fraction is the same difference over the '
            'half hours with no restriction in force, at the same plants over '
            'the same window: the floor below which this figure is the '
            'operator\'s model error rather than curtailment.'
        ),
        'source': 'ONS constrained-off, photovoltaic detail and curtailment',
    }

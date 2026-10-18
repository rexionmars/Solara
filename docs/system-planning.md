# Solora system planning

Open **Planning · PyPSA** in the permanent Workspace bar, or
**Analysis → Grid → Planning** (also available in the panel editor selector). This is an explicit electricity-system study using
PyPSA 1.4.0 and the HiGHS 1.15.1 linear solver, running locally in the cancellable
sidecar analysis slot. Install the repository's `requirements.txt` into its Python
3.12 environment. No external optimization service or PostGIS store is required.

The ribbon follows the active workspace and its panels. Planning provides **Study**,
**Run**, **View** and **Export**, with study JSON actions in **Studio**. A **Map** tab
appears only when the workspace contains a map. Each workspace remembers its own
selected ribbon tab; Solar, Wind, Grid, Data and Scripting expose their related tools.

## Workflow

1. Use the panel header’s **File** menu to create or import a version 1 JSON study. Exported run reports can also
   be imported: their recorded `study` becomes the editable input.
2. Set the study mode, currency, sources/assumptions and optional horizon CO₂ cap.
3. Build a chronological horizon. Supply interval-average demand (MW) and generator
   availability (0–1) for every interval. All timestamps carry a timezone and
   intervals must be ordered and contiguous. Rebuilding the horizon resets profiles.
4. Enter buses, generators, loads, existing lines and optional storage. IDs must be
   unique within component types and bus references must exist. Electrical parameters,
   profiles and costs are supplied explicitly. A GeoPackage can be cited as a
   geographic reference; map features do not establish electrical connectivity.
5. Run optimization. An infeasible or nonoptimal solve produces an error, not a
   partial planning result. Cancellation stops the Python process and solver.
6. Inspect dispatch, capacities, transmission utilization, storage losses and cost
   decomposition. Export the run report to preserve the exact inputs and outputs.

**Load synthetic example** supplies an explicitly fictional 24-hour, two-bus case
with gas, solar, a transmission bottleneck and a battery. Its costs, profiles and
parameters are demonstration assumptions, not measurements or an Italian grid model.

Draft inputs are saved in browser local storage under `solora.system-planning.v1`.
They are independent of `.solara` projects. The last five successful reports remain
in session memory across panel/workspace changes; export them before closing the app.
The study and run-report exports use the desktop Save dialog. JSON imports are
limited to 32 MB. The app never modifies a referenced GeoPackage.

The panel header switches between **Study**, **Network**, **Profiles** and **Results**.
Network components are organized by type; add and remove rows from each table’s
toolbar. The **File** menu also exports study inputs and solved run reports.

## Model and units

The model is a continuous, single-period linear optimization with perfect foresight.

- **Dispatch:** fixed existing generator, storage and line capacities; minimize
  variable generation and storage-discharge costs.
- **Expansion:** jointly optimize dispatch and the total capacity of assets whose
  `expandable` flag is true. Minimum capacity is existing capacity; maximum is the
  supplied total bound. Existing assets cannot be retired. Expansion of generators
  and storage may start at zero capacity. Lines must already exist with a positive
  rating: new transmission topology is not modelled.

For chronological duration `H` hours, the reported objective is

```
sum_t duration[t] * (sum_g dispatch[g,t] * marginal_cost[g]
                  + sum_s discharge[s,t] * marginal_cost[s])
+ (H / 8760) * sum_expandable_assets (optimized_capacity - existing_capacity)
                                     * annualized_cost
```

Annualized cost is the user-supplied annual equivalent investment plus fixed cost
per unit of **added** capacity. It is not overnight CAPEX. Existing capacities are
sunk costs; their fixed costs are excluded. The app does not infer financing rates,
asset lives or annuities. Every cost uses the study's single currency. Partial-year
studies prorate annualized costs but do not extrapolate energy or emissions to a year.
The cost/demand ratio is this objective divided by served energy, not project LCOE.

| Input | Unit / interpretation |
|---|---|
| Bus `v_nom_kv` | kV; line terminals must have identical nominal voltage |
| Generator/storage `existing_mw`, `max_mw` | MW electrical power |
| Generator `availability` | Interval-average fraction of nominal output, 0–1 |
| Load `p_mw` | Interval-average MW; no automatic load shedding |
| Generator `co2_tonnes_per_mwh` | Direct tonnes CO₂ / MWh **electrical output**; no implicit fuel efficiency or lifecycle emissions |
| `co2_limit_tonnes` | Total direct emissions over the modelled horizon; null means no cap |
| Line `existing_mva`, `max_mva` | MVA rating applied as an active-power MW bound in the lossless linear model |
| Line `x_ohm` | Positive reactance in ohms, fixed during reinforcement |
| Generator/storage annualized cost | Currency / MW / year |
| Line annualized cost | Currency / MVA / year |
| Marginal cost | Currency / MWh generated or discharged |
| Storage `max_hours` | Energy/power ratio; optimized energy = optimized MW × max_hours |
| Storage efficiencies | Separate charge and discharge fractions, 0–1 |

Passive lines enforce linear active-power flow equations (nodal balance and
Kirchhoff cycle constraints) with zero resistance and symmetric rating bounds.
Reactance stays fixed during line reinforcement: this approximates a thermal-rating
increase, not a physical parallel-circuit redesign. Transformers are not supported.
Disconnected buses are separate electrical islands, never implicitly connected.

Storage operates chronologically: the duration weights govern both dispatch energy
and state-of-charge evolution. State of charge is cyclic over the entire horizon,
so end and initial stored energy coincide. There is no free initial energy.
Stored energy losses follow the supplied efficiencies; standing losses are zero.
The continuous formulation does not prohibit simultaneous charge and discharge.
Nonnegative costs and losses discourage it, but zero-cost degeneracy is possible.

There is no AC voltage-magnitude/reactive-power assessment, resistive transmission
loss, N−1 security constraint, unit commitment, reserve requirement, stochastic
optimization or multi-investment-period planning in this implementation. These are
separate PyPSA capabilities and have not been silently enabled.

Limits: 1–8,784 chronological intervals, total duration ≤8,784 hours, up to 1,000
components of each kind, and at most 2,000,000 component-intervals. Each interval
lasts between one minute and 24 hours. HiGHS has a 180-second solve limit; the whole
sidecar request is bounded to five minutes. Time-limited nonoptimal solutions are
rejected. Smaller networks/horizons can be used when a study exceeds these limits.

## Results and reproducibility

Each report includes the original study, a SHA-256 digest of its canonical JSON,
UTC execution time, PyPSA/HiGHS versions, optimal termination status, and:

- Horizon cost, split into operation and added-capacity costs; energy served,
  direct CO₂ and cost per MWh of demand.
- Existing, optimized and added capacity by generator, line and storage unit.
- Generated energy, unused available energy and capacity factor per generator.
  Unused headroom at a dispatchable unit is not labelled renewable curtailment.
- Peak line utilization and elapsed hours at ≥99.99% of rating. These are binding
  thermal limits, not a complete security or economic-congestion assessment.
- Storage charging, discharging, losses and energy capacity.
- Every interval's generation per unit, demand per bus, signed line flow (positive
  from bus0 to bus1), charge/discharge per storage unit and state of charge.

Before accepting a result, Solora independently checks active-power balance at
**every bus and interval**, and reconciles the reported cost decomposition with the
solver objective. No asset identity, usable capacity or connection feasibility is
inferred from spatial proximity or count.

The UI retains five reports for side-by-side scenario totals. Compare only
compatible horizons, demand, currencies and assumptions. Changed draft inputs are
marked separately from the recorded inputs of each result.

## Method references

- [PyPSA optimization overview](https://docs.pypsa.org/latest/user-guide/optimization/overview/)
- [Objective and existing-capacity cost constant](https://docs.pypsa.org/latest/user-guide/optimization/objective/)
- [Capacity constraints](https://docs.pypsa.org/latest/user-guide/optimization/capacity-limits/)
- [Linear network power flow](https://docs.pypsa.org/latest/user-guide/optimization/power-flow/)
- [Storage energy balance](https://docs.pypsa.org/latest/user-guide/optimization/storage/)
- [Global emissions constraints](https://docs.pypsa.org/latest/user-guide/optimization/global-constraints/)
- [PyPSA research paper, Brown et al. (2018)](https://doi.org/10.5334/jors.188)

`sidecar/tests/test_planning.py` verifies analytical dispatch, added-capacity costs,
line bottlenecks/reinforcement, chronological storage losses, emissions constraints,
infeasibility, rejected inputs and the real sidecar JSON protocol using PyPSA/HiGHS.

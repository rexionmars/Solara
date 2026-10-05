import { defaults } from "../../lib/defaults"
import {
  FALLBACK_SEASONS,
  CONNECTION_FIELDS, DEMAND_FIELDS, GROUND_FIELDS,
  SOLAR_FIELDS,
  TERRAIN_FIELDS,
  WIND_FIELDS,
  fieldError,
  resetGroup,
  seasonLabel,
  setParam,
  windSettingsError,
  type Group,
  type NumberField as FieldDef,
} from "../../lib/params"
import { project } from "../../lib/project"
import { useStore } from "../../lib/store"
import { FieldRow, NumberField, Select } from "../ui/Fields"

/**
 * One product's settings as rows of drag fields. An empty field carries the
 * default the engine reported, in the muted colour; a set one is in the
 * foreground with a reset beside it.
 */

const FIELDS: Record<Group, FieldDef<string>[]> = {
  solar: SOLAR_FIELDS,
  wind: WIND_FIELDS,
  terrain: TERRAIN_FIELDS,
  connection: CONNECTION_FIELDS,
  demand: DEMAND_FIELDS,
  ground: GROUND_FIELDS,
}

export function ParamFields({ group }: { group: Group }) {
  const values = useStore(project).data.settings[group] as Record<string, number | string | undefined>
  const d = useStore(defaults)
  const crossError = group === "wind" ? windSettingsError(values) : null

  return (
    <div className="flex flex-col gap-1">
      {FIELDS[group].map((f) => (
        <FieldRow key={f.key} label={f.label} title={f.description}>
          <NumberField
            label={f.label}
            value={values[f.key] as number | undefined}
            fallback={d ? f.defaultOf(d) : undefined}
            step={f.step ?? (f.integer ? 1 : 0.1)}
            decimals={f.integer ? 0 : undefined}
            unit={f.unit}
            validate={(v) => fieldError(f, v)}
            onChange={(v) => setParam(group, f.key, v)}
          />
        </FieldRow>
      ))}
      {group === "terrain" && <SeasonRow />}
      {crossError && <p className="text-meta" style={{ color: "var(--warning)" }}>{crossError}.</p>}
      {Object.keys(values).length > 0 && (
        <button
          type="button"
          onClick={() => resetGroup(group)}
          className="self-end rounded-sm px-1.5 py-0.5 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          Back to the engine's defaults
        </button>
      )}
    </div>
  )
}

function SeasonRow() {
  const season = useStore(project).data.settings.terrain.season
  const d = useStore(defaults)
  const options = d?.terrain.seasons?.length ? d.terrain.seasons : FALLBACK_SEASONS
  const fallback = d ? seasonLabel(d.terrain.season) : "engine default"
  return (
    <FieldRow label="Window" title="The months the irradiation is summed over">
      <Select
        value={season ?? ""}
        ariaLabel="Window"
        onChange={(v) => setParam("terrain", "season", v || undefined)}
        options={[{ value: "", label: `Default (${fallback})` }, ...options.map((id) => ({ value: id, label: seasonLabel(id) }))]}
      />
    </FieldRow>
  )
}

import { useEffect, useState } from "react"
import { Gear, Info, Keyboard, User } from "@phosphor-icons/react"
import { GetAppVersion } from "../../../wailsjs/go/main/App"
import { BRAND_TAGLINE, RELEASE_NAME } from "../../lib/brand"
import { defaults, loadDefaults } from "../../lib/defaults"
import { formatKeys, OPERATORS, type Scope } from "../../lib/operators"
import { SOLAR_FIELDS, TERRAIN_FIELDS, WIND_FIELDS, seasonLabel } from "../../lib/params"
import { sidecar } from "../../lib/sidecarStatus"
import { useStore } from "../../lib/store"
import { preferences, type PreferencesSection } from "../../lib/ui"
import { AccountDocument } from "../account/AccountDocument"
import { fieldInput } from "../ui/buttons"
import { Figure, OperatorButton, PanelSection } from "../ui/Fields"
import { DialogHead, ModalShell } from "./Dialogs"

const SECTIONS: { id: PreferencesSection; label: string; icon: typeof Gear }[] = [
  { id: "account", label: "Account", icon: User },
  { id: "engine", label: "Engine", icon: Gear },
  { id: "keymap", label: "Keymap", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
]

function EngineSection() {
  const s = useStore(sidecar)
  const d = useStore(defaults)
  useEffect(() => {
    if (s.kind === "ready" && !d) void loadDefaults()
  }, [s.kind, d])
  return (
    <>
      <PanelSection title="Calculation engine" aside={<OperatorButton name="PING" label="Check" />}>
        <Figure
          label="Status"
          value={
            <span style={{ color: s.kind === "failed" ? "var(--destructive-quiet)" : s.kind === "ready" ? "var(--success)" : undefined }}>
              {s.kind === "ready" ? "ready" : s.kind === "failed" ? "unavailable" : "starting"}
            </span>
          }
        />
        {s.kind === "ready" && <Figure label="Python" value={s.version} />}
        {s.kind !== "checking" && s.python && <Figure label="Interpreter" value={s.python} />}
        {s.kind === "failed" && <p className="selectable whitespace-pre-wrap text-meta text-destructive-quiet">{s.message}</p>}
      </PanelSection>
      <PanelSection title="Defaults the engine applies">
        <p className="text-body leading-relaxed text-muted-foreground">
          What a setting left empty is computed with. Read from the engine, so these are the values it actually uses.
        </p>
        {!d ? (
          <p className="text-meta text-muted-foreground">{s.kind === "ready" ? "Reading…" : "Available once the engine is ready."}</p>
        ) : (
          [
            { title: "Solar resource", fields: SOLAR_FIELDS },
            { title: "Wind screening", fields: WIND_FIELDS },
            { title: "Solar terrain", fields: TERRAIN_FIELDS },
          ].map((g) => (
            <div key={g.title} className="pt-1">
              <p className="eyebrow !text-[9px] pb-0.5 !text-foreground">{g.title}</p>
              {g.fields.map((f) => (
                <Figure key={f.key} label={f.label} title={f.description} value={`${f.defaultOf(d) ?? "—"}${f.unit ? ` ${f.unit}` : ""}`} />
              ))}
              {g.title === "Solar terrain" && <Figure label="Window" value={seasonLabel(d.terrain.season)} />}
            </div>
          ))
        )}
      </PanelSection>
    </>
  )
}

const SCOPE_NAMES: Record<Scope, string> = { window: "Anywhere", map: "Map", objects: "Map, Outliner", outliner: "Outliner" }

function KeymapSection() {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const rows = OPERATORS.filter((o) => !q || `${o.label} ${o.name} ${o.menu} ${o.keys?.join(" ") ?? ""}`.toLowerCase().includes(q))
  return (
    <PanelSection title="Keymap">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name or key" aria-label="Filter the keymap" className={fieldInput} />
      <p className="text-meta text-muted-foreground">
        Keys under Map or Outliner work with the pointer over that editor. Every operator can also be typed in the Console by its name.
      </p>
      <table className="w-full text-meta">
        <thead className="text-left">
          <tr className="eyebrow !text-[9px]">
            <th className="py-1 font-normal">Operator</th>
            <th className="py-1 font-normal">Keys</th>
            <th className="py-1 font-normal">Where</th>
            <th className="py-1 font-normal">Console</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.name} className="border-t" style={{ borderColor: "var(--hairline)" }} title={o.description}>
              <td className="py-1 pr-2 text-foreground">{o.label}</td>
              <td className="py-1 pr-2">
                {o.keys?.map((k) => (
                  <span key={k} className="telemetry mr-1 rounded-[2px] px-1 text-foreground" style={{ background: "rgb(var(--p-line) / 0.28)" }}>
                    {formatKeys(k)}
                  </span>
                ))}
              </td>
              <td className="py-1 pr-2 text-muted-foreground">{o.keys?.length ? SCOPE_NAMES[o.scope ?? "window"] : ""}</td>
              <td className="telemetry selectable py-1 text-muted-foreground">{o.usage ?? o.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PanelSection>
  )
}

function AboutSection() {
  const [version, setVersion] = useState("")
  useEffect(() => {
    GetAppVersion()
      .then(setVersion)
      .catch(() => {})
  }, [])
  return (
    <>
      <div className="flex items-center gap-3 px-2.5 py-4">
        <img src="/terra-logo.png" alt="" className="size-10 object-contain" />
        <div>
          <p className="font-display text-heading font-semibold tracking-[0.14em]">TERRA</p>
          <p className="eyebrow">{BRAND_TAGLINE}</p>
          <p className="telemetry mt-0.5 text-meta text-muted-foreground">
            {RELEASE_NAME}
            {version && ` · ${version}`}
          </p>
        </div>
      </div>
      <PanelSection title="Data sources">
        <Figure label="Irradiation, wind" value="NASA POWER, MERRA-2" />
        <Figure label="Terrain" value="Copernicus DEM GLO-30" />
        <Figure label="Photovoltaic model" value="pvlib" />
        <Figure label="Basemap" value="OpenFreeMap, © OpenStreetMap" />
        <p className="pt-1 text-body leading-relaxed text-muted-foreground">
          Screening figures. The wind results are gross and unvalidated; read each result's notes before using a figure.
        </p>
      </PanelSection>
    </>
  )
}

/** Settings, one dialog: the sections on the left, the section on the right. */
export function Settings() {
  const section = useStore(preferences)
  if (!section) return null
  const close = () => preferences.set(null)
  return (
    <ModalShell label="Settings" onDismiss={close} className="h-[min(36rem,85vh)] w-[min(46rem,calc(100vw-2rem))]">
      <DialogHead eyebrow="TERRA Energy Engine" title="Settings" onDismiss={close} />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r p-2" style={{ borderColor: "var(--hairline)" }} aria-label="Settings sections">
          {SECTIONS.map((s) => {
            const on = s.id === section
            return (
              <button
                key={s.id}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => preferences.set(s.id)}
                className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body transition-colors ${
                  on ? "text-foreground" : "text-muted-foreground hover:bg-control hover:text-foreground"
                }`}
                style={on ? { background: "color-mix(in srgb, rgb(var(--p-accent)) 45%, transparent)" } : undefined}
              >
                <s.icon className="size-3.5" />
                {s.label}
              </button>
            )
          })}
        </nav>
        <div className="panel-scroll min-w-0 flex-1 overflow-y-auto">
          {section === "account" && <AccountDocument />}
          {section === "engine" && <EngineSection />}
          {section === "keymap" && <KeymapSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </ModalShell>
  )
}

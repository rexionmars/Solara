import { useEffect, useState } from "react"
import { Database, Gear, Info, Keyboard, User } from "@phosphor-icons/react"
import { GetAppVersion } from "../../../wailsjs/go/main/App"
import { BRAND_TAGLINE, RELEASE_NAME } from "../../lib/brand"
import { defaults, loadDefaults } from "../../lib/defaults"
import { formatKeys, OPERATORS, type Scope } from "../../lib/operators"
import { SOLAR_FIELDS, TERRAIN_FIELDS, WIND_FIELDS, seasonLabel } from "../../lib/params"
import { checkGridStore, chooseGridStore, dsnSourceLabel, forgetLayers, gridStore, storeReport } from "../../lib/grid"
import { sidecar } from "../../lib/sidecarStatus"
import { useStore } from "../../lib/store"
import { preferences, type PreferencesSection } from "../../lib/ui"
import { AccountDocument } from "../account/AccountDocument"
import { btnGhostDense, btnPrimary, fieldInput } from "../ui/buttons"
import { Figure, OperatorButton, PanelSection } from "../ui/Fields"
import { DialogHead, ModalShell } from "./Dialogs"

const SECTIONS: { id: PreferencesSection; label: string; icon: typeof Gear }[] = [
  { id: "account", label: "Account", icon: User },
  { id: "engine", label: "Engine", icon: Gear },
  { id: "grid", label: "Grid store", icon: Database },
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

/**
 * The grid store: which database the grid products read, where that choice
 * came from, and what it holds. TERRA shows this without a way to change it;
 * here the DSN is typed, checked and saved in one place, and a store that does
 * not answer is refused rather than saved.
 */
function GridSection() {
  const s = useStore(gridStore)
  const engine = useStore(sidecar)
  const report = storeReport(s)
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => {
    if (engine.kind === "ready" && gridStore.get().kind === "unknown") void checkGridStore()
  }, [engine.kind])
  const checking = s.kind === "checking"
  const c = report?.coverage
  const save = async (dsn: string) => {
    if (await chooseGridStore(dsn)) {
      setDraft(null)
      // The layers were read from the store that was chosen before.
      forgetLayers()
    }
  }

  return (
    <>
      <PanelSection
        title="Grid store"
        aside={
          <button type="button" className={btnGhostDense} disabled={checking} onClick={() => void checkGridStore(true)}>
            {checking ? "Checking…" : "Check"}
          </button>
        }
      >
        <p className="text-body leading-relaxed text-muted-foreground">
          The Brazilian electrical record in a local PostgreSQL database with PostGIS, loaded by TERRA: the ANEEL plant register, the ONS
          transmission register and what each plant was told not to generate. The grid layers and the connection reading are read from it.
        </p>
        <Figure
          label="Status"
          value={
            <span style={{ color: report ? (report.reachable ? "var(--success)" : "var(--destructive-quiet)") : undefined }}>
              {checking ? "checking" : report ? (report.reachable ? "reachable" : "unreachable") : s.kind === "failed" ? "not checked" : "unknown"}
            </span>
          }
        />
        {report && <Figure label="Connection" value={report.dsn} />}
        {report && <Figure label="Chosen by" value={dsnSourceLabel(report.dsn_source)} />}
        {report?.unreachable && <p className="selectable whitespace-pre-wrap text-meta text-destructive-quiet">{report.unreachable}</p>}
        {s.kind === "failed" && <p className="selectable whitespace-pre-wrap text-meta text-destructive-quiet">{s.message}</p>}
      </PanelSection>

      <PanelSection title="Choose a store">
        {report?.dsn_source === "TERRA_BR_DSN" && (
          <p className="text-meta leading-relaxed" style={{ color: "var(--warning)" }}>
            TERRA_BR_DSN is set in this application's environment, and it is what is read. A store chosen here is kept for when it is not.
          </p>
        )}
        <input
          // Never prefilled with a masked password: saving "***" back would replace the real one.
          value={draft ?? (report?.dsn_source === "chosen" && !report.dsn.includes("***") ? report.dsn : "")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter" && draft !== null) void save(draft)
          }}
          placeholder="postgresql:///terra_br"
          aria-label="Grid store connection"
          spellCheck={false}
          className={`${fieldInput} telemetry`}
        />
        <p className="text-meta leading-relaxed text-muted-foreground">
          A PostgreSQL connection string. Empty is the default: the local socket, database terra_br, your own role. A password is kept in a
          file only you can read, and never shown.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btnPrimary} disabled={checking || draft === null} onClick={() => draft !== null && void save(draft)}>
            Check and save
          </button>
          {report?.dsn_source === "chosen" && (
            <button type="button" className={btnGhostDense} disabled={checking} onClick={() => void save("")}>
              Use the default
            </button>
          )}
        </div>
      </PanelSection>

      {report?.reachable && c && (
        <PanelSection title="What it holds">
          <Figure label="Plants registered" value={c.plants.registered.toLocaleString()} />
          <Figure label="Located" value={c.plants.with_geometry.toLocaleString()} />
          <Figure label="Substations" value={c.network.substations.toLocaleString()} />
          <Figure label="Lines in service" value={c.network.lines_in_service.toLocaleString()} />
          {c.datasets.map((ds) => (
            <Figure
              key={ds.dataset}
              label={ds.dataset}
              title={`${ds.periods} periods, loaded ${ds.loaded_utc}`}
              value={`${ds.from} to ${ds.to} · ${ds.rows.toLocaleString()} rows`}
            />
          ))}
          {c.load_conflicts.total > 0 && (
            <p className="text-meta leading-relaxed text-muted-foreground">
              {c.load_conflicts.total} load conflicts, {c.load_conflicts.identical} identical. {c.load_conflicts.note}
            </p>
          )}
        </PanelSection>
      )}
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
        <Figure label="Electrical system" value="ONS, ANEEL (grid store)" />
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
          {section === "grid" && <GridSection />}
          {section === "keymap" && <KeymapSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </ModalShell>
  )
}

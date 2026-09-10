import { useEffect, useState, type ReactNode } from "react"
import { BASEMAP_MAX_ZOOM, BASEMAP_NAME } from "../../lib/basemap"
import { runCommand } from "../../lib/commands"
import { solarParams, windParams, type SolarParams, type WindParams } from "../../lib/energyParams"
import { formatLat, formatLng } from "../../lib/format"
import { mapView } from "../../lib/mapController"
import { sidecar } from "../../lib/sidecarStatus"
import { site } from "../../lib/site"
import { useStore, type Store } from "../../lib/store"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="border-y border-line bg-raised px-3 py-1 text-xs text-ink/90">{title}</h3>
      <dl className="flex flex-col gap-px py-1">{children}</dl>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[112px_1fr] items-center gap-2 px-2 py-0.5">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd
        className="truncate rounded-sm border border-line bg-sunken px-2 py-1 font-mono text-[11px] text-ink"
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

function parse(text: string): number | undefined {
  return text.trim() === "" ? undefined : Number(text)
}

/**
 * A number the user may set, or leave empty for the sidecar's default.
 *
 * The field keeps what was typed. It is re-seeded only when the stored value
 * stops matching it, so a value cleared elsewhere shows here without "0.50"
 * collapsing to "0.5" under the cursor.
 */
function NumberRow<T extends object>({
  store,
  field,
  label,
  unit,
  step = "any",
}: {
  store: Store<T>
  field: keyof T & string
  label: string
  unit?: string
  step?: number | "any"
}) {
  const value = useStore(store)[field] as number | undefined
  const [text, setText] = useState(value === undefined ? "" : String(value))

  useEffect(() => {
    if (parse(text) !== value) setText(value === undefined ? "" : String(value))
    // `text` is read, not tracked: this runs when the store changes.
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid grid-cols-[112px_1fr] items-center gap-2 px-2 py-0.5">
      <label className="truncate text-xs text-muted" htmlFor={`param-${field}`}>
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-1">
        <input
          id={`param-${field}`}
          type="number"
          step={step}
          value={text}
          placeholder="default"
          onChange={(e) => {
            const t = e.target.value
            setText(t)
            const n = parse(t)
            if (n === undefined || Number.isFinite(n)) store.set((p) => ({ ...p, [field]: n }))
          }}
          className="w-full min-w-0 rounded-sm border border-line bg-sunken px-2 py-1 font-mono text-[11px] text-ink outline-none placeholder:text-muted/50 focus:border-accent"
        />
        {unit && <span className="w-9 shrink-0 text-[10px] text-muted">{unit}</span>}
      </div>
    </div>
  )
}

function SiteSection() {
  const { point, picking } = useStore(site)
  return (
    <Section title="Site">
      {point ? (
        <>
          <Row label="Latitude" value={formatLat(point.lat)} />
          <Row label="Longitude" value={formatLng(point.lon)} />
        </>
      ) : (
        <p className="px-3 py-1 text-xs text-muted">{picking ? "Click the map…" : "No site set."}</p>
      )}
      <div className="px-2 pt-1">
        <button
          type="button"
          onClick={() => void runCommand("SITE")}
          className="w-full rounded-sm border border-line bg-raised px-2 py-1 text-xs text-ink hover:bg-hover"
        >
          {point ? "Move site" : "Pick on map"}
        </button>
      </div>
    </Section>
  )
}

function ViewSection() {
  const v = useStore(mapView)
  return (
    <Section title="View">
      <Row label="Center latitude" value={formatLat(v.lat)} />
      <Row label="Center longitude" value={formatLng(v.lng)} />
      <Row label="Zoom" value={v.zoom.toFixed(2)} />
      <Row label="Bearing" value={`${v.bearing.toFixed(1)}°`} />
      <Row label="Pitch" value={`${v.pitch.toFixed(1)}°`} />
    </Section>
  )
}

function SidecarSection() {
  const s = useStore(sidecar)
  const status = s.kind === "ready" ? "Ready" : s.kind === "failed" ? "Unavailable" : "Checking…"
  return (
    <Section title="Sidecar">
      <Row label="Status" value={status} />
      {s.kind === "ready" && <Row label="Python" value={s.version} />}
      {s.kind !== "checking" && s.python && <Row label="Interpreter" value={s.python} />}
      {s.kind === "failed" && <Row label="Reason" value={s.message} />}
    </Section>
  )
}

/**
 * What is selected, and its attributes, followed by the parameters of the
 * energy products. Nothing on the map is selectable yet, so the panel reports
 * the site, the view, the basemap and the sidecar.
 */
export function PropertiesPanel() {
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-panel pb-3">
      <h2 className="px-3 py-2 text-sm text-ink">Properties</h2>
      <p className="border-t border-line px-3 py-1.5 text-xs text-muted">No selection</p>
      <SiteSection />
      <Section title="Solar resource">
        <NumberRow<SolarParams> store={solarParams} field="climatologyYears" label="Climatology" unit="yr" step={1} />
        <NumberRow<SolarParams> store={solarParams} field="hourlyYears" label="Hourly record" unit="yr" step={1} />
        <NumberRow<SolarParams> store={solarParams} field="surfaceAzimuth" label="Surface azimuth" unit="° N" />
        <NumberRow<SolarParams> store={solarParams} field="performanceRatio" label="Perf. ratio" unit="0–1" step={0.01} />
      </Section>
      <Section title="Wind screening">
        <NumberRow<WindParams> store={windParams} field="recordYears" label="Record" unit="yr" step={1} />
        <NumberRow<WindParams> store={windParams} field="hubHeightM" label="Hub height" unit="m" />
        <NumberRow<WindParams> store={windParams} field="calmThresholdMS" label="Calm threshold" unit="m/s" />
        <NumberRow<WindParams> store={windParams} field="recordMaxFloorMS" label="Max. floor" unit="m/s" />
        <NumberRow<WindParams> store={windParams} field="roughnessLowM" label="Roughness low" unit="m" />
        <NumberRow<WindParams> store={windParams} field="roughnessHighM" label="Roughness high" unit="m" />
      </Section>
      <p className="px-3 pt-1 text-[10px] leading-snug text-muted">
        An empty field uses the sidecar's default. Each result states the values it was computed with.
      </p>
      <ViewSection />
      <Section title="Basemap">
        <Row label="Source" value={BASEMAP_NAME} />
        <Row label="Maximum zoom" value={String(BASEMAP_MAX_ZOOM)} />
      </Section>
      <SidecarSection />
    </aside>
  )
}

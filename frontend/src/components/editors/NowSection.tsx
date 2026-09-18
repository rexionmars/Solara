import { ArrowsClockwise } from "@phosphor-icons/react"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import { project, resultsOf } from "../../lib/project"
import { useStore } from "../../lib/store"
import { ageLabel, nowOf, refreshNow, useNow, type Now } from "../../lib/weather"
import { Figure, PanelSection } from "../ui/Fields"

/**
 * The conditions at a site or an area now, as a short-range model has them,
 * beside what the long-term products say is usual there.
 *
 * MODELLED, AND SAID SO. Open-Meteo's current values are the first step of a
 * forecast, not an instrument's reading; the section carries the word, and
 * the comparison is drawn only against figures of the same kind: today's
 * modelled irradiation against the long-term daily mean, the wind at 120 m now
 * against the long-term mean at hub height.
 */

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
const fmt = (v: number | null, digits = 0, unit = "") => (v === null ? "—" : `${v.toFixed(digits)}${unit ? ` ${unit}` : ""}`)

/** The next day as a line, scaled to its own peak: a shape to read, not figures to take off. */
function Spark({ values, label, colour }: { values: (number | null)[]; label: string; colour: string }) {
  const w = 220
  const h = 30
  const finite = values.map((v) => v ?? 0)
  const peak = Math.max(...finite, 0)
  if (!values.length || peak <= 0) return null
  const step = w / Math.max(1, values.length - 1)
  const points = finite.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / peak) * (h - 2) - 1).toFixed(1)}`).join(" ")
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow !text-[9px]">{label}</span>
        <span className="telemetry text-[9px] text-muted-foreground">peak {peak.toFixed(peak < 20 ? 1 : 0)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" preserveAspectRatio="none" aria-label={`${label}, next 24 hours`}>
        <polyline points={`0,${h} ${points} ${w},${h}`} fill={colour} fillOpacity={0.14} stroke="none" />
        <polyline points={points} fill="none" stroke={colour} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

function Comparison({ now, sourceId }: { now: Now; sourceId: string }) {
  const d = useStore(project).data
  const results = resultsOf(d, sourceId)
  const solar = results.filter((r) => r.kind === "solar").at(-1)
  const wind = results.filter((r) => r.kind === "wind").at(-1)
  if (solar?.kind !== "solar" && wind?.kind !== "wind") return null
  return (
    <div className="flex flex-col gap-px border-t pt-1.5" style={{ borderColor: "var(--hairline)" }}>
      <p className="eyebrow !text-[9px] !text-foreground">Against the long-term reading</p>
      {solar?.kind === "solar" && (
        <>
          <Figure label="Today, modelled" value={fmt(now.todayKwhM2, 2, "kWh/m²")} />
          <Figure
            label="Long-term daily mean"
            title={`${solar.name}: annual GHI over 365 days`}
            value={fmt(solar.data.resource.ghi_annual_kwh_m2 / 365, 2, "kWh/m²")}
          />
        </>
      )}
      {wind?.kind === "wind" && (
        <>
          <Figure label="At 120 m now" value={fmt(now.wind120, 1, "m/s")} />
          <Figure
            label={`Long-term mean at ${wind.data.hub_height_m.toFixed(0)} m`}
            title={`${wind.name}: hub-height mean over the record`}
            value={fmt(wind.data.hub.mean_speed_ms, 1, "m/s")}
          />
        </>
      )}
    </div>
  )
}

export function NowSection({ lat, lon, sourceId }: { lat: number; lon: number; sourceId: string }) {
  const state = useNow(lat, lon)
  const now = nowOf(state)
  const loading = !state || state.kind === "loading"

  return (
    <PanelSection
      title="Now"
      aside={
        <>
          <span className="telemetry text-[9px] text-muted-foreground" title="The first step of a forecast model, not a measurement">
            modelled
          </span>
          <button
            type="button"
            onClick={() => void refreshNow(lat, lon, true)}
            disabled={loading}
            aria-label="Refresh"
            title="Ask again"
            className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40"
          >
            <ArrowsClockwise className={`size-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </>
      }
    >
      {state?.kind === "failed" && (
        <p className="text-meta leading-relaxed text-destructive-quiet">
          Not read: {state.message}.{now ? " The values below are from the last reading." : ""}
        </p>
      )}
      {!now ? (
        state?.kind !== "failed" && <p className="text-meta text-muted-foreground">Reading the conditions…</p>
      ) : (
        <>
          <p className="telemetry text-[9px] text-muted-foreground">
            {now.time.replace("T", " ")} {now.timezone} · read {ageLabel(now.fetched)}
          </p>
          <Figure label="Irradiance, horizontal" value={fmt(now.ghi, 0, "W/m²")} />
          <Figure label="Direct normal" value={fmt(now.dni, 0, "W/m²")} />
          <Figure label="Diffuse" value={fmt(now.dhi, 0, "W/m²")} />
          <Figure label="Cloud cover" value={fmt(now.cloudCoverPct, 0, "%")} />
          <Figure label="Temperature" value={fmt(now.temperatureC, 1, "°C")} />
          <Figure
            label="Wind at 10 m"
            value={`${fmt(now.wind10, 1, "m/s")}${now.windDirection10 === null ? "" : ` ${compass(now.windDirection10)}`}${now.gust10 === null ? "" : ` · gusts ${now.gust10.toFixed(1)}`}`}
          />
          <Figure label="Wind at 80 / 120 m" value={`${fmt(now.wind80, 1)} / ${fmt(now.wind120, 1, "m/s")}`} />
          <div className="flex flex-col gap-1.5 pt-1">
            <Spark label="Irradiance, next 24 h" values={now.hours.map((h) => h.ghi)} colour="rgb(var(--p-kind-solar))" />
            <Spark label="Wind at 120 m, next 24 h" values={now.hours.map((h) => h.wind120)} colour="rgb(var(--p-kind-wind))" />
          </div>
          <Comparison now={now} sourceId={sourceId} />
        </>
      )}
      <button
        type="button"
        onClick={() => BrowserOpenURL("https://open-meteo.com/")}
        className="self-start text-[9px] text-muted-foreground hover:text-foreground hover:underline"
      >
        Weather data by Open-Meteo.com · needs the internet
      </button>
    </PanelSection>
  )
}

import { useEffect, useRef, useState, type ReactNode } from "react"
import { CaretLeft, CaretRight, Pause, Play, SkipBack, SkipForward } from "../../lib/icons"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import { useStore } from "../../lib/store"
import { overlays } from "../../lib/tools"
import {
  SATELLITE,
  WIND_STOPS,
  ageLabel,
  clockLabel,
  fieldOf,
  refreshRadar,
  refreshSatellite,
  refreshWind,
  setMoment,
  setOpacity,
  setPlaying,
  setSatelliteProduct,
  setWindHeight,
  tilesFailing,
  timelineTimes,
  weather,
  windField,
  type LayerFrames,
  type SatelliteProduct,
} from "../../lib/weather"

/**
 * The weather's timeline, under the map while a weather layer is on: a
 * transport, a ruler of the hours the frames cover, and a row per layer with
 * a mark at every frame it holds, in the grammar of Blender's timeline.
 *
 * IT IS THE WHOLE OF THE WEATHER'S CONTROLS. They were a plate over a corner
 * of the map: the moment, each layer's hour, how it is drawn, and where it
 * comes from. The moment shown is a property of what the map is drawing, so
 * it sits under the map and takes no ground from it, and everything else the
 * plate said is on the row of the layer it is about.
 *
 * A ROW PER LAYER, BECAUSE THEY DO NOT SHARE THEIR FRAMES. The clouds and the
 * rain are each ten minutes apart but not on the same minutes, and the wind is
 * one modelled hour, not a sequence. A single ruler would say they move
 * together; the rows show which layer has a frame at the playhead and which is
 * holding its last one.
 *
 * THE AGE IS WRITTEN, NOT IMPLIED. The satellite is published about forty
 * minutes late and the radar about ten, so "now" on this map is a different
 * moment for each layer, and the header says how old the one shown is.
 *
 * THE LAST FRAME IS "LATEST", NOT A TIME. Stopping there follows the newest
 * frame as it arrives, which is what a reader watching the weather wants.
 */

const STEP_MS = 700
const LABEL_W = 56
const DETAIL_W = 300
const PAD = 14
const ROW = "h-[18px]"

const framesOf = (s: LayerFrames) => (s.kind === "idle" ? [] : s.frames)

/** A run time as the hour it names, in UTC, the way model runs are called. */
const utcHour = (iso: string) => `${iso.slice(11, 13)}Z`

const WIND_SCALE = `linear-gradient(to right, ${WIND_STOPS.map(([s, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${(s / 32) * 100}%`).join(", ")})`

function Transport({ icon: IconC, label, onClick, disabled, on }: { icon: typeof Play; label: string; onClick: () => void; disabled?: boolean; on?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-[18px] w-6 place-items-center transition-colors disabled:opacity-40 ${
        on ? "bg-accent text-accent-foreground" : "text-foreground/85 hover:bg-hover hover:text-foreground"
      }`}
    >
      <IconC className="size-3" weight="fill" />
    </button>
  )
}

/** One of a row's choices: the satellite's product, the wind's height. */
function Choice({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={`shrink-0 rounded-sm px-1.5 text-micro leading-[14px] transition-colors ${
        on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

function Credit({ label, href }: { label: string; href: string }) {
  // A button calling BrowserOpenURL: an anchor with a blank target opens nothing in this webview.
  return (
    <button type="button" onClick={() => BrowserOpenURL(href)} className="shrink-0 hover:text-foreground hover:underline">
      {label}
    </button>
  )
}

/** A layer that could not be read: that it could not, why as the tooltip, and a way to ask again. */
function Failed({ message, retry }: { message: string; retry: () => void }) {
  return (
    <>
      <span className="min-w-0 truncate text-micro text-destructive-quiet" title={message}>
        unavailable
      </span>
      <button type="button" onClick={retry} className="shrink-0 text-micro text-accent hover:underline">
        Retry
      </button>
    </>
  )
}

type Row = { label: string; marks: number[]; colour: string; detail: ReactNode }

export function WeatherTimeline() {
  const o = useStore(overlays)
  const w = useStore(weather)
  const { height, state: windState } = useStore(windField)
  const wind = fieldOf(windState)
  const dragging = useRef(false)
  const [, tick] = useState(0)

  const observed = o.weatherSatellite || o.weatherRadar
  const windAt = wind ? Date.parse(wind.valid) : null
  // With no observed layer the ruler has one moment on it, the wind's own.
  const times = observed ? timelineTimes(w, o.weatherSatellite, o.weatherRadar) : windAt !== null && o.weatherWind ? [windAt] : []
  const last = times.length - 1
  const index = w.at === null ? last : Math.max(0, times.findIndex((t) => t >= w.at!))

  // Ages are relative to the clock, so they are redrawn as it moves.
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // The timer is the timeline's: it runs for as long as there is a moment to move.
  useEffect(() => {
    if (!w.playing) return
    const timer = window.setInterval(() => {
      const s = weather.get()
      const all = timelineTimes(s, overlays.get().weatherSatellite, overlays.get().weatherRadar)
      if (!all.length) return
      const at = s.at === null ? all[all.length - 1] : s.at
      const i = all.findIndex((t) => t > at)
      setMoment(i < 0 ? all[0] : all[i])
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [w.playing])

  if (!o.weatherSatellite && !o.weatherRadar && !o.weatherWind) return null

  const start = times[0] ?? 0
  const end = times[last] ?? 0
  const span = Math.max(1, end - start)
  const x = (t: number) => `${((t - start) / span) * 100}%`
  const now = times[index]
  const ready = observed && times.length > 1

  const go = (i: number) => {
    setPlaying(false)
    const to = Math.max(0, Math.min(last, i))
    setMoment(to >= last ? null : times[to])
  }

  /** The frame nearest the pointer, along the track's own width. */
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ready) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = start + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * span
    let best = 0
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i
    go(best)
  }

  const rows: Row[] = []
  if (o.weatherSatellite) {
    rows.push({
      label: "Clouds",
      marks: framesOf(w.satellite).map((f) => f.time),
      colour: "rgb(var(--p-text))",
      detail: (
        <>
          {(Object.keys(SATELLITE) as SatelliteProduct[]).map((p) => (
            <Choice
              key={p}
              on={w.product === p}
              onClick={() => setSatelliteProduct(p)}
              title={p === "geocolor" ? "True colour by day, infrared by night" : "Infrared day and night: clouds read the same at any hour"}
            >
              {SATELLITE[p].label}
            </Choice>
          ))}
          {w.satellite.kind === "failed" && <Failed message={w.satellite.message} retry={() => void refreshSatellite()} />}
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={w.satelliteOpacity}
            aria-label="Cloud layer opacity"
            title="Cloud layer opacity"
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => setOpacity("satellite", Number(e.target.value))}
            className="ml-auto h-3 w-16 shrink-0 accent-[rgb(var(--p-accent))]"
          />
        </>
      ),
    })
  }
  if (o.weatherRadar) {
    rows.push({
      label: "Rain",
      marks: framesOf(w.radar).map((f) => f.time),
      colour: "rgb(var(--p-accent))",
      detail:
        w.radar.kind === "failed" ? (
          <Failed message={w.radar.message} retry={() => void refreshRadar()} />
        ) : (
          <span
            className="min-w-0 truncate text-micro text-muted-foreground"
            title="Radar reaches where Brazil's radars do: dense in the South and Southeast, sparse inland in the Northeast. No colour where there is no radar is not no rain."
          >
            no colour where there is no radar is not no rain
          </span>
        ),
    })
  }
  if (o.weatherWind) {
    rows.push({
      label: "Wind",
      // One modelled hour, marked where it falls among the frames; outside them it has no place on this ruler.
      marks: windAt !== null && windAt >= start && windAt <= end ? [windAt] : [],
      colour: "var(--warning)",
      detail: (
        <>
          {([10, 100] as const).map((h) => (
            <Choice
              key={h}
              on={height === h}
              onClick={() => setWindHeight(h)}
              title={h === 10 ? "At 10 m, the height stations measure at" : "At 100 m, near a turbine's hub"}
            >
              {h} m
            </Choice>
          ))}
          {windState.kind === "failed" ? (
            <Failed message={windState.message} retry={() => void refreshWind()} />
          ) : (
            <span className="telemetry min-w-0 truncate text-[9px] text-muted-foreground" title="A forecast from a model run, not a measurement">
              {wind ? (
                <>
                  <span className="text-foreground">valid {clockLabel(Date.parse(wind.valid))}</span> · GFS {wind.run ? utcHour(wind.run) : "run unknown"}
                  {windState.kind === "loading" ? " · updating" : " · modelled"}
                </>
              ) : (
                "reading…"
              )}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1" title="The wind's colours: 0 to 32 m/s">
            <span className="telemetry text-[9px] text-muted-foreground">0</span>
            <span className="h-1.5 w-14 rounded-[1px]" style={{ background: WIND_SCALE }} />
            <span className="telemetry text-[9px] text-muted-foreground">32 m/s</span>
          </span>
        </>
      ),
    })
  }

  const refused = (["satellite", "radar"] as const).some((l) => (l === "satellite" ? o.weatherSatellite : o.weatherRadar) && tilesFailing(w, l))
  // Every frame is a tick; a label on every other one, so twelve of them do not run together.
  const every = times.length > 8 ? 2 : 1

  return (
    <div className="shrink-0 select-none border-t" style={{ background: "var(--s-panel)", borderColor: "rgb(var(--p-line) / 0.4)" }}>
      <div className="flex h-6 items-center gap-2 px-2" style={{ background: "var(--s-panel-head)" }}>
        <span className="eyebrow !text-[9px] shrink-0">Weather now</span>
        <span
          className="telemetry shrink-0 text-[9px] text-muted-foreground"
          title={observed ? "Measured by satellite and radar, not modelled" : "A forecast from a model run, not a measurement"}
        >
          {observed ? "observed" : "modelled"}
        </span>
        <span className="flex-1" />
        {observed && (
          <div className="flex overflow-hidden rounded-sm" style={{ background: "var(--s-control)" }}>
            <Transport icon={SkipBack} label="First frame" onClick={() => go(0)} disabled={!ready || index === 0} />
            <Transport icon={CaretLeft} label="Previous frame" onClick={() => go(index - 1)} disabled={!ready || index === 0} />
            <Transport
              icon={w.playing ? Pause : Play}
              label={w.playing ? "Pause" : "Play the last two hours"}
              onClick={() => setPlaying(!w.playing)}
              disabled={!ready}
              on={w.playing}
            />
            <Transport icon={CaretRight} label="Next frame" onClick={() => go(index + 1)} disabled={!ready || index >= last} />
            <Transport icon={SkipForward} label="Latest: follow the newest frame" onClick={() => go(last)} disabled={!ready || w.at === null} />
          </div>
        )}
        <span className="flex-1" />
        {ready ? (
          <span className="telemetry flex shrink-0 items-baseline gap-2 text-[9px] text-muted-foreground">
            <span className="rounded-sm px-1.5 py-px text-foreground" style={{ background: "var(--s-control)" }}>
              {clockLabel(now)}
            </span>
            <span>{ageLabel(now)}</span>
            <span>
              Start <span className="text-foreground">{clockLabel(start)}</span>
            </span>
            <span>
              End <span className="text-foreground">{clockLabel(end)}</span>
            </span>
          </span>
        ) : (
          observed && <span className="telemetry shrink-0 text-[9px] text-muted-foreground">reading the frames…</span>
        )}
      </div>

      <div className="flex" style={{ background: "var(--s-sunk)" }}>
        <div className="shrink-0" style={{ width: LABEL_W }}>
          <p className={ROW} />
          {rows.map((r) => (
            <p key={r.label} className={`${ROW} truncate px-2 text-micro leading-[18px] text-muted-foreground`}>
              {r.label}
            </p>
          ))}
        </div>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Moment shown"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, last)}
          aria-valuenow={Math.max(0, index)}
          aria-valuetext={times.length ? clockLabel(now) : undefined}
          className={`relative min-w-0 flex-1 outline-none ${ready ? "cursor-ew-resize" : ""}`}
          style={{ paddingInline: PAD }}
          onKeyDown={(e) => {
            if (!ready) return
            if (e.key === "ArrowLeft") go(index - 1)
            else if (e.key === "ArrowRight") go(index + 1)
            else if (e.key === "Home") go(0)
            else if (e.key === "End") go(last)
            else if (e.key === " ") setPlaying(!w.playing)
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {/* The pointer is read against the inner width, where the frames are laid out, not the padded one. */}
          <div
            className="relative"
            onPointerDown={(e) => {
              if (e.button !== 0 || !ready) return
              e.currentTarget.setPointerCapture(e.pointerId)
              dragging.current = true
              scrub(e)
            }}
            onPointerMove={(e) => {
              if (dragging.current) scrub(e)
            }}
            onPointerUp={() => {
              dragging.current = false
            }}
            onPointerCancel={() => {
              dragging.current = false
            }}
          >
            <div className={`relative ${ROW} border-b`} style={{ borderColor: "rgb(var(--p-line) / 0.3)" }}>
              {times.map((t, i) => (
                <span key={t} className="absolute bottom-0 top-0" style={{ left: x(t) }}>
                  <span className="absolute bottom-0 h-1 w-px" style={{ background: "rgb(var(--p-line-strong) / 0.7)" }} />
                  {i % every === 0 && (!ready || i !== index) && (
                    <span className="telemetry absolute top-0.5 -translate-x-1/2 text-[9px] text-muted-foreground">{clockLabel(t)}</span>
                  )}
                </span>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.label} className={`relative ${ROW}`}>
                {r.marks.map((t) => (
                  <span
                    key={t}
                    className="absolute top-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rotate-45"
                    style={{ left: x(t), background: r.colour, opacity: !ready || t <= now ? 1 : 0.45 }}
                  />
                ))}
              </div>
            ))}
            {ready && (
              <span className="pointer-events-none absolute bottom-0 top-0" style={{ left: x(now) }}>
                <span className="absolute bottom-0 top-0 w-px -translate-x-1/2 bg-accent" />
                <span className="telemetry absolute top-px -translate-x-1/2 rounded-sm bg-accent px-1 text-[9px] text-accent-foreground">
                  {clockLabel(now)}
                </span>
              </span>
            )}
          </div>
        </div>
        {/* What each layer is and how it is drawn, on its own row; and above them, whose data this is. */}
        <div className="shrink-0 border-l" style={{ width: DETAIL_W, borderColor: "rgb(var(--p-line) / 0.3)" }}>
          <p className={`${ROW} flex items-center gap-1.5 overflow-hidden border-b px-2 text-[9px] text-muted-foreground`} style={{ borderColor: "rgb(var(--p-line) / 0.3)" }}>
            {o.weatherSatellite && <Credit label="NASA GIBS · NOAA GOES-East" href="https://earthdata.nasa.gov/gibs" />}
            {o.weatherRadar && <Credit label="RainViewer" href="https://www.rainviewer.com" />}
            {o.weatherWind && <Credit label="NOAA GFS · UCAR THREDDS" href="https://www.unidata.ucar.edu/software/tds/" />}
          </p>
          {rows.map((r) => (
            <div key={r.label} className={`${ROW} flex items-center gap-1.5 px-2`}>
              {r.detail}
            </div>
          ))}
        </div>
      </div>

      {refused && (
        <p className="px-2 py-1 text-micro leading-snug" style={{ color: "var(--warning)", background: "var(--s-sunk)" }}>
          {o.weatherRadar && tilesFailing(w, "radar")
            ? "Radar tiles are being refused. RainViewer limits requests from one address; the radar comes back once the limit resets, usually within a minute."
            : "Satellite tiles are not loading. The connection or NASA GIBS may be down; the map keeps what it has."}
        </p>
      )}
    </div>
  )
}

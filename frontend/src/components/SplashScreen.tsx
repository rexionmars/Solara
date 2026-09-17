import { useEffect, useState } from "react"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { GetAppVersion, GetBootLogs } from "../../wailsjs/go/main/App"
import { SPLASH_STILLS, claimSplashStill } from "../lib/splashBackground"
import { BRAND_TAGLINE, RELEASE_NAME } from "../lib/brand"

type SplashScreenProps = {
  /** When true, fade and scale out before the main window opens. */
  exiting?: boolean
}

/**
 * The boot screen in the splash-sized window: a full-bleed still with a slow
 * pan, the brand centred, and the latest boot line along the bottom.
 */
export function SplashScreen({ exiting = false }: SplashScreenProps) {
  const [line, setLine] = useState("booting…")
  // Null until the Go side answers; the release line gains it a frame later.
  const [version, setVersion] = useState<string | null>(null)
  // Claimed once per launch; see claimSplashStill.
  const [slide] = useState(() => claimSplashStill())

  useEffect(() => {
    let stale = false
    // Set by the first live line. The buffered snapshot below can resolve
    // after it, and must not replace a newer line with an older one.
    let live = false

    GetAppVersion()
      .then((v) => {
        if (!stale && v) setVersion(v)
      })
      .catch(() => {})

    GetBootLogs()
      .then((lines) => {
        const last = (lines ?? []).filter(Boolean).at(-1)
        if (!stale && !live && last) setLine(last)
      })
      .catch(() => {})

    const off = EventsOn("boot:log", (msg: string) => {
      if (!msg) return
      live = true
      setLine(msg)
    })
    return () => {
      stale = true
      off()
    }
  }, [])

  const still = SPLASH_STILLS[slide] ?? SPLASH_STILLS[0]

  return (
    <div
      className={`app-draggable splash-screen relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-5 ${
        exiting ? "splash-screen--exit" : ""
      }`}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          key={still.path}
          className={`splash-kenburns splash-kenburns--${(slide % 3) + 1} is-active`}
          style={{ backgroundImage: `url(${still.path})` }}
        />
        <div className="splash-kenburns-scrim absolute inset-0" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3.5">
        <img src="/terra-logo.png" alt="" className="splash-logo h-14 w-14 object-contain" />
        <div className="flex flex-col items-center gap-1.5">
          <p className="splash-brand text-lg font-semibold tracking-[0.18em]">TERRA</p>
          <p className="splash-eyebrow text-[10px] uppercase tracking-[0.12em] text-foreground/80">
            {BRAND_TAGLINE}
          </p>
          <p className="splash-eyebrow font-mono text-[9px] tracking-[0.08em] text-foreground/70">
            {RELEASE_NAME}
            {version && ` · ${version}`}
          </p>
          <div className="mt-1 h-0.5 w-7 rounded-[1px] bg-accent/85" aria-hidden="true" />
        </div>
        <span className="splash-led mt-1 h-1.5 w-1.5 rounded-[1px] bg-accent" aria-hidden="true" />
      </div>

      <p
        className="splash-log app-no-drag absolute bottom-4 left-4 right-4 z-10 truncate text-center font-mono text-[10px] tracking-wide text-foreground/85"
        title={line}
      >
        {line}
      </p>
    </div>
  )
}

import { useEffect, useRef, useState } from "react"
import { Crosshair, FolderSimple, MagnifyingGlass, type Icon } from "@phosphor-icons/react"
import { GetAppVersion } from "../../../wailsjs/go/main/App"
import { RELEASE_NAME } from "../../lib/brand"
import { findOperator, formatKeys, runOperator } from "../../lib/operators"
import { project } from "../../lib/project"
import { nameFromPath, openProject, recentFiles } from "../../lib/projectFile"
import { FEATURED_STILL, SPLASH_STILLS } from "../../lib/splashBackground"
import { useStore } from "../../lib/store"
import { activeTool } from "../../lib/tools"
import { coordinatePrompt, splashOpen } from "../../lib/ui"

/** As many as Blender lists; the rest are behind "More…" and the project menu. */
const RECENT_SHOWN = 5

function Row({
  icon: IconC,
  label,
  hint,
  title,
  onSelect,
}: {
  icon?: Icon
  label: string
  hint?: string
  title?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onSelect}
      className="group flex h-7 w-full min-w-0 items-center gap-2.5 rounded-sm px-1.5 text-left text-body text-foreground/90 transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {IconC ? (
        <IconC className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <span className="truncate">{label}</span>
      {hint && <span className="telemetry ml-auto shrink-0 pl-2 text-meta text-muted-foreground">{hint}</span>}
    </button>
  )
}

/**
 * The start screen, as Blender's splash: the release's still across the top
 * with the name and version on it, then what to start and what to reopen side
 * by side, then the ways out to a file, the settings and the about box.
 *
 * Open at launch and from the Studio menu (SPLASH). It goes on a click outside,
 * on Escape, on any of its own actions, and when the work starts without it: a
 * tool taken from the keymap, or the project changed.
 */
export function StartSplash() {
  const open = useStore(splashOpen)
  const tool = useStore(activeTool)
  const p = useStore(project)
  const recent = useStore(recentFiles)
  const [version, setVersion] = useState<string | null>(null)
  const openedWith = useRef({ data: p.data, tool })

  useEffect(() => {
    GetAppVersion()
      .then((v) => v && setVersion(v))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (open) openedWith.current = { data: project.get().data, tool: activeTool.get() }
  }, [open])

  useEffect(() => {
    if (open && (p.data !== openedWith.current.data || tool !== openedWith.current.tool)) splashOpen.set(false)
  }, [open, p.data, tool])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // A dialog opened over it (Settings, search) takes its own Escape first.
      if (e.key !== "Escape" || document.querySelector("[aria-modal='true']")) return
      e.stopPropagation()
      e.preventDefault()
      splashOpen.set(false)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open])

  if (!open) return null

  const still = SPLASH_STILLS.find((s) => s.name === FEATURED_STILL) ?? SPLASH_STILLS[0]
  const close = () => splashOpen.set(false)
  const act = (run: () => unknown) => () => {
    close()
    void run()
  }
  // Only the map tools carry their key, as the card this replaces did: P and D are learnt here.
  const opRow = (name: string, label: string, title?: string) => {
    const op = findOperator(name)
    const key = name.startsWith("TOOL_") ? op?.keys?.[0] : undefined
    return (
      <Row
        icon={op?.icon}
        label={label}
        hint={key ? formatKeys(key) : undefined}
        title={title ?? op?.description}
        onSelect={act(() => runOperator(name))}
      />
    )
  }

  return (
    <div
      className="absolute inset-0 z-[1500] flex items-center justify-center p-4"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-label="Start"
        className="w-[500px] max-w-full overflow-hidden rounded-md border shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        style={{ background: "var(--s-panel)", borderColor: "rgb(var(--p-line) / 0.4)" }}
      >
        <div className="relative h-[250px] overflow-hidden">
          <img src={still.path} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(160deg, rgb(0 0 0 / 0.45) 0%, rgb(0 0 0 / 0) 45%, rgb(0 0 0 / 0) 70%, rgb(0 0 0 / 0.4) 100%)" }}
            aria-hidden
          />
          <div className="absolute left-5 top-5 flex flex-col">
            <img src="/solara-lockup.png" alt="Solara" className="splash-logo w-[168px]" draggable={false} />
            <span className="splash-eyebrow mt-1.5 text-[10px] uppercase tracking-[0.12em] text-foreground/75">Energy engine</span>
          </div>
          <span className="splash-eyebrow telemetry absolute right-4 top-3.5 text-body text-foreground/80">
            {version ? `${version} ${RELEASE_NAME}` : RELEASE_NAME}
          </span>
          <span className="splash-eyebrow absolute bottom-3 right-4 text-meta text-foreground/70" title={still.source}>
            {still.photographer}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 px-6 pb-2 pt-4">
          <section className="min-w-0">
            <p className="mb-1 px-1.5 text-body text-muted-foreground">Start</p>
            {opRow("TOOL_SITE", "Place a site", "The solar resource and the wind screening are read at a site")}
            {opRow(
              "AREA_PLACE",
              "Area from a place…",
              "A state or a municipality, from the boundaries IBGE publishes"
            )}
            <Row
              icon={Crosshair}
              label="Site at coordinates…"
              title="Add a site from a latitude and a longitude"
              onSelect={act(() => coordinatePrompt.set(true))}
            />
          </section>
          <section className="min-w-0">
            <p className="mb-1 px-1.5 text-body text-muted-foreground">Recent Projects</p>
            {recent.length ? (
              recent
                .slice(0, RECENT_SHOWN)
                .map((path) => (
                  <Row key={path} icon={FolderSimple} label={nameFromPath(path)} title={path} onSelect={act(() => openProject(path))} />
                ))
            ) : (
              <p className="px-1.5 py-1.5 text-meta leading-relaxed text-muted-foreground">
                No projects opened yet. A saved project is listed here.
              </p>
            )}
            <Row icon={MagnifyingGlass} label="More…" title="Open a project file" onSelect={act(() => runOperator("OPEN"))} />
          </section>
        </div>

        <div className="mx-6 border-t" style={{ borderColor: "var(--hairline)" }} />

        <div className="grid grid-cols-2 gap-x-6 px-6 pb-5 pt-2">
          <section className="min-w-0">
            {opRow("OPEN", "Open…")}
            {opRow("NEW", "New project")}
          </section>
          <section className="min-w-0">
            {opRow("ABOUT", "About")}
            {opRow("PREFERENCES", "Settings")}
          </section>
        </div>
      </div>
    </div>
  )
}

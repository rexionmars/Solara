import { useEffect, useLayoutEffect, useState, type ReactElement } from "react"
import { loadAccount } from "../../lib/account"
import { listenForProgress } from "../../lib/analysis"
import { loadDefaults } from "../../lib/defaults"
import { checkGridStore } from "../../lib/grid"
import { editorMeta, type EditorId } from "../../lib/editors"
import { installKeymap } from "../../lib/operators"
import { watchProjectState } from "../../lib/projectFile"
import { activeTree, leaves, screen, takenUnique, AREA_GUTTER_PX, type Rect } from "../../lib/screen"
import { checkSidecar } from "../../lib/sidecarStatus"
import { useStore } from "../../lib/store"
import { ConsoleEditor } from "../editors/ConsoleEditor"
import { MapEditor } from "../editors/MapEditor"
import { OutlinerEditor } from "../editors/OutlinerEditor"
import { PropertiesEditor } from "../editors/PropertiesEditor"
import { ReadingEditor } from "../editors/ReadingEditor"
import { ReportsEditor } from "../editors/ReportsEditor"
import { RunGraphEditor } from "../editors/RunGraphEditor"
import { TableEditor } from "../editors/TableEditor"
import { ErrorBoundary } from "../ui/ErrorBoundary"
import { AreaTree } from "./AreaTree"
import { ConfirmDialog, CoordinatesDialog, OperatorSearch, PlaceDialog } from "./Dialogs"
import { ContextMenuHost, StudioSurface } from "./Popover"
import { Settings } from "./Settings"
import { StartSplash } from "./StartSplash"
import { StudioArea } from "./StudioArea"
import { WorkspaceTabs } from "../shell/WorkspaceTabs"
import { TitleBar } from "./TitleBar"
import { Toasts } from "./Toasts"

/**
 * Which component an area's editor is.
 *
 * The return type is stated rather than inferred, so an editor added to
 * EditorId without a case here fails to compile. Inferred, the switch would
 * simply fall through and the area would draw nothing -- which is what the
 * demand reading did until this was written down.
 */
function Editor({ areaId, editor }: { areaId: string; editor: EditorId }): ReactElement {
  switch (editor) {
    case "map":
      return <MapEditor />
    case "graph":
      return <RunGraphEditor areaId={areaId} />
    case "outliner":
      return <OutlinerEditor areaId={areaId} />
    case "properties":
      return <PropertiesEditor />
    case "table":
      return <TableEditor areaId={areaId} />
    case "reports":
      return <ReportsEditor areaId={areaId} />
    case "console":
      return <ConsoleEditor />
    case "solar":
    case "wind":
    case "terrain":
    case "connection":
    case "demand":
      return <ReadingEditor areaId={areaId} product={editor} />
  }
}

/**
 * The main window, as TERRA's studio: the title bar, the workspace bar, the
 * active workspace's areas on the window's own ground, and the status bar.
 * Popovers are portalled into the surface and clamped against it.
 */
export function Studio() {
  const s = useStore(screen)
  const [surface, setSurface] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

  useLayoutEffect(() => {
    if (!surface) return
    const measure = () => setSize({ w: surface.clientWidth, h: surface.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [surface])

  useEffect(() => {
    void checkSidecar().then((st) => {
      if (st.kind === "ready") {
        void loadDefaults()
        // Quietly: a missing store is a state Settings and the run graph show, not news at launch.
        void checkGridStore()
      }
    })
    void loadAccount()
  }, [])

  // One of each for the application; each cleanup keeps StrictMode's second mount from adding another.
  useEffect(() => listenForProgress(), [])
  useEffect(() => installKeymap(), [])
  useEffect(() => watchProjectState(), [])

  // A desktop window offers no webview menu (Reload, Inspect), except in fields, where Copy and Paste live.
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea, .selectable, .telemetry")) e.preventDefault()
    }
    window.addEventListener("contextmenu", onContext)
    return () => window.removeEventListener("contextmenu", onContext)
  }, [])

  const tree = activeTree()
  const viewport: Rect = { x: 0, y: 0, w: size.w, h: size.h }
  const all = leaves(tree)
  const maximized = s.maximized ? all.find((a) => a.id === s.maximized) : undefined
  const unique = takenUnique()
  const half = AREA_GUTTER_PX / 2

  const renderArea = (leaf: { id: string; editor: EditorId; rect: Rect }) => (
    <StudioArea
      key={`${s.active}:${leaf.id}`}
      areaId={leaf.id}
      editor={leaf.editor}
      rect={leaf.rect}
      rootPx={rootPx}
      maximized={s.maximized === leaf.id}
      takenUnique={unique}
      canClose={all.length > 1}
    >
      <ErrorBoundary key={leaf.editor} label={`The ${editorMeta(leaf.editor).label} editor`}>
        <Editor areaId={leaf.id} editor={leaf.editor} />
      </ErrorBoundary>
    </StudioArea>
  )

  return (
    <div className="app-shell-enter flex h-full flex-col" style={{ background: "var(--s-app)" }}>
      <TitleBar />
      <StudioSurface.Provider value={surface}>
        {/* The arrangements, thin, between the window's band and the work. */}
        <WorkspaceTabs />
        <div ref={setSurface} className="app-no-drag relative min-h-0 flex-1 overflow-hidden" style={{ background: "var(--s-app)" }}>
          {size.w > 0 &&
            (maximized
              ? renderArea({
                  id: maximized.id,
                  editor: maximized.editor,
                  rect: { x: half * 2, y: half * 2, w: size.w - AREA_GUTTER_PX * 2, h: size.h - AREA_GUTTER_PX * 2 },
                })
              : <AreaTree key={s.active} tree={tree} viewport={viewport} surface={surface} renderArea={renderArea} />)}
          <StartSplash />
          <ContextMenuHost />
        </div>
      </StudioSurface.Provider>
      <OperatorSearch />
      <CoordinatesDialog />
      <PlaceDialog />
      <Settings />
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}

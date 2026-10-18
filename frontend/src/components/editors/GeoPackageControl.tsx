import { useState } from "react"
import { closeGeoPackage, framePackageLayer, geoPackage, togglePackageVisibility } from "../../lib/geopackage"
import { useStore } from "../../lib/store"
import { openProject } from "../../lib/projectFile"
import { StudioPopover } from "../studio/Popover"

export function GeoPackageControl() {
  const [open, setOpen] = useState(false)
  const state = useStore(geoPackage)
  return <StudioPopover open={open} onOpenChange={setOpen} role="dialog" align="end" widthRem={22}
    trigger={props => <button {...props} type="button" className="px-2 text-meta text-foreground hover:bg-hover">GeoPackage{state.file ? ` · ${Object.values(state.views).filter(v => v.visible).length} layers` : ""}</button>}>
    <div className="flex flex-col gap-2 px-3 py-2 text-meta text-foreground">
      <button type="button" className="text-left hover:underline disabled:opacity-50" disabled={state.opening} onClick={() => void openProject()}>
        {state.opening ? "Opening…" : "Open project…"}
      </button>
      {state.file && <>
        <p className="break-all font-medium" title={state.file.path}>{state.file.name}</p>
        <div className="panel-scroll flex max-h-72 flex-col gap-1 overflow-y-auto" aria-label="GeoPackage layers">
          {state.file.layers.map(l => { const view = state.views[l.name]; return <div key={l.name} className="flex items-center gap-2 py-1">
            <label className="flex min-w-0 flex-1 items-center gap-2" title={l.error ?? view?.error ?? l.geometry}>
              <input type="checkbox" checked={!!view?.visible} disabled={!!l.error} onChange={() => togglePackageVisibility(l.name)} />
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: view?.color }} />
              <span className="truncate">{l.label}</span>
            </label>
            <span className="telemetry text-muted-foreground">{view?.loading ? "reading…" : l.count.toLocaleString()}</span>
            <button type="button" className="text-accent hover:underline" disabled={!!l.error} onClick={() => framePackageLayer(l.name)}>Frame</button>
          </div> })}
        </div>
        <p className="text-muted-foreground">Show several layers together. Click a feature to inspect its attributes. Preview limited to 5,000 features per layer; zoom in for detail.</p>
        <button type="button" className="self-start hover:underline" onClick={closeGeoPackage}>Close GeoPackage</button>
      </>}
    </div>
  </StudioPopover>
}

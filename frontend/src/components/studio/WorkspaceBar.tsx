import { useState, type KeyboardEvent } from "react"
import { ArrowClockwise, CaretDown } from "../../lib/icons"
import { STUDIO_GROUPS } from "../../lib/editors"
import {
  PRIMARY_WORKSPACE_IDS,
  WORKSPACES,
  activeWorkspace,
  resetWorkspace,
  screen,
  setWorkspace,
} from "../../lib/screen"
import { useStore } from "../../lib/store"
import { StudioMenuGroup, StudioMenuItem, StudioPopover } from "./Popover"

export const WORKSPACE_BAR_PX = 30

/** Persistent workspace navigation, independent of the ribbon's command tabs. */
export function WorkspaceBar() {
  const state = useStore(screen)
  const [open, setOpen] = useState(false)
  const current = activeWorkspace()
  const primary = PRIMARY_WORKSPACE_IDS.map(id => WORKSPACES.find(w => w.id === id)!)
  const secondary = WORKSPACES.filter(w => !primary.includes(w))
  const visible = primary.includes(current) ? primary : [...primary, current]

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.click()
    buttons[next]?.focus()
  }

  return <nav aria-label="Workspaces" className="app-no-drag flex shrink-0 items-center gap-1 border-b px-2"
    style={{ height: WORKSPACE_BAR_PX, background: 'var(--s-chrome)', borderColor: 'rgb(var(--p-line) / 0.28)' }}>
    <span className="mr-2 hidden text-meta text-muted-foreground sm:inline">Workspace</span>
    <div role="tablist" aria-label="Workspace layouts" className="flex min-w-0 items-center gap-1 overflow-x-auto" onKeyDown={navigate}>
      {visible.map(w => <button key={w.id} type="button" role="tab" aria-selected={state.active === w.id}
        tabIndex={state.active === w.id ? 0 : -1} title={w.hint} onClick={() => setWorkspace(w.id)}
        className={`flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-3 text-meta focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring ${state.active === w.id ? 'bg-selected text-accent' : 'text-muted-foreground hover:bg-hover hover:text-foreground'}`}>
        <w.icon className="size-3.5" />{w.id === 'planning' ? 'Planning · PyPSA' : w.label}
      </button>)}
    </div>
    <StudioPopover open={open} onOpenChange={setOpen} widthRem={18} portal="viewport" trigger={t => <button
      ref={t.ref as React.Ref<HTMLButtonElement>} type="button" onClick={t.onClick}
      aria-expanded={t['aria-expanded']} aria-haspopup="menu" title="Other workspace layouts"
      className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-meta text-muted-foreground hover:bg-hover hover:text-foreground">
      More workspaces<CaretDown className="size-3" />
    </button>}>
      {STUDIO_GROUPS.map(group => {
        const members = secondary.filter(w => w.group === group.id)
        return members.length ? <StudioMenuGroup key={group.id} label={group.label}>
          {members.map(w => <StudioMenuItem key={w.id} icon={w.icon} label={w.label} checked={w.id === state.active} title={w.hint}
            onSelect={() => { setWorkspace(w.id); setOpen(false) }} />)}
        </StudioMenuGroup> : null
      })}
    </StudioPopover>
    <span className="flex-1" />
    <button type="button" aria-label={`Reset ${current.label} workspace`} title="Restore the current workspace's original panel layout"
      className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-meta text-muted-foreground hover:bg-hover hover:text-foreground"
      onClick={resetWorkspace}><ArrowClockwise className="size-3" /><span className="hidden sm:inline">Reset layout</span></button>
  </nav>
}

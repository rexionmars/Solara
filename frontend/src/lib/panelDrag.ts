import type { PointerEvent as ReactPointerEvent } from "react"
import { createStore } from "./store"
import { activeTree, areaRects, findArea, leaves, moveArea, screen, type Rect } from "./screen"
import { dockPosition, rearrangeAreas, type DockPosition } from "./panelLayout"

export type PanelDrag = {
  source: string; x: number; y: number; keyboard: boolean
  target: { id: string; position: DockPosition; rect: Rect } | null
}
export const panelDrag = createStore<PanelDrag | null>(null)
let cancel: (() => void) | null = null
export function cancelPanelDrag(): void { cancel?.() }

function targetAt(source: string, element: HTMLElement, position: DockPosition): PanelDrag["target"] {
  const id = element.dataset.area
  const surface = element.closest<HTMLElement>("[data-studio-surface]")
  if (!id || id === source || !surface || !findArea(id)) return null
  const rect = surface.getBoundingClientRect()
  const next = rearrangeAreas(activeTree(), source, id, position, "preview-panel-split")
  const area = areaRects(next, { x: 0, y: 0, w: rect.width, h: rect.height }).leaves.find(a => a.id === source)
  return area ? { id, position, rect: area.rect } : null
}

/** A movement threshold keeps clicks on the header's controls from becoming drags. */
export function beginPanelDrag(event: ReactPointerEvent<HTMLElement>, source: string): void {
  if (event.button !== 0 || screen.get().maximized) return
  cancelPanelDrag()
  event.preventDefault()
  const workspace = screen.get().active
  const x0 = event.clientX, y0 = event.clientY, pointerId = event.pointerId
  const handle = event.currentTarget
  handle.setPointerCapture?.(pointerId)
  let moved = false
  const restoreCursor = document.body.style.cursor
  const valid = () => screen.get().active === workspace && !screen.get().maximized && !!findArea(source)
  const read = (e: PointerEvent) => {
    const element = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-area]")
    const bounds = element?.getBoundingClientRect()
    const position = bounds ? dockPosition({ x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height }, e.clientX, e.clientY) : null
    return element && position ? targetAt(source, element, position) : null
  }
  const finish = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", finish)
    window.removeEventListener("blur", finish)
    window.removeEventListener("keydown", key, true)
    unsubscribe()
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
    document.body.style.cursor = restoreCursor
    panelDrag.set(null)
    if (cancel === finish) cancel = null
  }
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    if (!valid()) return finish()
    if (!moved && Math.hypot(e.clientX - x0, e.clientY - y0) < 6) return
    moved = true
    e.preventDefault()
    document.body.style.cursor = "grabbing"
    panelDrag.set({ source, x: e.clientX, y: e.clientY, target: read(e), keyboard: false })
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    const target = moved && valid() ? read(e) : null
    finish()
    if (moved) {
      // Consume the synthetic click after a drag, before a header button can act on it.
      const suppress = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation() }
      window.addEventListener("click", suppress, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener("click", suppress, true), 0)
    }
    if (target) moveArea(source, target.id, target.position)
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish() }
  }
  const unsubscribe = screen.subscribe(() => { if (!valid()) finish() })
  cancel = finish
  window.addEventListener("pointermove", move, { passive: false })
  window.addEventListener("pointerup", up)
  window.addEventListener("pointercancel", finish)
  window.addEventListener("blur", finish)
  window.addEventListener("keydown", key, true)
}

/** Keyboard equivalent: Tab chooses a target, arrows dock, C swaps, Enter applies. */
export function beginPanelKeyboardDrag(source: string): void {
  if (screen.get().maximized) return
  cancelPanelDrag()
  const workspace = screen.get().active
  const targets = leaves(activeTree()).filter(a => a.id !== source)
  if (!targets.length) return
  let index = 0, position: DockPosition = "center"
  const show = () => {
    const element = document.querySelector<HTMLElement>(`[data-area="${CSS.escape(targets[index].id)}"]`)
    if (!element) return
    const bounds = element.getBoundingClientRect()
    panelDrag.set({ source, x: bounds.left + bounds.width / 2, y: bounds.top + 32, target: targetAt(source, element, position), keyboard: true })
  }
  const finish = () => {
    window.removeEventListener("keydown", key, true)
    window.removeEventListener("blur", finish)
    unsubscribe()
    panelDrag.set(null)
    if (cancel === finish) cancel = null
  }
  const key = (e: KeyboardEvent) => {
    if (!["Escape", "Enter", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "c", "C", " "].includes(e.key)) return
    if (e.repeat && (e.key === "Enter" || e.key === " ")) return
    e.preventDefault(); e.stopImmediatePropagation()
    if (e.key === "Escape") return finish()
    if (e.key === "Enter" || e.key === " ") {
      const target = panelDrag.get()?.target
      finish()
      if (target) moveArea(source, target.id, target.position)
      return
    }
    if (e.key === "Tab") index = (index + (e.shiftKey ? -1 : 1) + targets.length) % targets.length
    else {
      const edges: Record<string, DockPosition> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" }
      position = edges[e.key] ?? "center"
    }
    show()
  }
  const unsubscribe = screen.subscribe(() => { if (screen.get().active !== workspace || screen.get().maximized) finish() })
  cancel = finish
  window.addEventListener("keydown", key, true)
  window.addEventListener("blur", finish)
  show()
}

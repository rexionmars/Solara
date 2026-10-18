import type { AreaNode, LayoutNode, Rect } from "./screen"

export type DockPosition = "center" | "left" | "right" | "top" | "bottom"

/** Move entire leaves, preserving their IDs and the editor state keyed by them. */
export function rearrangeAreas(root: LayoutNode, sourceId: string, targetId: string, position: DockPosition, splitId: string): LayoutNode {
  if (sourceId === targetId) return root
  const find = (n: LayoutNode, id: string): AreaNode | null => n.type === "area" ? n.id === id ? n : null : find(n.a, id) ?? find(n.b, id)
  const source = find(root, sourceId), target = find(root, targetId)
  if (!source || !target) return root
  const replace = (n: LayoutNode, id: string, next: LayoutNode): LayoutNode => {
    if (n.id === id) return next
    if (n.type === "area") return n
    const a = replace(n.a, id, next), b = replace(n.b, id, next)
    return a === n.a && b === n.b ? n : { ...n, a, b }
  }
  if (position === "center") {
    const swap = (n: LayoutNode): LayoutNode => {
      if (n.id === sourceId) return target
      if (n.id === targetId) return source
      if (n.type === "area") return n
      const a = swap(n.a), b = swap(n.b)
      return a === n.a && b === n.b ? n : { ...n, a, b }
    }
    return swap(root)
  }
  const detach = (n: LayoutNode): LayoutNode | null => {
    if (n.id === sourceId) return null
    if (n.type === "area") return n
    const a = detach(n.a), b = detach(n.b)
    return !a ? b : !b ? a : a === n.a && b === n.b ? n : { ...n, a, b }
  }
  const remaining = detach(root)
  if (!remaining) return root
  const before = position === "left" || position === "top"
  return replace(remaining, targetId, {
    type: "split", id: splitId, dir: position === "left" || position === "right" ? "row" : "col",
    ratio: 0.5, a: before ? source : target, b: before ? target : source,
  })
}

/** The middle swaps; the closest outer quarter docks to that edge. */
export function dockPosition(rect: Rect, x: number, y: number): DockPosition | null {
  if (rect.w <= 0 || rect.h <= 0 || x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) return null
  const distances: [DockPosition, number][] = [["left", (x - rect.x) / rect.w], ["right", (rect.x + rect.w - x) / rect.w], ["top", (y - rect.y) / rect.h], ["bottom", (rect.y + rect.h - y) / rect.h]]
  distances.sort((a, b) => a[1] - b[1])
  return distances[0][1] < 0.25 ? distances[0][0] : "center"
}

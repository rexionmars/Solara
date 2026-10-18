import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

const source = await readFile(new URL('../src/lib/panelLayout.ts', import.meta.url), 'utf8')
const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
await module.link(() => {})
await module.evaluate()
const { rearrangeAreas, dockPosition } = module.namespace
const area = (id, editor) => ({ type: 'area', id, editor })
const split = (id, dir, a, b) => ({ type: 'split', id, dir, ratio: 0.6, a, b })
const a = area('map', 'map'), b = area('tree', 'outliner'), c = area('attributes', 'table'), d = area('props', 'properties')
const root = split('root', 'row', a, split('sidebar', 'col', b, split('right', 'row', c, d)))
const leaves = n => n.type === 'area' ? [n] : [...leaves(n.a), ...leaves(n.b)]
const nodes = n => n.type === 'area' ? [n] : [n, ...nodes(n.a), ...nodes(n.b)]

test('center swaps entire panels, keeping IDs and source tree immutable', () => {
  const next = rearrangeAreas(root, 'map', 'attributes', 'center', 'unused')
  assert.equal(next.a, c)
  assert.equal(next.b.b.a, a)
  assert.equal(root.a, a)
  assert.equal(root.b.b.a, c)
  assert.equal(nodes(next).length, nodes(root).length)
})

for (const position of ['left', 'right', 'top', 'bottom']) {
  test(`docking ${position} collapses the previous slot and retains every editor exactly once`, () => {
    const next = rearrangeAreas(root, 'attributes', 'map', position, `dock-${position}`)
    const dock = nodes(next).find(n => n.id === `dock-${position}`)
    assert.equal(dock.dir, ['left', 'right'].includes(position) ? 'row' : 'col')
    assert.equal(dock.ratio, 0.5)
    assert.equal(dock.a, ['left', 'top'].includes(position) ? c : a)
    assert.equal(dock.b, ['left', 'top'].includes(position) ? a : c)
    assert.deepEqual(leaves(next).map(n => n.id).sort(), ['attributes', 'map', 'props', 'tree'])
    assert.equal(next.b.b, d)
    assert.equal(nodes(next).length, nodes(root).length)
  })
}

test('sibling docking can change direction without duplicating a unique map', () => {
  const next = rearrangeAreas(split('sibling', 'row', a, b), 'map', 'tree', 'bottom', 'new')
  assert.equal(next.dir, 'col')
  assert.equal(next.a, b)
  assert.equal(next.b, a)
  assert.equal(leaves(next).filter(n => n.editor === 'map').length, 1)
})

test('invalid targets, source itself and the sole panel are no-ops', () => {
  assert.equal(rearrangeAreas(root, 'map', 'map', 'center', 'new'), root)
  assert.equal(rearrangeAreas(root, 'absent', 'map', 'left', 'new'), root)
  assert.equal(rearrangeAreas(root, 'map', 'absent', 'right', 'new'), root)
  assert.equal(rearrangeAreas(a, 'map', 'tree', 'left', 'new'), a)
})

test('long sequences of rearrangements preserve all editor and split IDs without duplicates', () => {
  let next = root, counter = 0
  for (const position of ['center', 'left', 'right', 'top', 'bottom']) for (const from of leaves(root)) for (const to of leaves(root)) {
    next = rearrangeAreas(next, from.id, to.id, position, `dock${counter++}`)
    const ids = nodes(next).map(n => n.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(ids.length, 7)
    assert.deepEqual(leaves(next).map(n => n.id).sort(), ['attributes', 'map', 'props', 'tree'])
    for (const original of leaves(root)) assert.equal(leaves(next).find(n => n.id === original.id), original)
  }
})

test('drop regions use the closest edge and reject points outside the target', () => {
  const rect = { x: 100, y: 200, w: 600, h: 400 }
  assert.equal(dockPosition(rect, 400, 400), 'center')
  assert.equal(dockPosition(rect, 105, 400), 'left')
  assert.equal(dockPosition(rect, 695, 400), 'right')
  assert.equal(dockPosition(rect, 400, 205), 'top')
  assert.equal(dockPosition(rect, 400, 595), 'bottom')
  assert.equal(dockPosition(rect, 99, 400), null)
  assert.equal(dockPosition({ ...rect, w: 0 }, 100, 400), null)
})

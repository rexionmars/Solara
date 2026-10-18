import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

async function studio(storage = new Map()) {
  const tasks = new Map()
  let timer = 0
  const createStore = initial => {
    let value = initial
    const listeners = new Set()
    return { get: () => value, set: next => { value = typeof next === 'function' ? next(value) : next; listeners.forEach(fn => fn()) }, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
  }
  const icons = Object.fromEntries(['ChartBar', 'CheckSquare', 'Cube', 'Fan', 'Graph', 'Mountains', 'PlugsConnected', 'Sun', 'Table', 'TerminalWindow'].map(id => [id, () => null]))
  const editors = ['map', 'reports', 'outliner', 'properties', 'planning', 'graph', 'table', 'console', 'solar', 'terrain', 'wind', 'connection', 'demand', 'ground'].map(id => ({ id, unique: id === 'map' || id === 'planning' }))
  const mocks = { './icons': icons, './editors': { EDITORS: editors, editorMeta: id => editors.find(e => e.id === id) }, './selection': { select() {} }, './store': { createStore } }
  const context = vm.createContext({ localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, window: { setTimeout: fn => { tasks.set(++timer, fn); return timer }, clearTimeout: id => tasks.delete(id) } })
  const load = async name => {
    if (mocks[name]) return new vm.SyntheticModule(Object.keys(mocks[name]), function () { for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value) }, { context })
    const source = await readFile(new URL(`../src/lib/${name.slice(2)}.ts`, import.meta.url), 'utf8')
    const mod = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context })
    await mod.link(load)
    return mod
  }
  const module = await load('./screen')
  await module.evaluate()
  return { api: module.namespace, storage, flush: () => { for (const fn of tasks.values()) fn(); tasks.clear() } }
}

test('fresh sessions start in Default with separate general-purpose and PyPSA layouts', async () => {
  const { api } = await studio()
  assert.equal(api.activeWorkspace().label, 'Default')
  assert.equal(api.screen.get().active, 'layout')
  assert.deepEqual(Array.from(api.PRIMARY_WORKSPACE_IDS), ['layout', 'planning'])
  assert.deepEqual(Array.from(api.leaves(api.activeTree()), a => a.editor).sort(), ['map', 'outliner', 'properties', 'reports'])
  api.setWorkspace('planning')
  assert.equal(api.activeTree().editor, 'planning')
})

test('workspace changes preserve independent layouts and restore the active workspace after restart', async () => {
  const { api, storage, flush } = await studio()
  const defaultTree = api.activeTree()
  api.setRatio(defaultTree.id, 0.65)
  const customized = api.activeTree()
  api.setWorkspace('planning')
  const planningTree = api.activeTree()
  api.splitArea(planningTree.id, 'col')
  const planningCustom = api.activeTree()
  api.setWorkspace('layout')
  assert.equal(api.activeTree(), customized)
  api.setWorkspace('planning')
  assert.equal(api.activeTree(), planningCustom)
  flush()
  const restarted = (await studio(storage)).api
  assert.equal(restarted.screen.get().active, 'planning')
  assert.deepEqual(JSON.parse(JSON.stringify(restarted.activeTree())), JSON.parse(JSON.stringify(planningCustom)))
  restarted.setWorkspace('layout')
  assert.equal(restarted.activeTree().ratio, 0.65)
})

test('reset restores only the active workspace and clears maximization', async () => {
  const { api } = await studio()
  api.setRatio(api.activeTree().id, 0.6)
  const defaultCustom = api.activeTree()
  api.setWorkspace('planning')
  api.splitArea(api.activeTree().id, 'row')
  api.toggleMaximized(api.leaves(api.activeTree())[0].id)
  api.resetWorkspace()
  assert.equal(api.activeTree().editor, 'planning')
  assert.equal(api.screen.get().maximized, null)
  api.setWorkspace('layout')
  assert.equal(api.activeTree(), defaultCustom)
})

test('legacy layout IDs are retained; invalid workspace selections cannot corrupt navigation', async () => {
  const storage = new Map([['terra-energy.studio.v2', JSON.stringify({ active: 'layout', trees: { layout: { type: 'area', id: 'saved-map', editor: 'map' } } })]])
  const { api } = await studio(storage)
  assert.equal(api.activeTree().id, 'saved-map')
  api.setWorkspace('unknown-workspace')
  assert.equal(api.screen.get().active, 'layout')
  assert.equal(api.activeWorkspace().label, 'Default')
})

test('retired GeoPackage workspaces fall back to Default and saved panels migrate without losing their neighbours', async () => {
  const legacy = { type: 'split', id: 'custom', dir: 'row', ratio: 0.61,
    a: { type: 'area', id: 'kept-map', editor: 'map' },
    b: { type: 'area', id: 'retired-panel', editor: 'geopackage' } }
  const storage = new Map([['terra-energy.studio.v2', JSON.stringify({ active: 'geopackage', trees: { layout: legacy, geopackage: { type: 'area', id: 'old', editor: 'geopackage' } } })]])
  const { api } = await studio(storage)
  assert.equal(api.screen.get().active, 'layout')
  assert.equal(api.activeTree().ratio, 0.61)
  assert.equal(api.activeTree().a.id, 'kept-map')
  assert.equal(api.activeTree().b.id, 'retired-panel')
  assert.equal(api.activeTree().b.editor, 'reports')
  assert.equal(api.WORKSPACES.some(w => w.id === 'geopackage'), false)
  assert.equal('geopackage' in api.screen.get().trees, false)
})

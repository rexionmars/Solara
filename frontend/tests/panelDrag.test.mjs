import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

async function studio() {
  const events = new Map(), timers = new Map(), storage = new Map()
  let timerId = 0
  const createStore = initial => {
    let value = initial
    const listeners = new Set()
    return { get: () => value, set: next => { value = typeof next === 'function' ? next(value) : next; listeners.forEach(fn => fn()) }, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
  }
  const window = {
    addEventListener: (name, fn) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn) },
    removeEventListener: (name, fn) => events.get(name)?.delete(fn),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id),
  }
  const surface = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }) }
  const element = (id, left) => ({ dataset: { area: id }, getBoundingClientRect: () => ({ left, top: 0, width: 500, height: 600 }), closest: selector => selector === '[data-studio-surface]' ? surface : elements[id] })
  const elements = { map: element('map', 0), data: element('data', 500) }
  const document = { body: { style: { cursor: '' } },
    elementFromPoint: (x, y) => x < 0 || y < 0 || x > 1000 || y > 600 ? null : elements[x < 500 ? 'map' : 'data'],
    querySelector: selector => elements[selector.match(/data-area="([^"]+)"/)?.[1]],
  }
  const context = vm.createContext({ window, document, CSS: { escape: String }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } })
  const icons = Object.fromEntries(['ChartBar', 'CheckSquare', 'Cube', 'Fan', 'Graph', 'Mountains', 'PlugsConnected', 'Sun', 'Table', 'TerminalWindow'].map(name => [name, () => null]))
  const mocks = { './icons': icons, './editors': { EDITORS: ['map', 'table'].map(id => ({ id })), editorMeta: id => ({ id, unique: id === 'map' }) }, './selection': { select() {} }, './store': { createStore } }
  const cache = new Map()
  const load = name => {
    if (cache.has(name)) return cache.get(name)
    const task = (async () => {
      if (mocks[name]) return new vm.SyntheticModule(Object.keys(mocks[name]), function () { for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value) }, { context })
      const source = await readFile(new URL(`../src/lib/${name.slice(2)}.ts`, import.meta.url), 'utf8')
      const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context })
      await module.link(load)
      return module
    })()
    cache.set(name, task)
    return task
  }
  const module = await load('./panelDrag')
  await module.evaluate()
  const api = module.namespace, screen = (await load('./screen')).namespace
  const a = { type: 'area', id: 'map', editor: 'map' }, b = { type: 'area', id: 'data', editor: 'table' }
  const root = { type: 'split', id: 'root', dir: 'row', ratio: 0.5, a, b }
  screen.screen.set({ active: 'layout', maximized: null, trees: { layout: root } })
  screen.areaStates.set({ map: { camera: 'unchanged' }, data: { search: 'wind' } })
  const send = (name, values = {}) => {
    const event = { pointerId: 1, clientX: 750, clientY: 300, preventDefault() { this.defaultPrevented = true }, stopImmediatePropagation() { this.stopped = true }, ...values }
    for (const fn of [...(events.get(name) ?? [])]) { fn(event); if (event.stopped) break }
    return event
  }
  const begin = () => api.beginPanelDrag({ button: 0, pointerId: 1, clientX: 100, clientY: 100, currentTarget: { setPointerCapture() {}, hasPointerCapture: () => false }, preventDefault() {} }, 'map')
  const flush = () => { const tasks = [...timers.values()]; timers.clear(); tasks.forEach(fn => fn()) }
  return { api, screen, root, send, begin, flush, storage, events, document }
}

test('pointer release commits once, saves layout and keeps per-panel settings attached to IDs', async () => {
  const { api, screen, send, begin, flush, storage } = await studio()
  const settings = screen.areaStates.get()
  begin()
  send('pointermove')
  assert.equal(api.panelDrag.get().target.position, 'center')
  send('pointerup')
  assert.equal(screen.activeTree().a.id, 'data')
  assert.equal(screen.activeTree().b.id, 'map')
  assert.equal(api.panelDrag.get(), null)
  assert.equal(screen.areaStates.get(), settings)
  assert.equal(send('click').defaultPrevented, true)
  flush()
  assert.equal(JSON.parse(storage.get('terra-energy.studio.v2')).trees.layout.a.id, 'data')
})

for (const cancelledBy of ['Escape', 'pointercancel', 'blur']) test(`${cancelledBy} cancels without changing the layout or leaving listeners`, async () => {
  const { api, screen, root, send, begin, events, document } = await studio()
  begin(); send('pointermove')
  assert.ok(api.panelDrag.get())
  send(cancelledBy === 'Escape' ? 'keydown' : cancelledBy, { key: 'Escape' })
  assert.equal(api.panelDrag.get(), null)
  assert.equal(screen.activeTree(), root)
  assert.equal(document.body.style.cursor, '')
  assert.equal(events.get('pointermove').size, 0)
  send('pointerup')
  assert.equal(screen.activeTree(), root)
})

test('short header clicks and drops outside the studio do not reorganize panels', async () => {
  const { api, screen, root, send, begin } = await studio()
  begin(); send('pointermove', { clientX: 102, clientY: 101 }); send('pointerup', { clientX: 102, clientY: 101 })
  assert.equal(api.panelDrag.get(), null)
  assert.equal(screen.activeTree(), root)
  begin(); send('pointermove'); send('pointerup', { clientX: -10 })
  assert.equal(screen.activeTree(), root)
})

test('changing workspace cancels an in-progress drag', async () => {
  const { api, screen, root, send, begin } = await studio()
  begin(); send('pointermove')
  screen.setWorkspace('data')
  assert.equal(api.panelDrag.get(), null)
  send('pointerup')
  assert.equal(screen.screen.get().trees.layout, root)
})

test('keyboard docking and cancellation use the same layout operation', async () => {
  const { api, screen, root, send } = await studio()
  api.beginPanelKeyboardDrag('map')
  send('keydown', { key: 'ArrowUp' })
  assert.equal(api.panelDrag.get().target.position, 'top')
  send('keydown', { key: 'Escape' })
  assert.equal(screen.activeTree(), root)
  api.beginPanelKeyboardDrag('map')
  send('keydown', { key: 'ArrowDown' })
  send('keydown', { key: 'Enter' })
  assert.equal(screen.activeTree().dir, 'col')
  assert.equal(screen.activeTree().b.id, 'map')
  assert.equal(api.panelDrag.get(), null)
})

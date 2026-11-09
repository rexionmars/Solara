import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

async function shell(storage = new Map()) {
  const createStore = initial => {
    let value = initial
    const listeners = new Set()
    return { get: () => value, set: next => { value = typeof next === 'function' ? next(value) : next; listeners.forEach(fn => fn()) }, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
  }
  const context = vm.createContext({ localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } })
  const source = await readFile(new URL('../src/lib/shell.ts', import.meta.url), 'utf8')
  const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context })
  await module.link(async name => {
    assert.equal(name, './store')
    return new vm.SyntheticModule(['createStore'], function () { this.setExport('createStore', createStore) }, { context })
  })
  await module.evaluate()
  return module.namespace
}

test('one panel at a time: opening another closes the last, and the same one twice closes it', async () => {
  const s = await shell()
  s.togglePanel('layers')
  assert.equal(s.shell.get().panel, 'layers')
  s.togglePanel('result')
  assert.equal(s.shell.get().panel, 'result')
  s.togglePanel('result')
  assert.equal(s.shell.get().panel, null)
})

test('a destination is mounted the first time it is visited and kept after', async () => {
  const s = await shell()
  assert.deepEqual([...s.shell.get().opened], [])
  s.goTo('planning')
  s.goTo('explore')
  s.goTo('compare')
  s.goTo('planning')
  assert.equal(s.shell.get().destination, 'planning')
  assert.deepEqual([...s.shell.get().opened], ['planning', 'compare'])
})

test('a panel asked for from a destination brings the reader back to the map with it open', async () => {
  const s = await shell()
  s.togglePanel('products')
  s.goTo('graph')
  s.togglePanel('products')
  assert.equal(s.shell.get().destination, 'explore')
  assert.equal(s.shell.get().panel, 'products', 'the panel was behind the destination, so the press shows it rather than closing it')
})

test('the rail remembers whether it shows its labels', async () => {
  const storage = new Map()
  const first = await shell(storage)
  assert.equal(first.railOpen.get(), false)
  first.railOpen.set(true)
  const second = await shell(storage)
  assert.equal(second.railOpen.get(), true)
})

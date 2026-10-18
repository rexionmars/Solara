import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

const context = vm.createContext({})
const source = await readFile(new URL("../src/lib/ribbonContext.ts", import.meta.url), "utf8")
const module = new vm.SourceTextModule(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { context },
)
await module.link(() => {
  throw new Error("Ribbon context must stay independent of runtime state.")
})
await module.evaluate()
const { ribbonContext, resolveRibbonTab } = module.namespace

test("Planning exposes study/solve/export instead of unrelated map and project analysis commands", () => {
  const c = ribbonContext("planning", ["planning"])
  assert.deepEqual(Array.from(c.tabs), ["study", "run", "view", "share"])
  assert.deepEqual(Array.from(c.products), [])
  assert.equal(c.planning, true)
  assert.equal(resolveRibbonTab(c, "map"), "study")
})

test("Default retains the general tools; map tools follow actual panel availability", () => {
  const c = ribbonContext("layout", ["map", "properties", "reports", "outliner"])
  assert.deepEqual(Array.from(c.tabs), ["map", "analysis", "view", "share"])
  assert.equal(c.products.length, 6)
  assert.equal(resolveRibbonTab(c), "map")
  const noMap = ribbonContext("layout", ["reports", "outliner"])
  assert.equal(noMap.tabs.includes("map"), false)
  assert.equal(resolveRibbonTab(noMap, "map"), "analysis")
  assert.equal(ribbonContext("planning", ["planning", "map"]).tabs.includes("map"), true)
})

for (const [workspace, editor, expected] of [
  ["solar", "solar", ["solar", "terrain"]],
  ["terrain", "terrain", ["solar", "terrain"]],
  ["wind", "wind", ["wind"]],
  ["connection", "connection", ["connection", "demand"]],
  ["demand", "demand", ["connection", "demand"]],
  ["ground", "ground", ["ground"]],
])
  test(`${workspace} limits the analyses and exports to its subject`, () => {
    const c = ribbonContext(workspace, ["map", editor, "properties"])
    assert.deepEqual(Array.from(c.products), expected)
    assert.equal(c.defaultTab, "analysis")
  })

test("Data and Scripting have task-specific entrances and discard stale tabs", () => {
  const data = ribbonContext("data", ["table", "map"])
  const scripts = ribbonContext("scripting", ["console", "reports", "map"])
  assert.equal(resolveRibbonTab(data), "data")
  assert.equal(resolveRibbonTab(scripts, "share"), "tools")
  assert.equal(scripts.tabs.includes("analysis"), false)
  assert.equal(data.tabs.includes("analysis"), false)
  assert.equal(resolveRibbonTab(data, "share"), "share")
})

async function preferences(storage) {
  const createStore = (initial) => {
    let value = initial
    const listeners = new Set()
    return {
      get: () => value,
      set: (next) => {
        value = typeof next === "function" ? next(value) : next
        listeners.forEach((fn) => fn())
      },
      subscribe: (fn) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    }
  }
  const env = vm.createContext({
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  })
  const uiSource = await readFile(new URL("../src/lib/ui.ts", import.meta.url), "utf8")
  const ui = new vm.SourceTextModule(
    ts.transpileModule(uiSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { context: env },
  )
  const config = new vm.SourceTextModule(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { context: env },
  )
  await config.link(() => {})
  await ui.link((name) =>
    name === "./ribbonContext"
      ? config
      : new vm.SyntheticModule(
          ["createStore"],
          function () {
            this.setExport("createStore", createStore)
          },
          { context: env },
        ),
  )
  await ui.evaluate()
  return ui.namespace
}

test("tab choices persist independently for each workspace and preserve the legacy Default preference", async () => {
  const storage = new Map([["terra-energy.ribbon-tab.v1", "analysis"]])
  const ui = await preferences(storage)
  assert.equal(ui.workspaceRibbonTabs.get().layout, "analysis")
  ui.workspaceRibbonTabs.set((tabs) => ({ ...tabs, planning: "run", solar: "share" }))
  const restored = await preferences(storage)
  assert.equal(restored.workspaceRibbonTabs.get().planning, "run")
  assert.equal(restored.workspaceRibbonTabs.get().solar, "share")
  assert.equal(restored.workspaceRibbonTabs.get().layout, "analysis")
  restored.workspaceRibbonTabs.set((tabs) => ({ ...tabs, planning: "study" }))
  assert.equal(restored.workspaceRibbonTabs.get().solar, "share")
})

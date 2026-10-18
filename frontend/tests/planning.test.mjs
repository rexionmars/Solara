import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"

async function controller(backend) {
  const createStore = (value) => ({
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? next(value) : next
    },
  })
  const energy = createStore(null),
    active = createStore(false),
    saved = new Map()
  const timers = []
  let off = 0,
    cancellations = 0
  const mocks = {
    "../../wailsjs/go/main/App": {
      AnalyzeSystemPlanning: backend ?? (async (study) => ({ study, created_at: new Date().toISOString() })),
      CancelRun: async () => {
        cancellations++
        return true
      },
    },
    "../../wailsjs/runtime/runtime": {
      EventsOn: () => () => {
        off++
      },
    },
    "./analysis": { running: energy, systemPlanningActive: active },
    "./errors": { errorMessage: String },
    "./store": { createStore },
  }
  const context = vm.createContext({
    structuredClone,
    localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, val) => saved.set(key, val) },
    setTimeout: (fn) => {
      timers.push(fn)
      return timers.length
    },
    clearTimeout: () => {},
  })
  const source = await readFile(new URL("../src/lib/planning.ts", import.meta.url), "utf8")
  const mod = new vm.SourceTextModule(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { context },
  )
  await mod.link(
    (name) =>
      new vm.SyntheticModule(
        Object.keys(mocks[name]),
        function () {
          for (const [key, val] of Object.entries(mocks[name])) this.setExport(key, val)
        },
        { context },
      ),
  )
  await mod.evaluate()
  return {
    api: mod.namespace,
    energy,
    active,
    timers,
    saved,
    get off() {
      return off
    },
    get cancellations() {
      return cancellations
    },
  }
}

test("synthetic example imports from studies and reports; malformed shapes are rejected", async () => {
  const { api } = await controller()
  const example = api.exampleStudy()
  assert.equal(example.snapshots.length, 24)
  assert.match(example.provenance, /Synthetic/)
  assert.equal(api.parseStudy({ study: example }).buses.length, 2)
  assert.throws(() => api.parseStudy({ ...example, generators: [null] }), /Invalid generators row/)
  assert.throws(
    () => api.parseStudy({ ...example, generators: [{ ...example.generators[0], availability: [null] }] }),
    /expected array/,
  )
  assert.throws(() => api.parseStudy({ ...example, snapshots: {} }), /must be a list/)
})

test("study comparison survives Go map key reordering but detects changed values", async () => {
  const { api } = await controller()
  const study = api.exampleStudy()
  const reordered = JSON.parse(
    JSON.stringify(study, (_, v) =>
      v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    ),
  )
  assert.equal(api.studyKey(study), api.studyKey(reordered))
  reordered.generators[0].existing_mw++
  assert.notEqual(api.studyKey(study), api.studyKey(reordered))
})

test("execution snapshots the inputs and retains them after the draft changes", async () => {
  let finish
  const c = await controller(
    (study) =>
      new Promise((resolve) => {
        finish = () => resolve({ study, created_at: "run-1" })
      }),
  )
  c.api.updateStudy(c.api.exampleStudy())
  const run = c.api.runPlanning()
  assert.equal(c.active.get(), true)
  assert.equal(c.api.planning.get().busy, true)
  c.api.updateStudy({ ...c.api.planning.get().study, name: "Changed later" })
  finish()
  await run
  assert.equal(c.api.planning.get().results[0].study.name, "Synthetic two-bus system")
  assert.equal(c.api.planning.get().study.name, "Changed later")
  assert.equal(c.active.get(), false)
  assert.equal(c.off, 1)
})

test("overlapping site analyses block planning; failures release the shared slot", async () => {
  const c = await controller(async () => {
    throw new Error("infeasible")
  })
  c.energy.set({ product: "solar" })
  await c.api.runPlanning()
  assert.match(c.api.planning.get().error, /Another analysis/)
  assert.equal(c.active.get(), false)
  c.energy.set(null)
  await c.api.runPlanning()
  assert.match(c.api.planning.get().error, /infeasible/)
  assert.equal(c.active.get(), false)
  assert.equal(c.api.planning.get().busy, false)
  assert.equal(c.off, 1)
})

test("planning cancellation does not cancel an idle slot and reports cancellation cleanly", async () => {
  let reject
  const c = await controller(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  await c.api.cancelPlanning()
  assert.equal(c.cancellations, 0)
  const run = c.api.runPlanning()
  await c.api.cancelPlanning()
  assert.equal(c.cancellations, 1)
  reject("the request was cancelled")
  await run
  assert.equal(c.api.planning.get().error, "")
  assert.match(c.api.planning.get().notice, /cancelled/)
  assert.equal(c.active.get(), false)
})

test('ribbon and panel cannot optimize until pending profiles have been applied', async () => {
  let calls = 0
  const c = await controller(async study => { calls++; return { study, created_at: 'run' } })
  c.api.planning.set(s => ({ ...s, pendingProfiles: { 'load:demand': true }, profileDrafts: { demand: 'invalid draft' } }))
  await c.api.runPlanning()
  assert.equal(calls, 0)
  assert.equal(c.active.get(), false)
  assert.match(c.api.planning.get().error, /profiles/)
  c.api.planning.set(s => ({ ...s, pendingProfiles: {} }))
  await c.api.runPlanning()
  assert.equal(calls, 1)
  assert.equal(c.api.planning.get().view, 'results')
})

test('shared study actions reset input views and profile drafts without replacing a running solve', async () => {
  const c = await controller()
  c.api.planning.set(s => ({ ...s, view: 'results', pendingProfiles: { load: true }, profileDrafts: { load: 'draft' } }))
  c.api.replacePlanningStudy(c.api.exampleStudy())
  assert.equal(c.api.planning.get().view, 'study')
  assert.equal(c.api.planning.get().revision, 1)
  assert.equal(c.api.planningHasPendingProfiles(), false)
  assert.equal(Object.keys(c.api.planning.get().profileDrafts).length, 0)
  c.api.planning.set(s => ({ ...s, busy: true }))
  c.api.replacePlanningStudy(c.api.emptyStudy())
  assert.equal(c.api.planning.get().study.name, 'Synthetic two-bus system')
  assert.equal(c.api.planning.get().revision, 1)
})

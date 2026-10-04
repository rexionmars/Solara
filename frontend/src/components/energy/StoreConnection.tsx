import { useEffect, useState, type ReactNode } from "react"
import {
  EMPTY_CONNECTION,
  chooseGridConnection,
  disconnectGridStore,
  forgetLayers,
  gridStore,
  importConnection,
  savedConnection,
  storeReport,
  testGridStore,
  type StoreConnection,
} from "../../lib/grid"
import { useStore } from "../../lib/store"
import { btnGhost, btnGhostDense, btnPrimary, fieldInput } from "../ui/buttons"

const SSL_MODES = [
  { value: "", label: "Default (prefer)" },
  { value: "disable", label: "Disable" },
  { value: "require", label: "Require" },
  { value: "verify-ca", label: "Verify CA" },
  { value: "verify-full", label: "Verify full" },
]

type TestState = { kind: "idle" } | { kind: "testing" } | { kind: "passed"; message: string } | { kind: "refused"; message: string }

/**
 * The grid store's connection, field by field, as a database client asks for it.
 *
 * NOTHING IS READ UNTIL THIS CONNECTS, in every session. The connection last
 * used is remembered and comes back filled in, but it is not used until
 * Connect is pressed; and there is no store the application falls back to: the fields left empty stand for the local default
 * (socket, terra_br, your own role), but it takes Connect to make it the
 * store, and Disconnect to leave it. Test asks whether these fields would work
 * and changes nothing; Connect checks them again and refuses a store that does
 * not answer.
 *
 * The fields are a way of writing the connection string, which is still what
 * is saved: pasting one fills them, and what they cannot show is carried
 * along.
 *
 * THE PASSWORD IS NEVER PREFILLED. The shell does not send a saved one back,
 * so an empty field over a saved password means "the same one", and the
 * placeholder says so.
 *
 * `dense` is the run graph's card, 208 px wide; without it, the settings page.
 */
export function StoreConnectionForm({ dense = false }: { dense?: boolean }) {
  const s = useStore(gridStore)
  const report = storeReport(s)
  const source = report?.dsn_source
  const [form, setForm] = useState<StoreConnection>(EMPTY_CONNECTION)
  const [dirty, setDirty] = useState(false)
  const [test, setTest] = useState<TestState>({ kind: "idle" })
  const [importing, setImporting] = useState<string | null>(null)

  // Read again whenever the store in use changes, from here or from the other
  // place this form is shown; what is being typed is never replaced.
  useEffect(() => {
    if (dirty) return
    let stale = false
    void savedConnection().then((c) => {
      if (!stale) setForm(c)
    })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.dsn, source])

  const edit = (patch: Partial<StoreConnection>) => {
    setForm((f) => ({ ...f, ...patch }))
    setDirty(true)
    // A verdict on the fields as they were says nothing about them now.
    setTest({ kind: "idle" })
  }

  const runTest = async () => {
    setTest({ kind: "testing" })
    const r = await testGridStore(form)
    if ("failed" in r) setTest({ kind: "refused", message: r.failed })
    else if (!r.reachable) setTest({ kind: "refused", message: r.unreachable ?? "The store did not answer." })
    else {
      const cov = r.coverage
      setTest({
        kind: "passed",
        message: `Answers: ${cov?.plants.registered.toLocaleString() ?? 0} plants, ${cov?.network.lines_in_service.toLocaleString() ?? 0} lines in service.`,
      })
    }
  }
  const settled = async () => {
    // The layers were read from the store that was connected before.
    forgetLayers()
    setForm(await savedConnection())
    setDirty(false)
    setTest({ kind: "idle" })
  }
  const connect = async () => {
    if (await chooseGridConnection(form)) await settled()
  }
  const disconnect = async () => {
    if (await disconnectGridStore()) await settled()
  }
  const runImport = async () => {
    if (!importing?.trim()) return
    const parsed = await importConnection(importing)
    if (!parsed) return
    setForm(parsed)
    setDirty(true)
    setTest({ kind: "idle" })
    setImporting(null)
  }

  const connected = source === "chosen"
  const busy = s.kind === "checking" || test.kind === "testing"
  const canConnect = !busy && (dirty || !connected)

  const input = dense
    ? "telemetry h-[1.375rem] w-full min-w-0 rounded-sm border-0 bg-sunk px-2 text-meta text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
    : `${fieldInput} telemetry`
  const select = dense
    ? "h-[1.375rem] w-full min-w-0 rounded-sm border-0 bg-selected px-1.5 text-meta text-foreground outline-none inset-ring-1 inset-ring-line-strong/60 hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring"
    : fieldInput
  const ghost = dense ? `${btnGhostDense} !h-6` : btnGhost
  const primary = dense ? `${btnPrimary} !h-6 !px-2 !text-meta` : btnPrimary
  const small = dense ? "text-micro" : "text-meta"

  const labelled = (label: string, control: ReactNode, className = "") => (
    <label className={`flex min-w-0 flex-col ${dense ? "gap-0.5" : "gap-1"} ${className}`}>
      <span className={`${small} text-muted-foreground`}>{label}</span>
      {control}
    </label>
  )
  const field = (key: "host" | "port" | "user" | "password" | "database", placeholder: string, type = "text") => (
    <input
      type={type}
      value={form[key]}
      onChange={(e) => edit({ [key]: e.target.value })}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter" && canConnect) void connect()
      }}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className={input}
    />
  )
  const host = labelled("Host", field("host", "local socket"), "flex-1")
  const port = labelled("Port", field("port", "5432"), `${dense ? "w-14" : "w-20"} shrink-0`)
  const user = labelled("User", field("user", "your own role"))
  const password = labelled("Password", field("password", form.has_password ? "saved; type to replace" : "none", "password"))
  const database = labelled("Database", field("database", "terra_br"))
  const ssl = labelled(
    "SSL",
    <select value={form.ssl_mode} onChange={(e) => edit({ ssl_mode: e.target.value })} className={select}>
      {/* A mode the card does not list, arrived in an imported URL, is kept and shown as it is. */}
      {(SSL_MODES.some((m) => m.value === form.ssl_mode) ? SSL_MODES : [...SSL_MODES, { value: form.ssl_mode, label: form.ssl_mode }]).map((m) => (
        <option key={m.value} value={m.value} style={{ background: "rgb(var(--p-surface))" }}>
          {m.label}
        </option>
      ))}
    </select>,
  )

  return (
    <div className={`flex flex-col ${dense ? "gap-1" : "gap-1.5"}`}>
      {source === "TERRA_BR_DSN" && (
        <p className={`${small} leading-relaxed`} style={{ color: "var(--warning)" }}>
          TERRA_BR_DSN is set in this application's environment, and it is what is read. A store connected here is kept for when it is not.
        </p>
      )}
      {importing === null ? (
        <button type="button" className={`${dense ? ghost : btnGhostDense} self-start`} onClick={() => setImporting("")}>
          Import from URL
        </button>
      ) : (
        <div className="flex gap-1">
          <input
            autoFocus
            value={importing}
            onChange={(e) => setImporting(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter") void runImport()
              if (e.key === "Escape") setImporting(null)
            }}
            placeholder="postgresql://user:password@host:5432/terra_br"
            aria-label="Connection URL"
            spellCheck={false}
            className={input}
          />
          <button type="button" className={ghost} disabled={!importing.trim()} onClick={() => void runImport()}>
            Fill
          </button>
        </div>
      )}
      <div className={`flex ${dense ? "gap-1" : "gap-2"}`}>
        {host}
        {port}
      </div>
      {dense ? (
        <>
          {user}
          {password}
          <div className="grid grid-cols-2 gap-1">
            {database}
            {ssl}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {user}
            {password}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {database}
            {ssl}
          </div>
          <p className="text-meta leading-relaxed text-muted-foreground">
            An empty field is the default: the local socket, database terra_br, your own role. Nothing is read until the store is connected. A
            password is kept in a file only you can read, and never shown.
          </p>
        </>
      )}
      {(test.kind === "passed" || test.kind === "refused") && (
        <p
          className={`selectable whitespace-pre-wrap ${small} ${dense ? "line-clamp-4 leading-snug" : ""}`}
          style={{ color: test.kind === "passed" ? "var(--success)" : "var(--destructive-quiet)" }}
          title={test.message}
        >
          {test.message}
        </p>
      )}
      <div className={`flex flex-wrap items-center ${dense ? "gap-1 pt-0.5" : "gap-1.5"}`}>
        {connected && (
          <button type="button" className={ghost} disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className={ghost} disabled={busy} onClick={() => void runTest()}>
          {test.kind === "testing" ? "Testing…" : "Test"}
        </button>
        <button type="button" className={primary} disabled={!canConnect} onClick={() => void connect()}>
          {connected && dirty ? "Reconnect" : "Connect"}
        </button>
      </div>
    </div>
  )
}

const ENTITY_LABEL: Record<string, string> = { plant: "Plants", substation: "Substations", line: "Lines", boundary: "Boundaries" }

/**
 * What the connected store is and what it holds.
 *
 * For a store prepared to the contract this is the contract read back, table
 * by table: what is there, how much, and every departure from it said as the
 * thing to fix. It is written for the person preparing the store, who reads it
 * here because this is where they find out whether what they loaded can be
 * read. A table that is absent is not a fault -- the contract makes each one
 * optional -- so it is shown muted, not as an error.
 */
export function StoreHoldings({ dense = false }: { dense?: boolean }) {
  const report = storeReport(useStore(gridStore))
  const info = report?.coverage?.store
  const cov = report?.coverage
  if (!report?.reachable || !cov) return null
  const small = dense ? "text-micro" : "text-meta"

  if (!info || info.profile !== "contract") {
    return (
      <span className={`${small} text-muted-foreground`}>
        {info?.name ? `${info.name} · ` : ""}
        {cov.plants.registered.toLocaleString()} plants · {cov.network.lines_in_service.toLocaleString()} lines
      </span>
    )
  }
  return (
    <div className={`flex flex-col ${dense ? "gap-0.5" : "gap-1"}`}>
      <span className={`${small} truncate text-foreground`} title={info.name ?? undefined}>
        {info.name ?? "Unnamed store"}
        <span className="text-muted-foreground"> · contract v{info.contract_version ?? "?"}</span>
      </span>
      {info.problems.map((p) => (
        <p key={p} className={`${small} leading-snug`} style={{ color: "var(--warning)" }}>
          {p}
        </p>
      ))}
      {info.entities.map((e) => (
        <div key={e.entity} className="flex flex-col">
          <div className={`flex items-baseline justify-between gap-2 ${small}`}>
            <span className={e.present ? "text-foreground" : "text-muted-foreground"}>{ENTITY_LABEL[e.entity] ?? e.entity}</span>
            <span className="telemetry text-muted-foreground">{e.present ? e.rows.toLocaleString() : "not in this store"}</span>
          </div>
          {e.problems.map((p) => (
            <p key={p} className={`${small} leading-snug`} style={{ color: "var(--warning)" }} title={`${e.table}: ${p}`}>
              {p}
            </p>
          ))}
        </div>
      ))}
      {!info.capabilities.brazil && (
        <p className={`${small} leading-snug text-muted-foreground`}>
          Consumption, curtailment and concessions are read from the Brazilian record only, and are not available from this store.
        </p>
      )}
    </div>
  )
}

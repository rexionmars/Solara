import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import {
  account,
  clearAvatar,
  errorMessage,
  login,
  register,
  setAvatar,
  updateDisplayName,
  type User,
} from "../../lib/account"
import { runCommand } from "../../lib/commands"
import { useStore } from "../../lib/store"
import { Avatar } from "./Avatar"

const FIELD =
  "w-full rounded border border-line bg-sunken px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/60 focus:border-accent"
const BUTTON =
  "rounded border border-line bg-raised px-3 py-1.5 text-xs text-ink hover:bg-hover disabled:cursor-default disabled:opacity-50"
const PRIMARY =
  "rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-default disabled:opacity-60"

const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]
// Checked before decoding. The photo sent to the Go side is re-encoded at
// AVATAR_SIZE and is far smaller than this.
const MAX_SOURCE_BYTES = 20_000_000
const AVATAR_SIZE = 256

/** Crop the image to a centred square and scale it to AVATAR_SIZE, as PNG. */
async function squareAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("the photo could not be drawn")
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE
    )
    return canvas.toDataURL("image/png")
  } finally {
    bitmap.close()
  }
}

// ---- Signed out -------------------------------------------------------------

function SignInForm() {
  const [mode, setMode] = useState<"signin" | "register">("signin")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const registering = mode === "register"

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (registering) await register(email, password, name)
      else await login(email, password)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Account</p>
      <h2 className="mt-1 text-xl font-semibold text-ink">{registering ? "Create account" : "Sign in"}</h2>
      <p className="mt-2 text-sm text-muted">
        Accounts are stored on this computer only and nothing is sent to a server. Without one you work as the
        guest.
      </p>

      <div role="tablist" className="mt-6 grid grid-cols-2 rounded border border-line bg-sunken p-0.5 text-xs">
        {(["signin", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m)
              setError(null)
            }}
            className={`rounded-sm py-1.5 ${mode === m ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        {registering && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Display name
            <input
              className={FIELD}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted">
          Email
          <input
            className={FIELD}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Password
          <input
            className={FIELD}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={registering ? "new-password" : "current-password"}
            placeholder={registering ? "At least 8 characters" : undefined}
            required
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-fail">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={`${PRIMARY} mt-1`}>
          {busy ? "…" : registering ? "Create account" : "Sign in"}
        </button>
      </form>
    </div>
  )
}

// ---- Signed in --------------------------------------------------------------

/**
 * One setting: what it is on the left, its control on the right. The left rule
 * lights in the accent while anything inside has focus, so the row being
 * edited is visible from across the page.
 */
function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-l-2 border-b-line border-l-transparent py-4 pl-4 focus-within:border-l-accent">
      <div className="min-w-0">
        <h3 className="text-sm text-ink">{title}</h3>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">{children}</div>
    </div>
  )
}

function PhotoControl({ user }: { user: User }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async (file: File | undefined) => {
    if (input.current) input.current.value = ""
    if (!file) return
    setError(null)
    if (!PHOTO_TYPES.includes(file.type)) {
      setError("Choose a PNG, JPEG, WebP or GIF image.")
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("The image is larger than 20 MB.")
      return
    }
    setBusy(true)
    try {
      await setAvatar(await squareAvatar(file))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await clearAvatar()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar user={user} size={48} />
        <input
          ref={input}
          type="file"
          accept={PHOTO_TYPES.join(",")}
          className="hidden"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <button type="button" className={BUTTON} disabled={busy} onClick={() => input.current?.click()}>
          Upload
        </button>
        {user.avatar_uri && (
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-fail">
          {error}
        </p>
      )}
    </>
  )
}

function NameControl({ user }: { user: User }) {
  const [value, setValue] = useState(user.display_name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
    Re-seeded from the name string, not from the user object. TERRA seeded
    this field from the object, which is replaced on every account update, and
    the field reset itself while it was being typed into.
  */
  useEffect(() => setValue(user.display_name), [user.display_name])

  const unchanged = value.trim() === user.display_name

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (unchanged) return
    setBusy(true)
    setError(null)
    try {
      await updateDisplayName(value)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          className={`${FIELD} w-56 py-1.5`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Display name"
          maxLength={80}
        />
        <button type="submit" className={BUTTON} disabled={busy || unchanged}>
          Save
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-fail">
          {error}
        </p>
      )}
    </form>
  )
}

function memberSince(createdAt: string): string {
  const d = new Date(createdAt)
  return Number.isNaN(d.getTime())
    ? createdAt
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
}

function ProfileView({ user }: { user: User }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="flex items-center gap-4 border-b border-line pb-6">
        <Avatar user={user} size={64} />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Account</p>
          <h2 className="truncate text-xl font-semibold text-ink">{user.display_name}</h2>
          <p className="truncate text-xs text-muted">
            {user.email} · member since {memberSince(user.created_at)}
          </p>
        </div>
      </header>

      <SettingRow title="Profile photo" description="PNG, JPEG, WebP or GIF, cropped to a centred square and stored at 256 pixels.">
        <PhotoControl user={user} />
      </SettingRow>
      <SettingRow title="Display name" description="Shown on this tab, beside the ribbon and in the status bar.">
        <NameControl user={user} />
      </SettingRow>
      <SettingRow title="Email" description="Identifies the account on this computer. Not editable.">
        <span className="font-mono text-xs text-muted">{user.email}</span>
      </SettingRow>
      <SettingRow title="Sign out" description="Continue as the guest. The account stays on this computer.">
        <button type="button" className={BUTTON} onClick={() => void runCommand("LOGOUT")}>
          Sign out
        </button>
      </SettingRow>
    </div>
  )
}

/** The Account tab: the sign-in form for the guest, the profile once signed in. */
export function AccountDocument() {
  const { loaded, user } = useStore(account)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-8 pb-28 pt-10">
      {!loaded ? (
        <p className="text-center text-sm text-muted">Loading…</p>
      ) : user ? (
        <ProfileView user={user} />
      ) : (
        <SignInForm />
      )}
    </div>
  )
}

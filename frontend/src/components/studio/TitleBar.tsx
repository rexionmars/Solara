import { useEffect, useState } from "react"
import { Minus, SignIn, Square, X } from "../../lib/icons"
import { Environment, Quit, WindowMinimise, WindowToggleMaximise } from "../../../wailsjs/runtime/runtime"
import { account } from "../../lib/account"
import { BRAND_TAGLINE } from "../../lib/brand"
import { useStore } from "../../lib/store"
import { preferences } from "../../lib/ui"
import { Avatar } from "../account/Avatar"

/**
 * The window's own band, as TERRA's TitleBar: the wordmark clear of the
 * traffic lights, and the account.
 * The empty space moves the window.
 */
export function TitleBar() {
  const { user, loaded } = useStore(account)
  const [onMac, setOnMac] = useState(true)

  // Asked of the runtime rather than of the user agent: Wails reports the platform it was built for.
  useEffect(() => {
    let cancelled = false
    void Environment()
      .then((env) => !cancelled && setOnMac(env.platform === "darwin"))
      .catch(() => !cancelled && setOnMac(false))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <header
      className="app-draggable relative flex h-11 shrink-0 items-center justify-between border-b pr-2"
      style={{
        background: "var(--s-app)",
        borderColor: "rgb(var(--p-line) / 0.28)",
        // The traffic lights own the first 4.5rem, and the wordmark keeps a centimetre clear of them.
        paddingLeft: onMac ? "calc(4.5rem + 1cm)" : "0.75rem",
      }}
    >
      <div className="flex items-center gap-2">
        <span className="brand-lockup text-[18px]">
          <img src="/solara-mark.svg" alt="" />
          <span className="brand-word">solara</span>
        </span>
        <span className="eyebrow hidden sm:inline">{BRAND_TAGLINE}</span>
      </div>

      <div className="flex items-center gap-3">
        {loaded && (
          <button
            type="button"
            onClick={() => preferences.set("account")}
            className="app-no-drag flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            title={user ? `${user.display_name} · Settings` : "Sign in"}
          >
            {user ? <Avatar user={user} size={20} /> : <SignIn className="size-4" />}
          </button>
        )}

        {/* On macOS the platform draws the window controls itself; everywhere else this bar is where they exist. */}
        {!onMac && (
          <div className="app-no-drag flex items-center gap-1">
            <WindowButton onClick={WindowMinimise} title="Minimize">
              <Minus className="h-3.5 w-3.5" />
            </WindowButton>
            <WindowButton onClick={WindowToggleMaximise} title="Maximize">
              <Square className="h-3 w-3" />
            </WindowButton>
            <WindowButton onClick={Quit} danger title="Close">
              <X className="h-3.5 w-3.5" />
            </WindowButton>
          </div>
        )}
      </div>
    </header>
  )
}

function WindowButton({ children, onClick, danger, title }: { children: React.ReactNode; onClick: () => void; danger?: boolean; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground ${
        danger ? "hover:bg-destructive hover:text-white" : "hover:bg-hover"
      }`}
    >
      {children}
    </button>
  )
}

import { useEffect, useState } from "react"
import { EventsOn } from "../wailsjs/runtime/runtime"
import { RevealMainWindow } from "../wailsjs/go/main/App"
import { SplashScreen } from "./components/SplashScreen"
import { Studio } from "./components/studio/Studio"

// Duration of .splash-screen--exit in index.css.
const SPLASH_EXIT_MS = 480

/*
  The backstop for a boot:ready that never arrives. The boot probe caps itself
  at eight seconds and the splash minimum is three, so past this something is
  stuck and the window opens anyway.
*/
const BOOT_BACKSTOP_MS = 12_000

export default function App() {
  const [booting, setBooting] = useState(true)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    let cancelled = false
    let started = false
    let exitTimer: number | undefined
    let revealTimer: number | undefined

    const finish = () => {
      if (cancelled || started) return
      started = true
      setExiting(true)
      exitTimer = window.setTimeout(async () => {
        if (cancelled) return
        try {
          await RevealMainWindow()
        } catch {
          /* the main window still mounts at splash size */
        }
        // Lets the OS settle the maximised frame before the map measures it.
        revealTimer = window.setTimeout(() => {
          if (!cancelled) setBooting(false)
        }, 120)
      }, SPLASH_EXIT_MS)
    }

    const off = EventsOn("boot:ready", finish)
    const backstop = window.setTimeout(finish, BOOT_BACKSTOP_MS)
    return () => {
      cancelled = true
      off()
      window.clearTimeout(backstop)
      window.clearTimeout(exitTimer)
      window.clearTimeout(revealTimer)
    }
  }, [])

  return booting ? <SplashScreen exiting={exiting} /> : <Studio />
}

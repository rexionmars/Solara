import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "maplibre-gl/dist/maplibre-gl.css"
import "./index.css"
import App from "./App"
import { forwardErrorsToTerminal } from "./lib/devDiagnostics"

if (import.meta.env.DEV) forwardErrorsToTerminal()

/**
 * Remove the static splash in index.html once React has painted its own.
 * Both show the same still, brand and position, so the handover is a
 * cross-fade between two identical frames rather than a visible swap.
 */
function dismissStaticSplash(minMs = 180): void {
  const el = document.getElementById("splash")
  if (!el) return
  const started = performance.now()

  const finish = () => {
    const wait = Math.max(0, minMs - (performance.now() - started))
    window.setTimeout(() => {
      const remove = () => el.remove()
      el.addEventListener("transitionend", remove, { once: true })
      el.classList.add("is-done")
      // transitionend does not fire when the transition is disabled.
      window.setTimeout(remove, 400)
    }, wait)
  }

  // Two frames: the first commits React's tree, the second has painted it.
  requestAnimationFrame(() => requestAnimationFrame(finish))
}

/*
  StrictMode is on from the start. In development it mounts every component
  twice, which is what exposes an effect without a cleanup -- a listener, a
  timer, a map left alive. Turning it on later means auditing every effect
  written without it.
*/
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

dismissStaticSplash()

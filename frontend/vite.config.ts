import fs from "node:fs"
import path from "node:path"
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

/**
 * Give index.html the values it cannot import: the splash still paths, the
 * tagline and the release name.
 *
 * The static splash paints before any bundle loads, so it cannot import the
 * modules that own these values. They are read out of those modules and
 * substituted for placeholders here, so one edit reaches both splashes. Every
 * still path is checked to exist, because a missing file would otherwise show
 * up only as a splash that paints nothing.
 */
function splashConstants(): Plugin {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf8")

  return {
    name: "splash-constants",
    transformIndexHtml(html) {
      const block = read("src/lib/splashBackground.ts").match(
        /export const SPLASH_STILLS: SplashStill\[\] = \[([\s\S]*?)\n\]/
      )
      if (!block) throw new Error("SPLASH_STILLS not found in src/lib/splashBackground.ts")
      const images = [...block[1].matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1])
      if (images.length === 0) throw new Error("SPLASH_STILLS declares no paths")
      for (const img of images) {
        if (!fs.existsSync(path.resolve(__dirname, "public", img.replace(/^\//, "")))) {
          throw new Error(`splash still missing from public/: ${img}`)
        }
      }

      const brand = read("src/lib/brand.ts")
      const constant = (name: string) => {
        const m = brand.match(new RegExp(`export const ${name} = "([^"]+)"`))
        if (!m) throw new Error(`${name} not found in src/lib/brand.ts`)
        return m[1]
      }

      return html
        .replace("__SPLASH_IMAGES__", JSON.stringify(images))
        .replaceAll("__BRAND_TAGLINE__", constant("BRAND_TAGLINE"))
        .replaceAll("__RELEASE_NAME__", constant("RELEASE_NAME"))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), splashConstants()],
})

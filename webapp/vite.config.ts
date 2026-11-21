import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { readdirSync, statSync, createReadStream, existsSync } from "node:fs"
import { resolve, join, normalize, extname } from "node:path"

/** Underwriter dashboard (dev): serves the report folders written by `python -m src.report --output <dir>/<case>`.
 *  Folders: ../reports (local jobs, git-ignored) and ../examples/reports (real reports committed by the team).
 *  REPORTS_DIR overrides the first one. A case present in both is taken from ../reports.
 *  GET /reports-api/cases            -> ["cmds-sa", ...]
 *  GET /reports-api/files/<case>/<p> -> that file (read-only, no path escape) */
function reports(): Plugin {
  const roots = [resolve(__dirname, process.env.REPORTS_DIR || "../reports"), resolve(__dirname, "../examples/reports")]
  const types: Record<string, string> = { ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" }
  const caseDir = (id: string) => roots.map((r) => join(r, id)).find((d) => existsSync(d) && statSync(d).isDirectory())
  return {
    name: "reports-api",
    configureServer(server) {
      server.middlewares.use("/reports-api", (req, res) => {
        const url = decodeURIComponent((req.url || "").split("?")[0])
        res.setHeader("Cache-Control", "no-store")
        if (url === "/cases") {
          const ids = new Set<string>()
          roots.forEach((r) => { if (existsSync(r)) readdirSync(r).filter((d) => statSync(join(r, d)).isDirectory()).forEach((d) => ids.add(d)) })
          res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify([...ids])); return
        }
        if (url.startsWith("/files/")) {
          const [id, ...rest] = url.slice(7).split("/"), dir = caseDir(id)
          const p = dir ? normalize(join(dir, ...rest)) : ""
          if (!dir || !p.startsWith(dir) || !existsSync(p) || !statSync(p).isFile()) { res.statusCode = 404; res.end("not found"); return }
          res.setHeader("Content-Type", types[extname(p).toLowerCase()] || "application/octet-stream"); createReadStream(p).pipe(res); return
        }
        res.statusCode = 404; res.end("not found")
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), reports()],
  server: { proxy: { "/api": process.env.LAUZHACK_API_URL || "http://127.0.0.1:8000" } },
  build: { rollupOptions: { input: { app: resolve(__dirname, "index.html"), dashboard: resolve(__dirname, "dashboard.html") } } },
})

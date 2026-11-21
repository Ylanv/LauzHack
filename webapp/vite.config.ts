import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { readdirSync, statSync, createReadStream, existsSync } from "node:fs"
import { resolve, join, normalize, extname } from "node:path"

/** Underwriter dashboard (dev): serves the report folders written by `python -m src.report --output reports/<case>`.
 *  GET /reports-api/cases            -> ["cmds-sa", ...]
 *  GET /reports-api/files/<case>/<p> -> that file (read-only, no path escape)
 *  Folder: REPORTS_DIR env, default ../reports (repo root). Without this plugin the dashboard can still open a folder from disk. */
function reports(): Plugin {
  const root = resolve(__dirname, process.env.REPORTS_DIR || "../reports")
  const types: Record<string, string> = { ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" }
  return {
    name: "reports-api",
    configureServer(server) {
      server.middlewares.use("/reports-api", (req, res) => {
        const url = decodeURIComponent((req.url || "").split("?")[0])
        res.setHeader("Cache-Control", "no-store")
        if (url === "/cases") {
          const list = existsSync(root) ? readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()) : []
          res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(list)); return
        }
        if (url.startsWith("/files/")) {
          const p = normalize(join(root, url.slice(7)))
          if (!p.startsWith(root) || !existsSync(p) || !statSync(p).isFile()) { res.statusCode = 404; res.end("not found"); return }
          res.setHeader("Content-Type", types[extname(p).toLowerCase()] || "application/octet-stream"); createReadStream(p).pipe(res); return
        }
        res.statusCode = 404; res.end("not found")
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), reports()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  build: { rollupOptions: { input: { app: resolve(__dirname, "index.html"), dashboard: resolve(__dirname, "dashboard.html") } } },
})

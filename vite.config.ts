import { defineConfig } from "vite";
import { resolve } from "node:path";
// @ts-expect-error pas de types Node dans ce projet
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  // Laisse voir les erreurs Rust et impose le port attendu par Tauri.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    // Mode navigateur : relaie les requêtes du wiki (sinon bloquées par CORS).
    proxy: {
      // Traduction des articles (lib/translate.ts), en mode navigateur.
      "/__gtr": {
        target: "https://translate.googleapis.com",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/__gtr/, ""),
        // Google refuse (429) les requêtes qui portent les en-têtes du navigateur : on ne les transmet pas.
        configure: (proxy) => proxy.on("proxyReq", (req) => {
          for (const name of req.getHeaderNames()) if (/^(sec-|origin|referer|cookie|accept-language|user-agent)/.test(name)) req.removeHeader(name);
        }),
      },
      "/__wiki": {
        target: "https://awakening.wiki",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/__wiki/, ""),
      },
    },
  },
  // Fenêtres : principale, widgets de l'overlay et wiki.
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        widget: resolve(import.meta.dirname, "widget.html"),
        wiki: resolve(import.meta.dirname, "wiki.html"),
      },
    },
  },
}));

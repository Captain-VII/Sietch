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
      "/__wiki": {
        target: "https://awakening.wiki",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/__wiki/, ""),
      },
    },
  },
  // Trois fenêtres : principale, overlay et wiki.
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        overlay: resolve(import.meta.dirname, "overlay.html"),
        wiki: resolve(import.meta.dirname, "wiki.html"),
      },
    },
  },
}));

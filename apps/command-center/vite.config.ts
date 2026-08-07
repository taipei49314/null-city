import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER_ORIGIN = process.env["NULLCITY_SERVER_ORIGIN"] ?? "http://127.0.0.1:8787";
const WS_ORIGIN = SERVER_ORIGIN.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: SERVER_ORIGIN,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/ws": {
        target: WS_ORIGIN,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: SERVER_ORIGIN,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/ws": {
        target: WS_ORIGIN,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: process.env.MISSION_RUNNER_BACKEND ?? "http://127.0.0.1:3000",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
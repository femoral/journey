import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  build: {
    rollupOptions: {
      // @usejourney/core's single-file bundle imports node builtins (fs, path,
      // crypto) that vite stubs out for the browser. The GUI only uses pure
      // helpers (formatOpaqueBody, …), so the node code is tree-shaken — shim
      // the stub's missing named exports instead of failing the build.
      shimMissingExports: true,
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: process.env.JOURNEY_API_URL ?? "http://127.0.0.1:5181",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});

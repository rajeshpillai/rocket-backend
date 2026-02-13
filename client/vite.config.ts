import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import pkg from "./package.json";

export default defineConfig({
  plugins: [solidPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 3001,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
});

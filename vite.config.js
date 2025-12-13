import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // https: true,
    host: true,
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});

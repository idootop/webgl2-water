import { defineConfig } from "vite";
// import fs from "fs";
// import path from "path";

export default defineConfig({
  base: "/webgl2-water/",
  server: {
    host: true,
    // https: {
    //   // mkcert example.local "192.168.31.125" localhost 127.0.0.1 ::1
    //   cert: fs.readFileSync(path.resolve(__dirname, "temp/cert.pem")),
    //   key: fs.readFileSync(path.resolve(__dirname, "temp/key.pem")),
    // },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});

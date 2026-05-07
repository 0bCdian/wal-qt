import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: "./",
  build: {
    outDir: "dist",
  },
  esbuild:
    mode === "production"
      ? { drop: ["console", "debugger"] as ("console" | "debugger")[] }
      : undefined,
}));

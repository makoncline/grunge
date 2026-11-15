import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: { entry: "src/engine.ts", formats: ["es"], fileName: () => "engine.js" },
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
  },
});

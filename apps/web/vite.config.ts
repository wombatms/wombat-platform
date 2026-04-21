import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiBase = env.VITE_API_BASE_URL || "http://localhost:8000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": { target: apiBase, changeOrigin: true },
        "/openapi.json": { target: apiBase, changeOrigin: true },
      },
    },
    build: {
      sourcemap: true,
      target: "es2022",
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            query: ["@tanstack/react-query"],
            markdown: ["react-markdown", "remark-gfm", "rehype-sanitize"],
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/tests/setup.ts"],
      css: true,
    },
    // openapi-fetch constructs absolute URLs from VITE_API_BASE_URL + path.
    // In Node.js (where MSW's interceptor runs), relative URLs like /api/... are
    // invalid. Hard-wire the base URL for tests so all requests are absolute and
    // MSW can intercept them at http://localhost:8000/*.
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify("http://localhost:8000"),
    },
  };
});

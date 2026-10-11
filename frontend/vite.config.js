import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// One .env at the repo root serves both backend and frontend.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  const backend = `http://127.0.0.1:${env.BACKEND_PORT || "8040"}`;
  return {
    envDir: "..",
    plugins: [react()],
    server: {
      port: Number(env.FRONTEND_PORT || 3040),
      strictPort: true,
      // Same-origin API calls: the browser never needs the backend's port.
      proxy: {
        "/api": {
          target: backend,
          // When the browser cancels a request (e.g. the mic interrupts a
          // streaming answer), close the backend request too, so the backend
          // stops Claude. The proxy keeps it open otherwise.
          configure: (proxy) =>
            proxy.on("proxyReq", (proxyReq, req, res) =>
              res.on("close", () => !res.writableEnded && proxyReq.destroy()),
            ),
        },
        "/health": backend,
      },
    },
    test: { environment: "jsdom" },
  };
});

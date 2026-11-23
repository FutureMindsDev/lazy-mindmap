import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createApiMiddleware } from "./server/api.mjs";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "mindforge-api-middleware",
      configureServer(server) {
        server.middlewares.use(createApiMiddleware());
      },
    },
  ],
  build: {
    target: "esnext",
  },
});

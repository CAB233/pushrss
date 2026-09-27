import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { clientDirectives } from "./plugins/client-directives.ts";
export default defineConfig({
  plugins: [clientDirectives(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
});

import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";

export default defineConfig({
  publicDir: "assets",
  plugins: [react(), cloudflare()],
});

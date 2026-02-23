import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname),
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    proxy: {
      "/trpc": {
        target: "http://localhost:3100",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

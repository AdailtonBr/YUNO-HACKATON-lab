import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const proxy = (target) => ({ target, changeOrigin: true, rewrite: (p) => p.replace(/^\/[^/]+/, "") });

// Todas as portas deslocam juntas, para 3 maquinas rodarem em paralelo.
const OFFSET = Number(process.env.PORT_OFFSET ?? 0);
const at = (n) => `http://127.0.0.1:${n + OFFSET}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173 + OFFSET,
    proxy: {
      // A UI fala com a Autoridade e com as comercializadoras por caminhos
      // distintos, de proposito: fica visivel na aba de rede quem foi
      // consultado -- e a verificacao acontece do lado de LA, nao aqui.
      "/api": proxy(at(3001)),
      "/volt": proxy(at(4001)),
      "/cerrado": proxy(at(4002)),
      "/helios": proxy(at(4003)),
    },
  },
});

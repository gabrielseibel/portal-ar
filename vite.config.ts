import { defineConfig } from 'vite';

// GitHub Pages publica o site em https://<usuario>.github.io/<repositorio>/.
// Usamos base relativa ('./') para que o build funcione em qualquer subdiretório
// (inclusive em forks com outro nome). Pode ser sobrescrito com BASE_PATH=/algo/.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') && !id.includes('/loaders/')) return 'three';
          if (id.includes('vendor/aruco')) return 'aruco';
        },
      },
    },
  },
  server: { host: true },
});

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700,
    target: 'es2022',
    cssCodeSplit: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // three + post stack in their own long-cacheable chunk, only fetched when WebGL boots.
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules/postprocessing')) return 'three';
        },
      },
    },
  },
});

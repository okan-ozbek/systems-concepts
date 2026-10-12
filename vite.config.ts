import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Changes to lessons/UI don't invalidate the large renderer download.
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
        }
      }
    }
  },
  server: {
    proxy: { '/api/cpp': 'http://127.0.0.1:8080' }
  },
  preview: {
    proxy: { '/api/cpp': 'http://127.0.0.1:8080' }
  }
});

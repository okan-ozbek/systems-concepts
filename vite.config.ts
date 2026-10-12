import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    proxy: { '/api/cpp': 'http://127.0.0.1:8080' }
  },
  preview: {
    proxy: { '/api/cpp': 'http://127.0.0.1:8080' }
  }
});

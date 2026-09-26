import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Workers are ES modules (the lyrics worker lazy-loads the Whisper model).
  worker: { format: 'es' },
  build: {
    outDir: process.env.APPDEPLOY_VITE_OUT_DIR || 'dist',
    sourcemap:
      process.env.APPDEPLOY_VITE_SOURCEMAP === 'hidden' ? 'hidden' : false,
    rollupOptions: {
      maxParallelFileOps: 128,
    },
  },
});

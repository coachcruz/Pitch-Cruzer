import { defineConfig } from 'vite';

// Same isolation header as netlify.toml (see there for why).
const isolation = { 'Document-Isolation-Policy': 'isolate-and-credentialless' };

export default defineConfig({
  base: './',
  // Workers are ES modules (the lyrics worker lazy-loads the Whisper model).
  worker: { format: 'es' },
  server: { headers: isolation },
  preview: { headers: isolation },
  build: {
    outDir: process.env.APPDEPLOY_VITE_OUT_DIR || 'dist',
    sourcemap:
      process.env.APPDEPLOY_VITE_SOURCEMAP === 'hidden' ? 'hidden' : false,
    rollupOptions: {
      maxParallelFileOps: 128,
    },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this project under /skillproof/.
  // BASE_PATH is set by the Pages workflow; local development stays at /.
  base: process.env.BASE_PATH || '/',
  server: { port: 5173 },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.js'] },
});

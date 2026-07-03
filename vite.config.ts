import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative asset paths so the build works at any URL (GitHub Pages subpath etc.)
  base: './',
  plugins: [react()],
});

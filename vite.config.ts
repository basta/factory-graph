import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` is set from BASE_PATH so a GitHub Pages project site can be served
// from /<repo>/ without changing any code.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  build: { target: 'es2022' },
});

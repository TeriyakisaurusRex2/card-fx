import { defineConfig } from 'vite';

// GitHub Pages serves this repo at /card-fx/, so built files need that prefix.
// The dev server stays at the root.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/card-fx/' : '/',
}));

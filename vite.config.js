import fs from 'node:fs';
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';

const manifest = JSON.parse(
  fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')
);

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

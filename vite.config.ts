import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const manifest = JSON.parse(
  fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')
);

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest }), cleanEntryFileNames()],
  resolve: {
    alias: {
      '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

/**
 * Removes source extensions from generated entry chunk names after CRXJS has
 * contributed its own Rollup configuration.
 */
function cleanEntryFileNames(): Plugin {
  return {
    name: 'luna-toc:clean-entry-file-names',
    enforce: 'post',
    closeBundle() {
      const assetsDirectory = new URL('./dist/assets/', import.meta.url);
      if (!fs.existsSync(assetsDirectory)) return;

      const renamedFiles = new Map<string, string>();

      for (const fileName of fs.readdirSync(assetsDirectory)) {
        const cleanFileName = fileName.replace(
          /\.(?:html|[cm]?[jt]s)(?=-[^/]+\.js$)/,
          ''
        );

        if (cleanFileName === fileName) continue;

        fs.renameSync(
          new URL(fileName, assetsDirectory),
          new URL(cleanFileName, assetsDirectory)
        );
        renamedFiles.set(`assets/${fileName}`, `assets/${cleanFileName}`);
      }

      if (renamedFiles.size === 0) return;

      for (const filePath of getTextOutputFiles(
        new URL('./dist/', import.meta.url)
      )) {
        const source = fs.readFileSync(filePath, 'utf8');
        const updatedSource = replaceFileReferences(source, renamedFiles);

        if (updatedSource !== source) {
          fs.writeFileSync(filePath, updatedSource);
        }
      }
    },
  };
}

function getTextOutputFiles(directory: URL): URL[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(entry.name, directory);

    if (entry.isDirectory()) {
      return getTextOutputFiles(new URL(`${entry.name}/`, directory));
    }

    return /\.(?:css|html|js|json)$/.test(entry.name) ? [entryUrl] : [];
  });
}

function replaceFileReferences(
  source: string,
  renamedFiles: ReadonlyMap<string, string>
): string {
  let result = source;

  renamedFiles.forEach((nextFileName, previousFileName) => {
    result = result.replaceAll(previousFileName, nextFileName);
  });

  return result;
}

import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const PUBLIC_DIR = resolve(import.meta.dirname, 'public');
const SW_TEMPLATE = resolve(import.meta.dirname, 'src/pwa/sw.js');

/** Lista ricorsiva dei file in /public (manifest, icone...) da mettere in precache. */
function listPublicFiles(dir = PUBLIC_DIR) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? listPublicFiles(full)
      : [relative(PUBLIC_DIR, full).split('\\').join('/')];
  });
}

/**
 * Genera dist/sw.js partendo da src/pwa/sw.js, iniettando:
 *  - la lista dei file da mettere in precache (bundle con hash + file di /public)
 *  - una versione derivata dal contenuto, così ogni deploy invalida la cache vecchia.
 * Zero dipendenze (niente Workbox): il SW resta leggibile e piccolo.
 */
function serviceWorkerPlugin() {
  return {
    name: 'party-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const bundleFiles = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const files = [...new Set([...bundleFiles, ...listPublicFiles()])].sort();
      const hash = createHash('sha256');
      for (const file of bundleFiles) {
        const chunk = bundle[file];
        hash.update(file);
        hash.update(chunk.type === 'chunk' ? chunk.code : chunk.source);
      }
      const version = hash.digest('hex').slice(0, 12);
      const precache = ['./', ...files.map((f) => `./${f}`)];
      const source = readFileSync(SW_TEMPLATE, 'utf8')
        .replace('self.__PRECACHE_MANIFEST', JSON.stringify(precache))
        .replace('__SW_VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Path relativi: funziona sia su https://user.github.io/partygame/ sia su un dominio custom.
  base: './',
  plugins: [serviceWorkerPlugin()],
  build: {
    target: 'es2022',
    // three.js da solo supera i 500kB: è atteso, viene caricato lazy solo dove serve.
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
  },
});

import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function setup() {
  await build({
    entryPoints: [path.join(root, 'src/renderer/operator/index.tsx')],
    bundle: true,
    outfile: path.join(root, 'src/renderer/operator/index.js'),
    platform: 'browser',
    format: 'iife',
    // Resolve `react`/`react-dom` to the vendored UMD globals rather than
    // bundling the real npm packages — `alias`, not `external`: esbuild's
    // `external` compiles these imports down to `require("react")` calls,
    // which throw at runtime in a plain browser `<script>` context (no
    // `require` global). Webpack's `externals: { react: 'React' }` (see
    // forge.config.ts, used for the real renderer build) doesn't have this
    // problem — it maps straight to the global. `alias` gets esbuild the
    // same behavior via the tiny local shim modules below.
    alias: {
      react: path.join(root, 'src/renderer/vendor/react-global-shim.js'),
      'react-dom': path.join(root, 'src/renderer/vendor/react-dom-global-shim.js'),
    },
    logLevel: 'silent',
  });
}

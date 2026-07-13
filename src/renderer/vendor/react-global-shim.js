// Shim used by esbuild's dev/test bundler (see tests/setup/build-operator-renderer.ts)
// to resolve `import ... from 'react'` to the vendored UMD global instead of
// bundling the real npm `react` package.
//
// Why this exists: esbuild's `external` option assumes a CommonJS `require`
// exists at runtime and compiles externalized imports down to `__require(id)`
// calls — that throws ("Dynamic require of \"react\" is not supported") in a
// plain browser `<script>` context with no `require` global. Webpack's
// `externals: { react: 'React' }` (see forge.config.ts) has no such problem —
// it maps directly to the global variable. This file gives esbuild the same
// global-variable behavior via its `alias` option instead of `external`.
module.exports = window.React;

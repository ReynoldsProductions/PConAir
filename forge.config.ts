import type { ForgeConfig } from '@electron-forge/shared-types';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';

const config: ForgeConfig = {
  packagerConfig: { name: 'PConAir', asar: true, extraResource: ['./bundled-packages', './cloudflared', './graphics', './src/renderer/vendor'] },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] },
    { name: '@electron-forge/maker-dmg', config: {}, platforms: ['darwin'] },
  ],
  plugins: [
    new WebpackPlugin({
      // Renderer dev server defaults to port 3000 (electron-forge's WebpackPlugin
      // default). TODO: make this a user-selectable setting (e.g. env var or a
      // preferences field) — port 3000 collides with other local dev services
      // (e.g. FaireFulfillmentGames' obs/server.js) often enough that a hardcoded
      // default isn't great long-term. Override via a top-level `port:` key here
      // if you need to change it locally in the meantime.
      mainConfig: {
        entry: './src/main/index.ts',
        module: {
          rules: [{ test: /\.tsx?$/, use: { loader: 'ts-loader', options: { configFile: 'tsconfig.main.json' } }, exclude: /node_modules/ }],
        },
        resolve: { extensions: ['.ts', '.js'] },
        output: { filename: 'index.js' },
        externals: { bufferutil: 'commonjs bufferutil', 'utf-8-validate': 'commonjs utf-8-validate' },
      },
      renderer: {
        // Without ts-loader, webpack parses .ts as plain JS and fails on `import type`, etc.
        config: {
          module: {
            rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }],
          },
          resolve: { extensions: ['.ts', '.js', '.tsx', '.jsx'] },
          watchOptions: { ignored: /node_modules/ },
          externals: { react: 'React', 'react-dom': 'ReactDOM' },
        },
        entryPoints: [
          {
            name: 'operator',
            html: './src/renderer/operator/index.html',
            js: './src/renderer/operator/index.tsx',
            preload: { js: './src/renderer/preload.ts' },
          },
          {
            // Admin SPA is served by Express over HTTP; this entry exists only so
            // webpack copies index.html to .webpack/renderer/admin/ where admin.ts expects it.
            name: 'admin',
            html: './src/renderer/admin/index.html',
            js: './src/renderer/admin/index.ts',
          },
          {
            // Web remote SPA — served by Express at /remote (webpack copies it next to admin).
            name: 'remote',
            html: './src/renderer/remote/index.html',
            js: './src/renderer/remote/index.ts',
          },
          {
            // Settings window loads directly from the webpack entry (not HTTP) so it
            // still opens when the server failed to start (e.g. port conflict).
            name: 'settings',
            html: './src/renderer/settings/index.html',
            js: './src/renderer/settings/index.ts',
            preload: { js: './src/renderer/settings-preload.ts' },
          },
          {
            // Director window loads directly from the webpack entry (not HTTP), same
            // as settings — it talks to remote offices over HTTP/WS from the main
            // process, not to this instance's own Express server.
            name: 'director',
            html: './src/renderer/director/index.html',
            js: './src/renderer/director/index.ts',
            preload: { js: './src/renderer/director-preload.ts' },
          },
        ],
      },
    }),
  ],
};

export default config;

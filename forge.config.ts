import type { ForgeConfig } from '@electron-forge/shared-types';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';

const config: ForgeConfig = {
  packagerConfig: { asar: true, extraResource: ['graphics'] },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'] },
    { name: '@electron-forge/maker-dmg', config: {}, platforms: ['darwin'] },
  ],
  plugins: [
    new WebpackPlugin({
      mainConfig: {
        entry: './src/main/index.ts',
        module: {
          rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }],
        },
        resolve: { extensions: ['.ts', '.js'] },
        output: { filename: 'index.js' },
      },
      renderer: {
        // Without ts-loader, webpack parses .ts as plain JS and fails on `import type`, etc.
        config: {
          module: {
            rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }],
          },
          resolve: { extensions: ['.ts', '.js', '.tsx', '.jsx'] },
          watchOptions: { ignored: /node_modules/ },
        },
        entryPoints: [
          {
            name: 'operator',
            html: './src/renderer/operator/index.html',
            js: './src/renderer/operator/index.ts',
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
        ],
      },
    }),
  ],
};

export default config;

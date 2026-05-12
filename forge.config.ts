import type { ForgeConfig } from '@electron-forge/shared-types';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';

const config: ForgeConfig = {
  packagerConfig: { asar: true },
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
        },
        entryPoints: [
          {
            name: 'operator',
            html: './src/renderer/operator/index.html',
            js: './src/renderer/operator/index.ts',
            preload: { js: './src/renderer/preload.ts' },
          },
        ],
      },
    }),
  ],
};

export default config;

import type { PresetsStore } from '../presets';
import type { PackageHub } from './state-hub';

/**
 * URL presets for package renders that ask for one.
 *
 * A render declares `"preset": { … }` in its package manifest when it is meant
 * to be launchable by name — a full scene like the Faire Wire all-in-one, as
 * opposed to a layer that is only ever added as a browser source. The preset
 * then shows up wherever presets do: admin → URL Presets and remote → URLs.
 *
 * Runs on every server start rather than only on a fresh profile, so a package
 * shipped in an app update reaches installs that already have presets. The
 * trade-off is deliberate: a declared preset that the user deletes comes back on
 * the next launch. Their edits to it do survive — only the URL is refreshed, and
 * only when the server port has moved under it.
 */
export function ensurePackageRenderPresets(deps: {
  hub: PackageHub;
  presets: PresetsStore;
  port: number;
}): void {
  const { hub, presets, port } = deps;

  for (const pkg of hub.list()) {
    for (const render of pkg.manifest.renders) {
      if (!render.preset) continue;

      // The path identifies the preset across port changes; the host cannot,
      // since a preset may have been created against a different one.
      const renderPath = `/packages/${pkg.manifest.id}/render/${render.id}`;
      const url = `http://localhost:${port}${renderPath}`;
      const existing = presets.list().find((p) => pathOf(p.url) === renderPath);

      if (!existing) {
        presets.create({
          name: render.preset.name ?? `${pkg.manifest.name} — ${render.label ?? render.id}`,
          url,
          sessionMode: 'persistent',
          displayTarget: null,
          description: render.preset.description ?? null,
        });
        continue;
      }
      if (existing.url !== url) presets.update(existing.id, { url });
    }
  }
}

/** Path of a preset URL, or null when it is not a URL we can read. */
function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

import fs from 'fs';
import path from 'path';
import type { PresetsStore } from './presets';
import type { L3CueStore, L3Cue } from './l3/cue-store';

interface RuntimeFileV2 {
  version: 2;
  l3Cues: L3Cue[];
}

export function wireRuntimePersistence(
  filePath: string,
  stores: { presets: PresetsStore; cues: L3CueStore }
): { markDirty: () => void } {
  const isLegacyCombinedFile = path.basename(filePath) === 'runtime-state.json';

  function load(): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      if (raw.version === 2) {
        if (Array.isArray(raw.l3Cues)) stores.cues.replaceAll(raw.l3Cues as L3Cue[]);
        return;
      }
      if (raw.version === 1) {
        if (isLegacyCombinedFile && Array.isArray(raw.urlPresets)) {
          stores.presets.replaceAll(raw.urlPresets as never[]);
        }
        if (Array.isArray(raw.l3Cues)) stores.cues.replaceAll(raw.l3Cues as L3Cue[]);
      }
    } catch {
      // ignore corrupt file
    }
  }

  let timer: NodeJS.Timeout | null = null;
  function flush(): void {
    const payload: RuntimeFileV2 = {
      version: 2,
      l3Cues: stores.cues.list(),
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  function markDirty(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, 500);
  }

  load();

  return { markDirty };
}

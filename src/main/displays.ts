import { screen } from 'electron';
import type { Display } from '../shared/types';

/** Map Electron displays to AppState `displays` entries. */
export function snapshotDisplays(): Display[] {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d) => ({
    id: String(d.id),
    name: d.label && d.label.length > 0 ? d.label : `Display ${d.id}`,
    isPrimary: d.id === primary.id,
  }));
}

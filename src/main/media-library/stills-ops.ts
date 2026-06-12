import type { StateStore } from '../state';
import type { MediaLibraryStore, MediaLibraryItemRecord } from './item-store';
import type { MediaLibraryState } from '../../shared/types';

type Err = { ok: false; status: number; error: { code: string; message: string } };
type Ok<T> = { ok: true; body: T };

/** Find a media item by id, falling back to displayName then filename match. */
export function findMediaItem(media: MediaLibraryStore, idOrName: string): MediaLibraryItemRecord | null {
  return (
    media.findById(idOrName) ??
    media.list().find((it) => it.displayName === idOrName) ??
    media.list().find((it) => it.filename === idOrName) ??
    null
  );
}

export function stillsTakeOp(
  store: StateStore,
  media: MediaLibraryStore,
  idOrName: string
): Err | Ok<{ currentMode: string; mediaLibrary: MediaLibraryState | null }> {
  const item = findMediaItem(media, idOrName);
  if (!item) {
    return { ok: false, status: 404, error: { code: 'ITEM_NOT_FOUND', message: `Media item '${idOrName}' not found` } };
  }
  store.setState({
    currentMode: 'media-library',
    l3: null,
    mediaLibrary: {
      activeItemId: item.id,
      activeItemName: item.displayName,
      slideshow: store.getState().mediaLibrary?.slideshow ?? null,
    },
  });
  const s = store.getState();
  return { ok: true, body: { currentMode: s.currentMode, mediaLibrary: s.mediaLibrary } };
}

export function stillsClearOp(store: StateStore): Ok<{ currentMode: string; mediaLibrary: MediaLibraryState | null }> {
  store.setState({ currentMode: 'idle', mediaLibrary: null });
  return { ok: true, body: { currentMode: 'idle', mediaLibrary: null } };
}

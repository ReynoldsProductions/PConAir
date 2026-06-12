import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import type { L3CueStore } from '../l3/cue-store';
import type { L3PlaylistStore } from '../l3/playlist-store';
import type { L3ThemeStore } from '../l3/theme-store';
import type { L3State } from '../../shared/types';
import { requireOperator, requireAdmin } from './middleware';
import { l3ClearOp, l3StackingOp, l3TakeOp } from '../l3/take-ops';
import { playlistActivateOp, playlistStepOp } from '../l3/playlist-ops';
import { sniffImageMime } from '../media-library/image-meta';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const CSV_SAMPLE = `name,title,theme,subtitle
John Doe,CEO,default,Head of Company
Jane Smith,CTO,default,
`;

function emptyL3(): L3State {
  return {
    activeCueId: null,
    activeCueName: null,
    activeTitle: null,
    activeTheme: null,
    isStacking: false,
    currentPlaylistId: null,
    playlistPosition: null,
    playlistLength: null,
  };
}

function ensureL3(state: ReturnType<StateStore['getState']>): L3State {
  return state.l3 ?? emptyL3();
}

// ── CSV parsing helpers ──────────────────────────────────────────────────────

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (c === ',' && !inQuote) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  return lines.slice(1).map((line) => {
    const vals = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (vals[i] ?? '').trim();
    });
    return row;
  });
}

// ── Router factory ───────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

export function createL3Router(
  store: StateStore,
  auth: AuthManager,
  cues: L3CueStore,
  playlists: L3PlaylistStore,
  themes: L3ThemeStore,
  l3FilesRoot: string,
  renderManualCue?: (cue: import('../l3/cue-store').L3Cue) => Promise<Buffer>,
): Router {
  const router = Router();
  const opGuard = requireOperator(auth);
  const adminGuard = requireAdmin(auth);

  // ── Theme routes (static paths first) ──────────────────────────────────────

  router.get('/themes', opGuard, (_req: Request, res: Response) => {
    res.json({ themes: themes.list() });
  });

  router.get('/themes/sample.css', opGuard, (_req: Request, res: Response) => {
    const sample = themes.findByName('default');
    res.setHeader('Content-Type', 'text/css');
    res.send(sample?.cssContent ?? '');
  });

  // Unauthenticated: consumed by /render pages in OBS (no cookies on LAN).
  router.get('/themes/:name/css', (req: Request, res: Response) => {
    const theme = themes.findByName(req.params.name);
    if (!theme) {
      res.status(404).type('text/plain').send('Theme not found');
      return;
    }
    res.setHeader('Content-Type', 'text/css');
    res.send(theme.cssContent);
  });

  router.post(
    '/themes',
    adminGuard,
    upload.fields([{ name: 'cssFile', maxCount: 1 }]),
    (req: Request, res: Response) => {
      const { name, displayName, description } = req.body as {
        name?: string;
        displayName?: string;
        description?: string;
      };

      // Validate name
      if (!name || !/^[a-z0-9-]+$/.test(name)) {
        res.status(400).json({
          error: { code: 'INVALID_NAME', message: 'name must match /^[a-z0-9-]+$/' },
        });
        return;
      }

      // Validate displayName
      if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
        res.status(400).json({
          error: { code: 'INVALID_MODE', message: 'displayName is required' },
        });
        return;
      }

      // Validate uniqueness
      if (themes.findByName(name)) {
        res.status(409).json({
          error: { code: 'DUPLICATE_NAME', message: `Theme '${name}' already exists` },
        });
        return;
      }

      // Validate CSS file
      const grouped = req.files as Record<string, Express.Multer.File[]> | undefined;
      const cssFiles = grouped?.['cssFile'] ?? [];
      if (cssFiles.length === 0) {
        res.status(400).json({
          error: { code: 'MISSING_FILE', message: 'cssFile is required' },
        });
        return;
      }
      const cssFile = cssFiles[0];
      if (cssFile.size > 1024 * 1024) {
        res.status(400).json({
          error: { code: 'FILE_TOO_LARGE', message: 'CSS file must be < 1 MB' },
        });
        return;
      }

      // Validate UTF-8
      let cssContent: string;
      try {
        cssContent = cssFile.buffer.toString('utf8');
      } catch {
        res.status(400).json({
          error: { code: 'INVALID_ENCODING', message: 'CSS file must be valid UTF-8' },
        });
        return;
      }

      const theme = themes.create({
        name,
        displayName: displayName.trim(),
        description: description?.trim(),
        cssContent,
      });

      res.status(201).json(theme);
    }
  );

  router.delete('/themes/:name', adminGuard, (req: Request, res: Response) => {
    const { name } = req.params;
    const existing = themes.findByName(name);
    if (!existing) {
      res.status(404).json({
        error: { code: 'THEME_NOT_FOUND', message: `Theme '${name}' not found` },
      });
      return;
    }
    if (existing.isBuiltIn) {
      res.status(400).json({
        error: { code: 'BUILT_IN_THEME', message: `Cannot delete built-in theme '${name}'` },
      });
      return;
    }
    themes.remove(name);
    res.status(204).end();
  });

  // ── CSV sample and import (static paths before :cueId) ─────────────────────

  router.get('/cues/csv-sample', opGuard, (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/csv');
    res.send(CSV_SAMPLE);
  });

  router.post(
    '/cues/import',
    adminGuard,
    upload.single('csvFile'),
    (req: Request, res: Response) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({
          error: { code: 'MISSING_FILE', message: 'csvFile is required' },
        });
        return;
      }

      let text: string;
      try {
        text = file.buffer.toString('utf8');
      } catch {
        res.status(400).json({
          error: { code: 'INVALID_ENCODING', message: 'CSV file must be valid UTF-8' },
        });
        return;
      }

      const rows = parseCsv(text);
      let imported = 0;
      let skipped = 0;
      const warnings: string[] = [];
      const allThemes = themes.list();
      const fallbackTheme = allThemes[0]?.name ?? 'default';

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // 1-indexed, +1 for header
        const name = row['name']?.trim();
        const title = row['title']?.trim();
        const themeName = row['theme']?.trim();
        const subtitle = row['subtitle']?.trim() || null;

        if (!name || !title || !themeName) {
          skipped++;
          warnings.push(`Row ${rowNum}: skipped — missing required field(s) (name, title, theme)`);
          continue;
        }

        let resolvedTheme = themeName;
        if (!themes.findByName(themeName)) {
          warnings.push(`Row ${rowNum}: theme '${themeName}' not found, defaulting to '${fallbackTheme}'`);
          resolvedTheme = fallbackTheme;
        }

        cues.create({
          name,
          title,
          subtitle,
          theme: resolvedTheme,
          sourceType: 'csv',
        });
        imported++;
      }

      res.json({ imported, skipped, warnings });
    }
  );

  // ── Image upload to Still Store ──────────────────────────────────────────────

  router.post(
    '/cues/upload-image',
    adminGuard,
    upload.array('imageFiles[]', 25),
    (req: Request, res: Response) => {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({
          error: { code: 'MISSING_FILE', message: 'imageFiles[] is required' },
        });
        return;
      }

      const uploadsDir = path.join(l3FilesRoot, 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });

      const allThemes = themes.list();
      const fallbackTheme = allThemes[0]?.name ?? 'default';

      let imported = 0;
      let failed = 0;
      const items: Array<{
        id: string;
        name: string;
        theme: string;
        originalImagePath: string;
        originalImageFormat: string;
      }> = [];
      const failures: string[] = [];

      for (const file of files) {
        const mime = sniffImageMime(file.buffer);
        if (!mime) {
          failed++;
          failures.push(`${file.originalname}: unsupported image format`);
          continue;
        }
        const ext = MIME_TO_EXT[mime];
        if (!ext) {
          failed++;
          failures.push(`${file.originalname}: unsupported MIME type ${mime}`);
          continue;
        }

        const originalNameWithoutExt = path.basename(
          file.originalname,
          path.extname(file.originalname)
        );

        // We need a cue ID first — create cue with a placeholder then update
        // Actually create cue first to get the ID
        const cue = cues.create({
          name: originalNameWithoutExt,
          title: '',
          subtitle: null,
          theme: fallbackTheme,
          sourceType: 'image',
          originalImagePath: null, // will be set below
          originalImageFormat: ext,
        });

        const relativePath = `uploads/${cue.id}.${ext}`;
        const absPath = path.join(l3FilesRoot, relativePath);

        try {
          fs.writeFileSync(absPath, file.buffer);
        } catch (err) {
          // Remove the cue if we can't write the file
          cues.remove(cue.id);
          failed++;
          failures.push(`${file.originalname}: failed to save file`);
          continue;
        }

        // Update the cue with the correct path
        cues.update(cue.id, { });
        // We need to patch originalImagePath — but update only allows name/title/subtitle/theme
        // We'll use replaceAll-like approach: read the cue back and re-create it with the right path
        // Actually, looking at the UpdateL3CueInput type, it only has name/title/subtitle/theme
        // We need to handle this differently — directly manipulate via replaceAll
        const allCues = cues.list().map((c) =>
          c.id === cue.id ? { ...c, originalImagePath: relativePath } : c
        );
        cues.replaceAll(allCues);

        imported++;
        items.push({
          id: cue.id,
          name: cue.name,
          theme: cue.theme,
          originalImagePath: relativePath,
          originalImageFormat: ext,
        });
      }

      res.json({ imported, failed, items, failures });
    }
  );

  // ── Cue export (parameterised — must come after static paths) ───────────────

  router.get('/cues/:cueId/export', opGuard, async (req: Request, res: Response) => {
    const { cueId } = req.params;
    const cue = cues.findById(cueId);
    if (!cue) {
      res.status(404).json({
        error: { code: 'CUE_NOT_FOUND', message: `Cue '${cueId}' not found` },
      });
      return;
    }

    if (cue.sourceType === 'image' && cue.originalImagePath) {
      const absPath = path.join(l3FilesRoot, cue.originalImagePath);
      const ext = cue.originalImageFormat ?? 'png';
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
      };
      const mime = mimeMap[ext] ?? 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      const safeName = cue.name.replace(/[^\w\s-]/g, '_');
      const encodedName = encodeURIComponent(cue.name);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeName}.${ext}"; filename*=UTF-8''${encodedName}.${ext}`
      );
      res.sendFile(absPath, (err) => {
        if (err && !res.headersSent) {
          res.status(500).json({ error: { code: 'READ_ERROR', message: 'Failed to read file' } });
        }
      });
      return;
    }

    if (cue.sourceType === 'manual' && renderManualCue) {
      try {
        const pngBuffer = await renderManualCue(cue);
        res.setHeader('Content-Type', 'image/png');
        const safeName = cue.name.replace(/[^\w\s-]/g, '_');
        const encodedName = encodeURIComponent(cue.name);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${safeName}.png"; filename*=UTF-8''${encodedName}.png`
        );
        res.send(pngBuffer);
      } catch {
        if (!res.headersSent) {
          res.status(500).json({ error: { code: 'RENDER_ERROR', message: 'Failed to render PNG' } });
        }
      }
      return;
    }

    res.status(501).json({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'PNG rendering not yet available in this build',
      },
    });
  });

  // ── Original cue/playlist CRUD routes ──────────────────────────────────────

  router.post('/take', opGuard, (req: Request, res: Response) => {
    const { cueId, name, title, theme } = req.body as {
      cueId?: string;
      name?: string;
      title?: string;
      theme?: string;
    };
    void theme;
    const r = l3TakeOp(store, cues, { cueId, name, title, theme });
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  router.post('/clear', opGuard, (_req: Request, res: Response) => {
    const r = l3ClearOp(store);
    res.json(r.body);
  });

  router.post('/stacking', opGuard, (req: Request, res: Response) => {
    const { enabled } = req.body as { enabled?: unknown };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'enabled must be a boolean' } });
      return;
    }
    const r = l3StackingOp(store, enabled);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  });

  router.get('/cues', opGuard, (_req: Request, res: Response) => {
    res.json({ cues: cues.list() });
  });

  router.post('/cues', adminGuard, (req: Request, res: Response) => {
    const { name, title, subtitle, theme, themeId } = req.body as {
      name?: string;
      title?: string;
      subtitle?: string | null;
      theme?: string;
      themeId?: string;
    };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'name is required' } });
      return;
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'title is required' } });
      return;
    }
    // Accept themeId (preferred) or theme (legacy)
    const themeRaw = themeId ?? theme;
    const th = themeRaw && typeof themeRaw === 'string' && themeRaw.trim() ? themeRaw.trim() : 'default';
    const cue = cues.create({
      name: name.trim().slice(0, 100),
      title: title.trim().slice(0, 100),
      subtitle: subtitle != null ? String(subtitle).slice(0, 100) : null,
      theme: th,
    });
    res.status(201).json(cue);
  });

  router.put('/cues/:cueId', adminGuard, (req: Request, res: Response) => {
    const { cueId } = req.params;
    if (!cues.findById(cueId)) {
      res.status(404).json({ error: { code: 'CUE_NOT_FOUND', message: `Cue '${cueId}' not found` } });
      return;
    }
    const { name, title, subtitle, themeId, theme } = req.body as {
      name?: string;
      title?: string;
      subtitle?: string | null;
      themeId?: string;
      theme?: string;
    };
    const patch: import('../l3/cue-store').UpdateL3CueInput = {};
    if (name !== undefined) patch.name = String(name).trim().slice(0, 100);
    if (title !== undefined) patch.title = String(title).trim().slice(0, 100);
    if (subtitle !== undefined) patch.subtitle = subtitle != null ? String(subtitle).slice(0, 100) : null;
    // Accept themeId (preferred) or theme (legacy)
    const themeRaw = themeId ?? theme;
    if (themeRaw !== undefined) patch.theme = String(themeRaw).trim();
    const updated = cues.update(cueId, patch);
    if (!updated) {
      res.status(404).json({ error: { code: 'CUE_NOT_FOUND', message: `Cue '${cueId}' not found` } });
      return;
    }
    res.json({ cue: updated });
  });

  router.delete('/cues/:cueId', adminGuard, (req: Request, res: Response) => {
    const { cueId } = req.params;
    if (!cues.findById(cueId)) {
      res.status(404).json({ error: { code: 'CUE_NOT_FOUND', message: `Cue '${cueId}' not found` } });
      return;
    }
    cues.remove(cueId);
    const st = store.getState();
    if (st.l3?.activeCueId === cueId) {
      store.setState({
        l3: st.l3
          ? { ...st.l3, activeCueId: null, activeCueName: null, activeTitle: null }
          : emptyL3(),
      });
    }
    res.status(204).end();
  });

  router.get('/playlists', opGuard, (_req: Request, res: Response) => {
    res.json({ playlists: playlists.list() });
  });

  router.post('/playlists', adminGuard, (req: Request, res: Response) => {
    const { name, cueIds } = req.body as { name?: string; cueIds?: unknown };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'name is required' } });
      return;
    }
    if (!Array.isArray(cueIds)) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'cueIds must be an array' } });
      return;
    }
    const ids = cueIds.map((x) => String(x));
    const created = playlists.create({ name: name.trim(), cueIds: ids });
    if (!created.ok) {
      res.status(404).json({
        error: { code: 'CUE_NOT_FOUND', message: `Cue '${created.missingCueId}' not found` },
      });
      return;
    }
    res.status(201).json(created.playlist);
  });

  router.get('/playlists/:id', opGuard, (req: Request, res: Response) => {
    const p = playlists.findById(req.params.id);
    if (!p) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: `Playlist '${req.params.id}' not found` } });
      return;
    }
    res.json(p);
  });

  router.put('/playlists/:id', adminGuard, (req: Request, res: Response) => {
    const { name, cueIds } = req.body as { name?: string; cueIds?: unknown };
    const patch: { name?: string; cueIds?: string[] } = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'name must be a non-empty string' } });
        return;
      }
      patch.name = name.trim();
    }
    if (cueIds !== undefined) {
      if (!Array.isArray(cueIds)) {
        res.status(400).json({ error: { code: 'INVALID_MODE', message: 'cueIds must be an array' } });
        return;
      }
      patch.cueIds = cueIds.map((x) => String(x));
    }
    const updated = playlists.update(req.params.id, patch);
    if (!updated.ok) {
      if (updated.reason === 'not_found') {
        res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: `Playlist '${req.params.id}' not found` } });
        return;
      }
      res.status(404).json({
        error: { code: 'CUE_NOT_FOUND', message: `Cue '${updated.missingCueId}' not found` },
      });
      return;
    }
    res.json(updated.playlist);
  });

  router.delete('/playlists/:id', adminGuard, (req: Request, res: Response) => {
    const id = req.params.id;
    if (!playlists.findById(id)) {
      res.status(404).json({ error: { code: 'PRESET_NOT_FOUND', message: `Playlist '${id}' not found` } });
      return;
    }
    playlists.remove(id);
    const st = store.getState();
    if (st.l3?.currentPlaylistId === id) {
      store.setState({
        l3: st.l3
          ? { ...st.l3, currentPlaylistId: null, playlistPosition: null, playlistLength: null }
          : emptyL3(),
      });
    }
    res.status(204).end();
  });

  router.post('/playlists/:id/activate', adminGuard, (req: Request, res: Response) => {
    const r = playlistActivateOp(store, playlists, req.params.id);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json({ l3: { currentPlaylistId: store.getState().l3?.currentPlaylistId ?? null } });
  });

  // Step through the active playlist (wraps around). Takes the cue at the new position.
  function playlistStep(res: Response, direction: 1 | -1): void {
    const r = playlistStepOp(store, playlists, cues, direction);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    res.json(r.body);
  }

  router.post('/playlists/next', opGuard, (_req: Request, res: Response) => playlistStep(res, 1));
  router.post('/playlists/prev', opGuard, (_req: Request, res: Response) => playlistStep(res, -1));

  return router;
}

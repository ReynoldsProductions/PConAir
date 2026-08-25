import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import type { AuthManager } from '../auth';
import type { L3CueStore } from '../l3/cue-store';
import type { L3ThemeStore } from '../l3/theme-store';
import type { L3LogoStore } from '../l3/logo-store';
import { requireOperator, requireAdmin } from './middleware';
import { sniffImageMime } from '../media-library/image-meta';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

const CSV_SAMPLE = `name,title,theme,subtitle
John Doe,CEO,default,Head of Company
Jane Smith,CTO,default,
`;



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
  auth: AuthManager,
  cues: L3CueStore,
  themes: L3ThemeStore,
  logos: L3LogoStore,
  l3FilesRoot: string,
  renderManualCue?: (cue: import('../l3/cue-store').L3Cue) => Promise<Buffer>,
  renderAdHocCard?: (input: {
    name: string;
    title?: string | null;
    subtitle?: string | null;
    theme?: string | null;
    logoDataUrl?: string | null;
  }) => Promise<Buffer>,
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
      const mime = EXT_TO_MIME[ext] ?? 'application/octet-stream';
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

  // Ad-hoc export — whatever is currently typed on the live Lower Thirds tab,
  // not necessarily saved as a cue yet.
  router.post('/export', opGuard, async (req: Request, res: Response) => {
    if (!renderAdHocCard) {
      res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'PNG rendering not available in this build' } });
      return;
    }
    const { name, title, subtitle, theme, logoAssetId } = req.body as {
      name?: string;
      title?: string;
      subtitle?: string;
      theme?: string;
      logoAssetId?: string;
    };
    if (!name || !name.trim()) {
      res.status(400).json({ error: { code: 'INVALID_MODE', message: 'name is required' } });
      return;
    }

    let logoDataUrl: string | null = null;
    if (logoAssetId) {
      const logo = logos.findById(logoAssetId);
      if (logo) {
        try {
          const buf = fs.readFileSync(path.join(l3FilesRoot, logo.relativePath));
          logoDataUrl = `data:${EXT_TO_MIME[logo.format] ?? 'application/octet-stream'};base64,${buf.toString('base64')}`;
        } catch {
          // Missing/unreadable logo file — export without it rather than failing the whole request.
        }
      }
    }

    try {
      const pngBuffer = await renderAdHocCard({ name, title, subtitle, theme, logoDataUrl });
      res.setHeader('Content-Type', 'image/png');
      const safeName = name.replace(/[^\w\s-]/g, '_');
      const encodedName = encodeURIComponent(name);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.png"; filename*=UTF-8''${encodedName}.png`);
      res.send(pngBuffer);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'RENDER_ERROR', message: 'Failed to render PNG' } });
      }
    }
  });

  // ── Logo asset library ──────────────────────────────────────────────────────

  router.get('/logos', opGuard, (_req: Request, res: Response) => {
    res.json({ logos: logos.list() });
  });

  router.post(
    '/logos',
    adminGuard,
    upload.single('logoFile'),
    (req: Request, res: Response) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: { code: 'MISSING_FILE', message: 'logoFile is required' } });
        return;
      }
      const mime = sniffImageMime(file.buffer);
      const ext = mime ? MIME_TO_EXT[mime] : undefined;
      if (!mime || !ext) {
        res.status(400).json({ error: { code: 'UNSUPPORTED_TYPE', message: 'Unsupported image format' } });
        return;
      }
      const asset = logos.create({ filename: file.originalname, format: ext, buffer: file.buffer });
      res.status(201).json(asset);
    }
  );

  // Unauthenticated: consumed by /graphics render pages (no cookies on LAN).
  router.get('/logos/:id/file', (req: Request, res: Response) => {
    const logo = logos.findById(req.params.id);
    if (!logo) {
      res.status(404).type('text/plain').send('Logo not found');
      return;
    }
    res.setHeader('Content-Type', EXT_TO_MIME[logo.format] ?? 'application/octet-stream');
    res.sendFile(path.join(l3FilesRoot, logo.relativePath), (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: { code: 'READ_ERROR', message: 'Failed to read file' } });
      }
    });
  });

  router.delete('/logos/:id', adminGuard, (req: Request, res: Response) => {
    if (!logos.findById(req.params.id)) {
      res.status(404).json({ error: { code: 'LOGO_NOT_FOUND', message: `Logo '${req.params.id}' not found` } });
      return;
    }
    logos.remove(req.params.id);
    res.status(204).end();
  });

  // ── Cue CRUD ─────────────────────────────────────────────────────────────────

  router.get('/cues', opGuard, (_req: Request, res: Response) => {
    res.json({ cues: cues.list() });
  });

  router.post('/cues', adminGuard, (req: Request, res: Response) => {
    const { name, title, subtitle, theme, themeId, autoOutMs } = req.body as {
      name?: string;
      title?: string;
      subtitle?: string | null;
      theme?: string;
      themeId?: string;
      autoOutMs?: number | null;
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
    const parsedAutoOutMs = typeof autoOutMs === 'number' && autoOutMs > 0 ? Math.round(autoOutMs) : null;
    const cue = cues.create({
      name: name.trim().slice(0, 100),
      title: title.trim().slice(0, 100),
      subtitle: subtitle != null ? String(subtitle).slice(0, 100) : null,
      theme: th,
      autoOutMs: parsedAutoOutMs,
    });
    res.status(201).json(cue);
  });

  router.put('/cues/:cueId', adminGuard, (req: Request, res: Response) => {
    const { cueId } = req.params;
    if (!cues.findById(cueId)) {
      res.status(404).json({ error: { code: 'CUE_NOT_FOUND', message: `Cue '${cueId}' not found` } });
      return;
    }
    const { name, title, subtitle, themeId, theme, autoOutMs } = req.body as {
      name?: string;
      title?: string;
      subtitle?: string | null;
      themeId?: string;
      theme?: string;
      autoOutMs?: number | null;
    };
    const patch: import('../l3/cue-store').UpdateL3CueInput = {};
    if (name !== undefined) patch.name = String(name).trim().slice(0, 100);
    if (title !== undefined) patch.title = String(title).trim().slice(0, 100);
    if (subtitle !== undefined) patch.subtitle = subtitle != null ? String(subtitle).slice(0, 100) : null;
    // Accept themeId (preferred) or theme (legacy)
    const themeRaw = themeId ?? theme;
    if (themeRaw !== undefined) patch.theme = String(themeRaw).trim();
    if (autoOutMs !== undefined) patch.autoOutMs = typeof autoOutMs === 'number' && autoOutMs > 0 ? Math.round(autoOutMs) : null;
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
    res.status(204).end();
  });

  return router;
}

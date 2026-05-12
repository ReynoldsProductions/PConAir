import fs from 'fs';
import path from 'path';

export interface L3Theme {
  name: string;
  displayName: string;
  description?: string;
  cssContent: string;
  isBuiltIn: boolean;
  createdAt: number;
}

const DEFAULT_THEME_CSS = `/* PC On Air — Default Lower Third Theme */
:root {
  --color-bg: rgba(0, 0, 0, 0.8);
  --color-text: #ffffff;
  --font-family: 'Arial', sans-serif;
}
body {
  margin: 0; padding: 0;
  width: 1920px; height: 1080px;
  background: transparent;
  font-family: var(--font-family);
  overflow: hidden;
}
.lower-third {
  position: fixed; bottom: 0; left: 0;
  width: 100%; height: 200px;
  background: var(--color-bg);
  display: flex; flex-direction: column;
  justify-content: center; padding-left: 40px;
  box-sizing: border-box;
}
.name { font-size: 48px; font-weight: bold; color: var(--color-text); margin: 0; padding: 0; }
.title { font-size: 32px; color: var(--color-text); margin: 5px 0 0 0; padding: 0; }
.subtitle { font-size: 24px; color: rgba(255,255,255,0.8); margin: 5px 0 0 0; padding: 0; }`;

const BUILT_IN_DEFAULT: L3Theme = {
  name: 'default',
  displayName: 'Default',
  description: 'Built-in default lower third theme',
  cssContent: DEFAULT_THEME_CSS,
  isBuiltIn: true,
  createdAt: 0,
};

interface ThemeIndex {
  themes: Array<{ name: string; displayName: string; description?: string; createdAt: number }>;
}

export function createL3ThemeStore(opts: { l3FilesRoot: string; onChange?: () => void }) {
  const { l3FilesRoot, onChange } = opts;
  const themesDir = path.join(l3FilesRoot, 'themes');
  const indexPath = path.join(themesDir, 'index.json');

  // Custom themes map (built-in is not stored here)
  const customThemes = new Map<string, L3Theme>();

  // Load index from disk on construction (tolerate missing file)
  function loadIndex(): void {
    try {
      if (!fs.existsSync(indexPath)) return;
      const raw = fs.readFileSync(indexPath, 'utf8');
      const idx = JSON.parse(raw) as ThemeIndex;
      for (const entry of idx.themes ?? []) {
        const cssPath = path.join(themesDir, `${entry.name}.css`);
        if (!fs.existsSync(cssPath)) continue;
        const cssContent = fs.readFileSync(cssPath, 'utf8');
        customThemes.set(entry.name, {
          name: entry.name,
          displayName: entry.displayName,
          description: entry.description,
          cssContent,
          isBuiltIn: false,
          createdAt: entry.createdAt,
        });
      }
    } catch {
      // Tolerate missing or corrupt index
    }
  }

  function saveIndex(): void {
    fs.mkdirSync(themesDir, { recursive: true });
    const idx: ThemeIndex = {
      themes: Array.from(customThemes.values()).map((t) => ({
        name: t.name,
        displayName: t.displayName,
        description: t.description,
        createdAt: t.createdAt,
      })),
    };
    fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2), 'utf8');
  }

  loadIndex();

  function list(): L3Theme[] {
    return [BUILT_IN_DEFAULT, ...Array.from(customThemes.values())];
  }

  function findByName(name: string): L3Theme | null {
    if (name === 'default') return BUILT_IN_DEFAULT;
    return customThemes.get(name) ?? null;
  }

  function create(input: {
    name: string;
    displayName: string;
    description?: string;
    cssContent: string;
  }): L3Theme {
    const theme: L3Theme = {
      name: input.name,
      displayName: input.displayName,
      description: input.description,
      cssContent: input.cssContent,
      isBuiltIn: false,
      createdAt: Date.now(),
    };
    customThemes.set(theme.name, theme);
    fs.mkdirSync(themesDir, { recursive: true });
    fs.writeFileSync(path.join(themesDir, `${theme.name}.css`), theme.cssContent, 'utf8');
    saveIndex();
    onChange?.();
    return { ...theme };
  }

  function remove(name: string): boolean {
    if (name === 'default') return false;
    const theme = customThemes.get(name);
    if (!theme) return false;
    customThemes.delete(name);
    const cssPath = path.join(themesDir, `${name}.css`);
    try { fs.unlinkSync(cssPath); } catch { /* ignore */ }
    saveIndex();
    onChange?.();
    return true;
  }

  /**
   * Returns the CSS content for the given theme name.
   * Returns '' if themeId is null/undefined/empty, theme not found, or CSS unreadable.
   */
  function getThemeCss(themeId: string | null | undefined): string {
    if (!themeId) return '';
    const theme = findByName(themeId);
    if (!theme) return '';
    return theme.cssContent;
  }

  return { list, findByName, create, remove, getThemeCss };
}

export type L3ThemeStore = ReturnType<typeof createL3ThemeStore>;

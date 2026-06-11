import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DEFAULT_APP_SETTINGS,
  appSettingsPath,
  loadAppSettings,
  saveAppSettings,
  resolvePort,
} from '../src/main/app-settings';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-settings-'));
  file = appSettingsPath(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadAppSettings', () => {
  it('returns defaults when the file is missing', () => {
    expect(loadAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('returns defaults when the file is corrupt JSON', () => {
    fs.writeFileSync(file, '{not json');
    expect(loadAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('falls back to the default port for invalid port values', () => {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, port: 'eighty' }));
    expect(loadAppSettings(file).port).toBe(8080);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, port: 70000 }));
    expect(loadAppSettings(file).port).toBe(8080);
  });

  it('round-trips a saved port', () => {
    saveAppSettings(file, { port: 8123 });
    expect(loadAppSettings(file).port).toBe(8123);
  });
});

describe('saveAppSettings', () => {
  it('creates the directory and file on first save', () => {
    const nested = path.join(dir, 'deep', 'app-settings.json');
    const result = saveAppSettings(nested, { port: 9000 });
    expect(result.port).toBe(9000);
    expect(JSON.parse(fs.readFileSync(nested, 'utf-8')).port).toBe(9000);
  });

  it('ignores invalid ports in the patch and keeps the current value', () => {
    saveAppSettings(file, { port: 8123 });
    const result = saveAppSettings(file, { port: 0 });
    expect(result.port).toBe(8123);
  });
});

describe('resolvePort', () => {
  it('prefers a valid env value over the settings file', () => {
    expect(resolvePort('9001', { schemaVersion: 1, port: 8123 })).toBe(9001);
  });

  it('falls back to settings when env is unset or invalid', () => {
    expect(resolvePort(undefined, { schemaVersion: 1, port: 8123 })).toBe(8123);
    expect(resolvePort('nope', { schemaVersion: 1, port: 8123 })).toBe(8123);
  });
});

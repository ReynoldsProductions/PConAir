import type { DirectorOfficeSnapshot, DirectorActionResult } from '../director-preload';
import type { AppState } from '../../shared/types';

declare global {
  interface Window {
    pconairDirector: {
      listOffices(): Promise<DirectorOfficeSnapshot[]>;
      fireAction(officeId: string, action: string, body?: Record<string, unknown>): Promise<DirectorActionResult>;
      onOfficeStatus(cb: (officeId: string, status: DirectorOfficeSnapshot['status']) => void): () => void;
      onOfficeState(cb: (officeId: string, state: unknown) => void): () => void;
    };
  }
}

const offices = new Map<string, DirectorOfficeSnapshot>();

const grid = document.getElementById('grid') as HTMLDivElement;

function badgeLabel(status: DirectorOfficeSnapshot['status']): string {
  switch (status) {
    case 'online': return 'Online';
    case 'connecting': return 'Connecting';
    case 'auth_error': return 'Auth Error';
    default: return 'Offline';
  }
}

function activeLowerThirdSummary(state: unknown): string {
  const graphics = (state as AppState | null)?.graphics;
  const lt = graphics?.lowerThird;
  if (!lt || !lt.visible) return '<span class="none">No active lower-third</span>';
  const parts = [lt.name, lt.title].filter((p) => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(' — ') : '<span class="none">No active lower-third</span>';
}

function panelId(officeId: string): string {
  return `panel-${officeId}`;
}

function renderPanel(office: DirectorOfficeSnapshot): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = panelId(office.id);

  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-name">${escapeHtml(office.name)}</span>
      <span class="badge badge-${office.status}" data-role="badge">${badgeLabel(office.status)}</span>
    </div>
    <div class="active-lt" data-role="active-lt">${activeLowerThirdSummary(office.state)}</div>
    <div>
      <label>Name</label>
      <input type="text" data-role="name" placeholder="Jane Doe" />
      <label>Title</label>
      <input type="text" data-role="title" placeholder="Keynote Speaker" />
      <label>Subtitle</label>
      <input type="text" data-role="subtitle" placeholder="(optional)" />
    </div>
    <div class="btn-row">
      <button type="button" data-role="take">Take</button>
      <button type="button" class="secondary" data-role="clear">Clear</button>
    </div>
    <div class="panel-error" data-role="error"></div>
  `;

  const takeBtn = panel.querySelector<HTMLButtonElement>('[data-role="take"]')!;
  const clearBtn = panel.querySelector<HTMLButtonElement>('[data-role="clear"]')!;
  const errorEl = panel.querySelector<HTMLDivElement>('[data-role="error"]')!;

  takeBtn.addEventListener('click', async () => {
    const name = panel.querySelector<HTMLInputElement>('[data-role="name"]')!.value.trim();
    const title = panel.querySelector<HTMLInputElement>('[data-role="title"]')!.value.trim();
    const subtitle = panel.querySelector<HTMLInputElement>('[data-role="subtitle"]')!.value.trim();
    if (!name) {
      errorEl.textContent = 'Name is required.';
      return;
    }
    errorEl.textContent = '';
    const result = await window.pconairDirector.fireAction(office.id, 'lower_third_apply', { name, title, subtitle });
    if (!result.ok) errorEl.textContent = result.error.message;
  });

  clearBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    const result = await window.pconairDirector.fireAction(office.id, 'lower_third_hide', {});
    if (!result.ok) errorEl.textContent = result.error.message;
  });

  return panel;
}

function updatePanelStatus(officeId: string, status: DirectorOfficeSnapshot['status']): void {
  const panel = document.getElementById(panelId(officeId));
  const badge = panel?.querySelector<HTMLSpanElement>('[data-role="badge"]');
  if (!badge) return;
  badge.className = `badge badge-${status}`;
  badge.textContent = badgeLabel(status);
}

function updatePanelState(officeId: string, state: unknown): void {
  const panel = document.getElementById(panelId(officeId));
  const activeLt = panel?.querySelector<HTMLDivElement>('[data-role="active-lt"]');
  if (!activeLt) return;
  activeLt.innerHTML = activeLowerThirdSummary(state);
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderGrid(): void {
  grid.innerHTML = '';
  if (offices.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No offices configured. Add offices in Admin → Offices.';
    grid.appendChild(empty);
    return;
  }
  for (const office of offices.values()) {
    grid.appendChild(renderPanel(office));
  }
}

async function boot(): Promise<void> {
  const list = await window.pconairDirector.listOffices();
  offices.clear();
  for (const o of list) offices.set(o.id, o);
  renderGrid();

  window.pconairDirector.onOfficeStatus((officeId, status) => {
    const office = offices.get(officeId);
    if (office) office.status = status;
    updatePanelStatus(officeId, status);
  });

  window.pconairDirector.onOfficeState((officeId, state) => {
    const office = offices.get(officeId);
    if (office) office.state = state;
    updatePanelState(officeId, state);
  });
}

void boot();

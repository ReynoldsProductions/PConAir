/**
 * `/prompter-control/` — standalone operator page. Mounts the shared
 * `prompter-controls` module (design doc section 7) as its entire content:
 * "everything the operator needs for the prompter, nothing else". No tabs,
 * no other sections — that's the whole point of this mount versus `/remote/`.
 */

import type { PrompterState } from '../../shared/types';
import { makePrompterState } from '../../shared/types';
import { renderPrompterControls, wirePrompterControls } from '../shared/prompter-controls';

// Light is the CSS default; a per-device override wins, same as /remote/.
function applyTheme(): void {
  let local: string | null = null;
  try {
    local = localStorage.getItem('pconair-operator-theme');
  } catch {
    /* storage disabled — fall back to the profile default */
  }
  if (local === 'light' || local === 'dark') {
    document.documentElement.setAttribute('data-theme', local);
    return;
  }
  void fetch('/api/profiles/active')
    .then((r) => (r.ok ? r.json() : null))
    .then((p: { appPreferences?: { operatorTheme?: string } } | null) => {
      const theme = p?.appPreferences?.operatorTheme === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
    })
    .catch(() => {
      /* keep the light default */
    });
}
applyTheme();

async function rawPost(path: string, body?: object): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * Google sign-in status/trigger for Script Source's fetch layer
 * (`src/main/prompter/doc-transport.ts`), which reuses Slides mode's
 * `persist:google-slides` session. `GET /api/slides/auth` /
 * `POST /api/slides/auth/open` already exist for the operator app's Slides
 * tab — this mounts the same pair here, since this page has no other way to
 * reach it.
 */
async function mountGoogleAuth(): Promise<void> {
  const statusEl = document.getElementById('pcp-google-status');
  const signinBtn = document.getElementById('pcp-google-signin');
  const refreshBtn = document.getElementById('pcp-google-refresh');
  if (!statusEl || !signinBtn || !refreshBtn) return;

  async function refresh(): Promise<void> {
    statusEl!.textContent = 'Checking…';
    try {
      const res = await fetch('/api/slides/auth');
      const state = (await res.json()) as { loggedIn: boolean; email: string | null };
      statusEl!.textContent = state.loggedIn
        ? `Signed in${state.email ? ' as ' + state.email : ''}`
        : 'Not signed in';
    } catch {
      statusEl!.textContent = 'Could not check sign-in status.';
    }
  }

  signinBtn.addEventListener('click', async () => {
    const r = await rawPost('/api/slides/auth/open');
    statusEl!.textContent = r.ok ? 'Sign-in window opened on the host machine' : 'Could not open sign-in.';
  });
  refreshBtn.addEventListener('click', () => void refresh());

  await refresh();
}

let onStateUpdate: ((state: PrompterState) => void) | null = null;

function mount(): void {
  const root = document.getElementById('pcp-mount');
  if (!root) return;
  root.innerHTML = renderPrompterControls(makePrompterState());
  wirePrompterControls(root, {
    post: rawPost,
    onState: (cb) => {
      onStateUpdate = cb;
    },
  });
}

async function hydrate(): Promise<void> {
  try {
    const res = await fetch('/api/prompter/status');
    if (!res.ok) return;
    const data = (await res.json()) as { prompter: PrompterState };
    onStateUpdate?.(data.prompter);
  } catch {
    /* the WS connection below will catch us up once it connects */
  }
}

let ws: WebSocket | null = null;
let reconnectDelayMs = 1000;

function connectWs(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    reconnectDelayMs = 1000;
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as { type: string; payload?: Record<string, unknown> };
      if (msg.type === 'state' && msg.payload?.prompter) {
        onStateUpdate?.(msg.payload.prompter as PrompterState);
      } else if (msg.type === 'state_patch' && msg.payload && 'prompter' in msg.payload) {
        onStateUpdate?.(msg.payload.prompter as PrompterState);
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    setTimeout(connectWs, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 15000);
  };
}

mount();
void hydrate();
void mountGoogleAuth();
connectWs();

// @vitest-environment jsdom
//
// Unit coverage for src/renderer/shared/prompter-controls.ts — the one piece
// of Phase 4b (design doc section 7) that's both TypeScript and DOM-shaped,
// so unlike the rest of that phase's renderer surfaces it can be exercised
// directly against jsdom rather than needing live verification. Mirrors the
// pattern in tests/declarative-controls-render.test.ts (import in a jsdom
// environment; vitest picks one environment per file).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makePrompterState } from '../src/shared/types';
import { renderPrompterControls, wirePrompterControls } from '../src/renderer/shared/prompter-controls';
import type { PrompterState } from '../src/shared/types';

function mount(state: PrompterState): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = renderPrompterControls(state);
  document.body.appendChild(root);
  return root;
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('renderPrompterControls', () => {
  it('renders the Script Source block with the update-ready pill hidden by default', () => {
    const html = renderPrompterControls(makePrompterState());
    expect(html).toContain('data-pcp-root');
    expect(html).toContain('data-pcp-library');
    expect(html).toContain('data-pcp-url');
    expect(html).toContain('data-pcp-refresh');
    expect(html).toContain('data-pcp-take');
    // Pill present but hidden — no doc attached yet.
    expect(html).toMatch(/data-pcp-pill[^>]*hidden/);
  });

  it('shows the update-ready pill only when status is ready and something is staged', () => {
    const state: PrompterState = {
      ...makePrompterState(),
      doc: {
        ...makePrompterState().doc,
        docId: 'abc123',
        status: 'ready',
        staged: { text: 'new copy', hash: 'h2', words: 2, fetchedAt: Date.now() },
      },
    };
    const html = renderPrompterControls(state);
    expect(html).not.toMatch(/data-pcp-pill[^>]*hidden/);
  });

  it('disables Take when nothing is staged, and enables it when something is', () => {
    const idle = renderPrompterControls(makePrompterState());
    expect(idle).toMatch(/data-pcp-take[^>]*disabled/);

    const withStaged = renderPrompterControls({
      ...makePrompterState(),
      doc: {
        ...makePrompterState().doc,
        docId: 'abc123',
        status: 'ready',
        staged: { text: 'x', hash: 'h', words: 1, fetchedAt: Date.now() },
      },
    });
    expect(withStaged).not.toMatch(/data-pcp-take[^>]*disabled/);
  });
});

describe('wirePrompterControls', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ docs: [] }));
    vi.stubGlobal('fetch', fetchMock);
  });

  it('loads the saved-script library via GET on mount, not via the injected post', () => {
    const root = mount(makePrompterState());
    const post = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    wirePrompterControls(root, { post, onState: () => {} });

    expect(fetchMock).toHaveBeenCalledWith('/api/prompter/docs');
    expect(post).not.toHaveBeenCalled();
  });

  it('POSTs doc/load with the ad-hoc URL when the URL Load button is clicked', async () => {
    const root = mount(makePrompterState());
    const post = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    wirePrompterControls(root, { post, onState: () => {} });

    const input = root.querySelector('[data-pcp-url]') as HTMLInputElement;
    input.value = 'https://docs.google.com/document/d/xyz/edit';
    (root.querySelector('[data-pcp-load-url]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(post).toHaveBeenCalledWith('/api/prompter/doc/load', { url: 'https://docs.google.com/document/d/xyz/edit' });
  });

  it('refuses to load an ad-hoc URL when the field is empty, without calling post', () => {
    const root = mount(makePrompterState());
    const post = vi.fn();
    wirePrompterControls(root, { post, onState: () => {} });

    (root.querySelector('[data-pcp-load-url]') as HTMLButtonElement).click();
    expect(post).not.toHaveBeenCalled();
    expect(root.querySelector('[data-pcp-msg]')!.textContent).toMatch(/paste a google doc url/i);
  });

  it('POSTs doc/refresh and doc/take on their respective buttons', () => {
    // Take starts disabled (nothing staged) — mount with a staged doc so the
    // click actually fires, matching how the button behaves once wired to
    // real state via onState.
    const root = mount({
      ...makePrompterState(),
      doc: {
        ...makePrompterState().doc,
        docId: 'abc123',
        status: 'ready',
        staged: { text: 'x', hash: 'h', words: 1, fetchedAt: Date.now() },
      },
    });
    const post = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    wirePrompterControls(root, { post, onState: () => {} });

    (root.querySelector('[data-pcp-refresh]') as HTMLButtonElement).click();
    expect(post).toHaveBeenCalledWith('/api/prompter/doc/refresh');

    (root.querySelector('[data-pcp-take]') as HTMLButtonElement).click();
    expect(post).toHaveBeenCalledWith('/api/prompter/doc/take');
  });

  it('registers an onState callback that updates the pill/status/take-button from a new state', () => {
    const root = mount(makePrompterState());
    const post = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    let update: ((s: PrompterState) => void) | null = null;
    wirePrompterControls(root, {
      post,
      onState: (cb) => {
        update = cb;
      },
    });

    expect(update).not.toBeNull();

    const readyState: PrompterState = {
      ...makePrompterState(),
      script: 'one two three',
      doc: {
        ...makePrompterState().doc,
        docId: 'abc123',
        name: 'Cold Open',
        loadedAt: Date.now(),
        status: 'ready',
        staged: { text: 'new copy here', hash: 'h2', words: 3, fetchedAt: Date.now() },
      },
    };
    update!(readyState);

    expect(root.querySelector('[data-pcp-pill]')!.hasAttribute('hidden')).toBe(false);
    expect((root.querySelector('[data-pcp-take]') as HTMLButtonElement).disabled).toBe(false);
    expect(root.querySelector('[data-pcp-status]')!.textContent).toContain('Cold Open');
  });

  it('surfaces a doc error via the message line when state updates with status "error"', () => {
    const root = mount(makePrompterState());
    const post = vi.fn();
    let update: ((s: PrompterState) => void) | null = null;
    wirePrompterControls(root, {
      post,
      onState: (cb) => {
        update = cb;
      },
    });

    update!({
      ...makePrompterState(),
      doc: {
        ...makePrompterState().doc,
        docId: 'abc123',
        status: 'error',
        error: { code: 'DOC_NOT_READABLE', message: 'Sign in to Google, or set the doc to link-viewable.' },
      },
    });

    const msg = root.querySelector('[data-pcp-msg]')!;
    expect(msg.textContent).toContain('Sign in to Google');
    expect(msg.classList.contains('error')).toBe(true);
  });
});

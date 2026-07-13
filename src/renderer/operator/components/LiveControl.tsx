// First Slate-design-system React components in the app (see .superpowers/sdd
// task-2-brief.md). Renders two independent regions of the Operator shell:
//   - StatusHeader: the `.status-bar` contents (machine name, WS/Companion
//     indicators, mode Tag, show-lock badge, PANIC button).
//   - LiveControlPanels: the "Live Control" tab's A/B Instance + Mode panels.
//
// Both are mounted as separate React roots from index.tsx (see boot section)
// since they live in non-adjacent parts of the static DOM (header vs. tab
// content) — no React Portal needed, just two small trees re-rendered
// together on every store update.
import * as React from 'react';
import type { AppState, Mode, ABInstance } from '../../../shared/types';

const { SlateDSProvider, Tag, Button } = window.Slate;

const MODE_TAG_VARIANT: Record<Mode, 'neutral' | 'success' | 'warning' | 'critical' | 'info' | 'strong'> = {
  idle: 'neutral',
  slides: 'info',
  url: 'success',
  l3: 'warning',
  'media-library': 'strong',
};

const MODE_BUTTONS: Array<{ mode: Mode; label: string }> = [
  { mode: 'idle', label: 'Idle' },
  { mode: 'slides', label: 'Slides' },
  { mode: 'url', label: 'URL' },
  { mode: 'l3', label: 'Lower Thirds' },
  { mode: 'media-library', label: 'Media Library' },
];

export interface StatusHeaderProps {
  state: AppState;
  /**
   * The client's own WebSocket connection status. Not part of `AppState` —
   * it's flipped directly from `connectWs()`'s `open`/`close` handlers, same
   * as the original `setWsStatus()` — so it's threaded in as its own prop
   * rather than read off `state`.
   */
  wsConnected: boolean;
  onPanic: () => Promise<void>;
}

/**
 * `.status-bar` contents. `id="machine-name-label"` is intentionally rendered
 * with static initial text only — `refreshActiveProfile()` in index.tsx
 * writes its `textContent` directly via `document.getElementById` (as it did
 * before this migration) and is NOT part of this component's props, so this
 * JSX never re-renders that node with different text and there's no
 * dual-write with the vanilla code.
 */
export function StatusHeader({ state, wsConnected, onPanic }: StatusHeaderProps): React.ReactElement {
  const panicActive = state.reliability.panicActive;
  const companionConnected = state.connectionStatus.companionConnected;

  return (
    <SlateDSProvider>
      <header className="status-bar">
        <span className="status-bar-machine" id="machine-name-label">PC On Air</span>
        <div className="status-bar-indicators">
          <div className="status-indicator">
            <span className={wsConnected ? 'led connected' : 'led'} id="ws-dot"></span>
            <span id="ws-label">{wsConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div className="status-indicator">
            <span className={companionConnected ? 'led connected' : 'led'} id="companion-dot"></span>
            <span>Companion</span>
          </div>
          <Tag
            id="mode-badge"
            label={state.currentMode.toUpperCase()}
            variant={MODE_TAG_VARIANT[state.currentMode]}
          />
          <span id="show-lock-badge" className={state.connectionStatus.adminShowLocked ? 'visible' : undefined}>
            SHOW LOCKED
          </span>
          <Button
            id="panic-btn"
            type="button"
            variant="primary"
            destructive
            size="small"
            onClick={onPanic}
          >
            {panicActive ? 'UN-PANIC' : 'PANIC'}
          </Button>
        </div>
      </header>
    </SlateDSProvider>
  );
}

export interface LiveControlPanelsProps {
  state: AppState;
  onSwitchAB: (instance: ABInstance) => Promise<void>;
  onSetMode: (mode: Mode) => Promise<void>;
}

/** The "Live Control" tab's A/B Instance panel + Mode panel. */
export function LiveControlPanels({ state, onSwitchAB, onSetMode }: LiveControlPanelsProps): React.ReactElement {
  const activeInstance = state.abState.activeInstance;

  return (
    <SlateDSProvider>
      <div className="panel">
        <div className="panel-title">A/B Instance</div>
        <div className="ab-row">
          <Button
            id="ab-a-btn"
            type="button"
            data-instance="A"
            variant={activeInstance === 'A' ? 'primary' : 'secondary'}
            fullWidth
            onClick={() => onSwitchAB('A')}
          >
            A
          </Button>
          <Button
            id="ab-b-btn"
            type="button"
            data-instance="B"
            variant={activeInstance === 'B' ? 'primary' : 'secondary'}
            fullWidth
            onClick={() => onSwitchAB('B')}
          >
            B
          </Button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-title">Mode</div>
        <div className="mode-btn-grid">
          {MODE_BUTTONS.map(({ mode, label }) => (
            <Button
              key={mode}
              type="button"
              data-mode={mode}
              variant="secondary"
              fullWidth
              onClick={() => onSetMode(mode)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </SlateDSProvider>
  );
}

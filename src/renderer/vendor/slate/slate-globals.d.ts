// Ambient typings for the vendored Slate design-system UMD bundle
// (`src/renderer/vendor/slate/_ds_bundle.js`), which attaches itself to
// `window.Slate` at runtime (see `styles.css` + `_ds_bundle.js` <script>
// tags loaded in each entry's index.html).
//
// There is no published `@faire/slate` npm package in this repo to import
// types from, so these signatures were hand-verified against the vendored
// bundle's (unminified) source — see the component definitions in
// `_ds_bundle.js` for `Tag`, `Button`, and `SlateDSProvider`. Extend this
// file as later tasks pull in more Slate components (TextInput, Select,
// ListItem, etc.) rather than re-declaring `window.Slate` elsewhere.
import type * as React from 'react';

export interface SlateTagProps {
  label: string;
  /** Defaults to `'neutral'` if omitted. */
  variant?: 'neutral' | 'success' | 'warning' | 'critical' | 'info' | 'strong';
  /** Renders a dismiss (x) button when provided. */
  onDismiss?: () => void;
  className?: string;
  [key: string]: unknown;
}

export interface SlateButtonProps {
  children?: React.ReactNode;
  /** Defaults to `'primary'` if omitted. */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'plain';
  /** Defaults to `'medium'` if omitted. */
  size?: 'xSmall' | 'small' | 'medium';
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  iconProps?: { Component: React.ComponentType<Record<string, unknown>>; position?: 'start' | 'end' };
  /** May return a Promise — Button shows its own loading spinner while it's pending. */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  [key: string]: unknown;
}

export interface SlateGlobal {
  SlateDSProvider: React.FC<{ children?: React.ReactNode }>;
  Tag: React.FC<SlateTagProps>;
  Button: React.FC<SlateButtonProps>;
  // Remaining ~46 components on the bundle aren't typed yet — loosen to
  // `any` so referencing them doesn't hard-fail typecheck before a later
  // task adds explicit prop types for the ones it needs.
  [otherComponentName: string]: React.ComponentType<any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
}

declare global {
  interface Window {
    Slate: SlateGlobal;
  }
}

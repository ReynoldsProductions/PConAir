import type { CompanionActionDefinition, CompanionActionContext, CompanionActionEvent } from '@companion-module/base'
import type { PcoState } from './client.js'

export type SendAction = (actionId: string, params: Record<string, unknown>) => Promise<void>
export type GscPost = (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>
export type Log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void

export interface ActionDeps {
  /** Native PConAir action dispatch (WebSocket / /api/action). */
  dispatch: SendAction
  /** Cookie-less POST to the GSC-compat HTTP surface. */
  gscPost: GscPost
  getApp: () => Partial<PcoState>
  log: Log
}

async function parsed(
  context: CompanionActionContext,
  event: CompanionActionEvent,
  optionId: string
): Promise<string> {
  return context.parseVariablesInString(String(event.options[optionId] ?? ''))
}

/**
 * Action set = original PConAir IDs + the full GSC module ID list (preserved
 * exactly; unsupported ones hit the compat endpoints and surface the server's
 * honest 400) + new v2 actions for slides extras, L3 playlists and the still
 * store. Package actions are registered separately (see packages.ts).
 */
export function buildActions(deps: ActionDeps): Record<string, CompanionActionDefinition> {
  const { dispatch, gscPost, getApp, log } = deps

  /** GSC-style action: POST a compat endpoint, log result, never throw. */
  function gscAction(
    name: string,
    path: string,
    options: CompanionActionDefinition['options'] = [],
    buildBody?: (event: CompanionActionEvent, context: CompanionActionContext) => Promise<Record<string, unknown>>,
    description?: string
  ): CompanionActionDefinition {
    return {
      name,
      description,
      options,
      callback: async (event, context) => {
        try {
          const body = buildBody ? await buildBody(event, context) : {}
          await gscPost(path, body)
          log('debug', `${name}: ok`)
        } catch (err) {
          log('error', `${name} failed: ${(err as Error).message}`)
        }
      },
    }
  }

  const urlOption = (label = 'URL'): CompanionActionDefinition['options'] => [
    { id: 'url', type: 'textinput', label, default: '', required: true, useVariables: true },
  ]

  return {
    // ════ GSC compat (IDs must match companion-module-gslide-opener) ════
    open_presentation: gscAction(
      'Open Presentation',
      '/api/open-presentation',
      urlOption('Google Slides URL'),
      async (e, c) => ({ url: await parsed(c, e, 'url') })
    ),
    open_presentation_with_notes: gscAction(
      'Open Presentation with Notes',
      '/api/open-presentation-with-notes',
      urlOption('Google Slides URL'),
      async (e, c) => ({ url: await parsed(c, e, 'url') })
    ),
    open_slido: gscAction(
      'Open Slido (Web URL)',
      '/api/open-slido',
      urlOption('Slido / Web URL'),
      async (e, c) => ({ url: await parsed(c, e, 'url') }),
      'Opens the URL in PConAir URL mode (GSC "Slido" compatibility)'
    ),
    open_url: gscAction(
      'Open URL',
      '/api/open-url',
      [
        ...urlOption(),
        { id: 'backgroundColor', type: 'textinput', label: 'Background color (hex)', default: '#000000', useVariables: true },
      ],
      async (e, c) => ({ url: await parsed(c, e, 'url'), backgroundColor: await parsed(c, e, 'backgroundColor') })
    ),
    open_key_fill: gscAction(
      'Open Key/Fill URLs (not supported)',
      '/api/open-key-fill',
      [
        { id: 'fillUrl', type: 'textinput', label: 'Fill URL', default: '', useVariables: true },
        { id: 'fillBgColor', type: 'textinput', label: 'Fill background (hex)', default: '#000000', useVariables: true },
        { id: 'keyUrl', type: 'textinput', label: 'Key URL', default: '', useVariables: true },
        { id: 'keyBgColor', type: 'textinput', label: 'Key background (hex)', default: '#000000', useVariables: true },
      ],
      async (e, c) => ({
        fillUrl: await parsed(c, e, 'fillUrl'),
        fillBgColor: await parsed(c, e, 'fillBgColor'),
        keyUrl: await parsed(c, e, 'keyUrl'),
        keyBgColor: await parsed(c, e, 'keyBgColor'),
      }),
      'PConAir uses /render pages with bg modes instead — this GSC action reports an error'
    ),
    close_key_fill: gscAction('Close Key/Fill (not supported)', '/api/close-key-fill'),
    open_preset_1: gscAction('Open Presentation 1 (not supported)', '/api/open-preset', [], async () => ({ preset: 1 })),
    open_preset_2: gscAction('Open Presentation 2 (not supported)', '/api/open-preset', [], async () => ({ preset: 2 })),
    open_preset_3: gscAction('Open Presentation 3 (not supported)', '/api/open-preset', [], async () => ({ preset: 3 })),
    close_presentation: gscAction('Close Current Presentation', '/api/close-presentation'),
    next_slide: gscAction('Next Slide', '/api/next-slide'),
    previous_slide: gscAction('Previous Slide', '/api/previous-slide'),
    go_to_slide: gscAction(
      'Go to Slide',
      '/api/go-to-slide',
      [{ id: 'slide', type: 'number', label: 'Slide Number', default: 1, min: 1, max: 9999, required: true }],
      async (e) => ({ slide: Number(e.options['slide']) })
    ),
    reload_presentation: gscAction('Reload Presentation', '/api/reload-presentation'),
    toggle_video: gscAction('Toggle Video Playback (not supported)', '/api/toggle-video'),
    open_speaker_notes: gscAction('Open Speaker Notes', '/api/open-speaker-notes'),
    close_speaker_notes: gscAction('Close Speaker Notes', '/api/close-speaker-notes'),
    scroll_notes_down: gscAction('Scroll Speaker Notes Down (not supported)', '/api/scroll-notes-down'),
    scroll_notes_up: gscAction('Scroll Speaker Notes Up (not supported)', '/api/scroll-notes-up'),
    zoom_in_notes: gscAction('Zoom In Speaker Notes (not supported)', '/api/zoom-in-notes'),
    zoom_out_notes: gscAction('Zoom Out Speaker Notes (not supported)', '/api/zoom-out-notes'),
    show_share_qr: gscAction(
      'Show Tunnel QR',
      '/api/show-tunnel-qr',
      [{ id: 'durationSec', type: 'number', label: 'Display Duration (seconds)', default: 20, min: 5, max: 300, required: true }],
      async (e) => ({ duration: Number(e.options['durationSec']) })
    ),
    hide_share_qr: gscAction('Hide Tunnel QR', '/api/hide-tunnel-qr'),
    set_backup_controls: gscAction(
      'Set Backup Controls (not supported)',
      '/api/set-backup-controls',
      [
        {
          id: 'enabled',
          type: 'dropdown',
          label: 'Enable/Disable',
          default: 'enable',
          choices: [
            { id: 'enable', label: 'Enable' },
            { id: 'disable', label: 'Disable' },
          ],
        },
      ],
      async (e) => ({ enabled: e.options['enabled'] === 'enable' })
    ),
    set_notes_layout: gscAction(
      'Set Notes Layout (not supported)',
      '/api/preferences',
      [
        {
          id: 'layout',
          type: 'dropdown',
          label: 'Layout',
          default: 'hide',
          choices: [
            { id: 'hide', label: 'Full Notes' },
            { id: 'default', label: 'Google Default' },
          ],
        },
      ],
      async (e) => ({ notesLayout: e.options['layout'] })
    ),
    relaunch_speaker_notes: gscAction('Relaunch Speaker Notes (not supported)', '/api/relaunch-speaker-notes'),
    perfectcue_enable_all: gscAction('PerfectCue: Enable All Ports (not supported)', '/api/set-perfectcue-enabled', [], async () => ({ enabled: true })),
    perfectcue_disable_all: gscAction('PerfectCue: Disable All Ports (not supported)', '/api/set-perfectcue-enabled', [], async () => ({ enabled: false })),
    perfectcue_set_port_enabled: gscAction(
      'PerfectCue: Enable/Disable Port (not supported)',
      '/api/toggle-perfectcue-port',
      [
        { id: 'port', type: 'number', label: 'Port Number', default: 8899, min: 1024, max: 65535 },
        {
          id: 'enabled',
          type: 'dropdown',
          label: 'State',
          default: 'true',
          choices: [
            { id: 'true', label: 'Enable' },
            { id: 'false', label: 'Disable' },
          ],
        },
      ],
      async (e) => ({ port: Number(e.options['port']), enabled: e.options['enabled'] === 'true' })
    ),

    // ════ Slides (native) ════
    slides_next: { name: 'Next Slide (native)', options: [], callback: async () => dispatch('slides_next', {}) },
    slides_prev: { name: 'Previous Slide (native)', options: [], callback: async () => dispatch('slides_prev', {}) },
    prev_slide: { name: 'Previous Slide (alias)', options: [], callback: async () => dispatch('slides_prev', {}) },
    slides_goto: {
      name: 'Go to Slide (native)',
      options: [
        { type: 'number', id: 'slide_number', label: 'Slide Number (1-based)', default: 1, min: 1, max: 9999, required: true },
      ],
      callback: async ({ options }) => dispatch('slides_goto', { slide_number: Number(options['slide_number']) }),
    },
    go_to_first: { name: 'Go to First Slide', options: [], callback: async () => dispatch('slides_goto_first', {}) },
    go_to_last: { name: 'Go to Last Slide', options: [], callback: async () => dispatch('slides_goto_last', {}) },
    slides_load: {
      name: 'Load Slides Deck',
      options: [
        { type: 'textinput', id: 'deck_url', label: 'Deck URL', default: '', useVariables: true, required: true },
        { type: 'textinput', id: 'backup_url', label: 'Backup Deck URL (optional)', default: '', useVariables: true },
        {
          type: 'dropdown',
          id: 'instance',
          label: 'Instance',
          default: 'active',
          choices: [
            { id: 'active', label: 'Active' },
            { id: 'A', label: 'Instance A' },
            { id: 'B', label: 'Instance B' },
          ],
        },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = {
          deck_url: await parsed(context, event, 'deck_url'),
          instance: event.options['instance'],
        }
        const backup = await parsed(context, event, 'backup_url')
        if (backup) params['backup_url'] = backup
        await dispatch('slides_load', params)
      },
    },
    load_deck: {
      name: 'Load Deck (Primary + Backup)',
      options: [
        { type: 'textinput', id: 'url', label: 'Primary Deck URL', default: '', useVariables: true, required: true },
        { type: 'textinput', id: 'backup_url', label: 'Backup Deck URL (optional)', default: '', useVariables: true },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = { deck_url: await parsed(context, event, 'url') }
        const backup = await parsed(context, event, 'backup_url')
        if (backup) params['backup_url'] = backup
        await dispatch('slides_load', params)
      },
    },
    slides_reload: {
      name: 'Reload Slides (Keep Position)',
      options: [
        {
          type: 'dropdown',
          id: 'instance',
          label: 'Instance',
          default: 'active',
          choices: [
            { id: 'active', label: 'Active' },
            { id: 'A', label: 'Instance A' },
            { id: 'B', label: 'Instance B' },
          ],
        },
      ],
      callback: async ({ options }) => dispatch('slides_reload', { instance: options['instance'] }),
    },
    reload_deck: { name: 'Reload Deck (alias)', options: [], callback: async () => dispatch('slides_reload', {}) },
    slides_switch_ab: {
      name: 'Switch Slides Instance (A ↔ B)',
      options: [],
      callback: async () => dispatch('slides_switch_ab', {}),
    },
    toggle_offline_mode: {
      name: 'Toggle Offline Mode',
      options: [],
      callback: async () => dispatch('slides_offline_mode', {}),
    },
    set_offline_mode: {
      name: 'Set Offline Mode',
      options: [
        {
          type: 'dropdown',
          id: 'enabled',
          label: 'Offline Mode',
          default: 'true',
          choices: [
            { id: 'true', label: 'Enable' },
            { id: 'false', label: 'Disable' },
          ],
        },
      ],
      callback: async ({ options }) => dispatch('slides_offline_mode', { enabled: options['enabled'] === 'true' }),
    },

    // ════ URL mode ════
    load_url: {
      name: 'Load URL',
      options: [
        { type: 'textinput', id: 'url', label: 'URL', default: '', useVariables: true, required: true },
        { type: 'textinput', id: 'display', label: 'Display ID (optional)', default: '', useVariables: true },
        {
          type: 'dropdown',
          id: 'session_mode',
          label: 'Session Mode',
          default: 'persistent',
          choices: [
            { id: 'persistent', label: 'Persistent' },
            { id: 'ephemeral', label: 'Ephemeral' },
          ],
        },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = {
          url: await parsed(context, event, 'url'),
          session_mode: event.options['session_mode'],
        }
        const display = await parsed(context, event, 'display')
        if (display) params['display'] = display
        await dispatch('load_url', params)
      },
    },
    load_url_preset: {
      name: 'Load URL Preset',
      options: [
        { type: 'textinput', id: 'preset', label: 'Preset ID or Name', default: '', useVariables: true, required: true },
        { type: 'textinput', id: 'display', label: 'Display ID (optional)', default: '', useVariables: true },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = { preset: await parsed(context, event, 'preset') }
        const display = await parsed(context, event, 'display')
        if (display) params['display'] = display
        await dispatch('load_url_preset', params)
      },
    },
    reload_url: { name: 'Reload Current URL (On-Air)', options: [], callback: async () => dispatch('reload_url', {}) },
    reload_url_offair: {
      name: 'Reload Current URL (Off-Air)',
      options: [],
      callback: async () => dispatch('reload_url_offair', {}),
    },
    url_switch_ab: {
      name: 'Switch URL Instance (A ↔ B)',
      options: [],
      callback: async () => dispatch('url_switch_ab', {}),
    },
    url_switch_to: {
      name: 'Switch URL Instance To…',
      options: [
        {
          type: 'dropdown',
          id: 'instance',
          label: 'Instance',
          default: 'A',
          choices: [
            { id: 'A', label: 'Instance A' },
            { id: 'B', label: 'Instance B' },
          ],
        },
      ],
      callback: async ({ options }) => dispatch('url_switch_to', { instance: options['instance'] }),
    },

    // ════ Lower thirds ════
    l3_take: {
      name: 'Take Lower Third Cue',
      options: [
        { type: 'textinput', id: 'cue_id', label: 'Cue ID (blank = inline name/title)', default: '', useVariables: true },
        { type: 'textinput', id: 'name', label: 'Name (inline take)', default: '', useVariables: true },
        { type: 'textinput', id: 'title', label: 'Title (inline take)', default: '', useVariables: true },
        { type: 'textinput', id: 'theme', label: 'Theme (optional)', default: '', useVariables: true },
      ],
      callback: async (event, context) => {
        const params: Record<string, unknown> = {}
        const cueId = await parsed(context, event, 'cue_id')
        const name = await parsed(context, event, 'name')
        const title = await parsed(context, event, 'title')
        const theme = await parsed(context, event, 'theme')
        if (cueId) params['cue_id'] = cueId
        if (name) params['name'] = name
        if (title) params['title'] = title
        if (theme) params['theme'] = theme
        await dispatch('l3_take', params)
      },
    },
    l3_clear: { name: 'Clear Lower Third', options: [], callback: async () => dispatch('l3_clear', {}) },
    l3_next: { name: 'L3 Playlist Next', options: [], callback: async () => dispatch('l3_next', {}) },
    l3_prev: { name: 'L3 Playlist Previous', options: [], callback: async () => dispatch('l3_prev', {}) },
    l3_activate_playlist: {
      name: 'Activate L3 Playlist',
      options: [
        { type: 'textinput', id: 'playlist', label: 'Playlist ID or Name', default: '', useVariables: true, required: true },
      ],
      callback: async (event, context) =>
        dispatch('l3_activate_playlist', { playlist: await parsed(context, event, 'playlist') }),
    },
    l3_stacking_on: { name: 'Enable Lower Third Stacking', options: [], callback: async () => dispatch('l3_stacking_on', {}) },
    l3_stacking_off: { name: 'Disable Lower Third Stacking', options: [], callback: async () => dispatch('l3_stacking_off', {}) },
    l3_toggle_stacking: { name: 'Toggle Lower Third Stacking', options: [], callback: async () => dispatch('l3_toggle_stacking', {}) },

    // ════ Still store ════
    stills_take: {
      name: 'Take Still',
      options: [
        { type: 'textinput', id: 'item', label: 'Image ID or Name', default: '', useVariables: true, required: true },
      ],
      callback: async (event, context) => dispatch('stills_take', { item: await parsed(context, event, 'item') }),
    },
    stills_clear: { name: 'Clear Still Output', options: [], callback: async () => dispatch('stills_clear', {}) },
    stills_slideshow_play: {
      name: 'Slideshow Play / Resume',
      description: 'Blank item list resumes a paused show, restarts the loaded list, or plays the whole library',
      options: [
        { type: 'textinput', id: 'item_ids', label: 'Image IDs (comma-separated, optional)', default: '', useVariables: true },
        { type: 'number', id: 'interval_sec', label: 'Interval (seconds)', default: 5, min: 1, max: 3600 },
        {
          type: 'dropdown',
          id: 'transition',
          label: 'Transition',
          default: 'cut',
          choices: [
            { id: 'cut', label: 'Hard Cut' },
            { id: 'fade', label: 'Fade' },
          ],
        },
      ],
      callback: async (event, context) => {
        const raw = await parsed(context, event, 'item_ids')
        const itemIds = raw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
        await dispatch('stills_slideshow_play', {
          item_ids: itemIds,
          interval_sec: Number(event.options['interval_sec']) || 5,
          transition: event.options['transition'],
        })
      },
    },
    stills_slideshow_pause: { name: 'Slideshow Pause', options: [], callback: async () => dispatch('stills_slideshow_pause', {}) },
    stills_slideshow_resume: { name: 'Slideshow Resume', options: [], callback: async () => dispatch('stills_slideshow_resume', {}) },
    stills_slideshow_stop: { name: 'Slideshow Stop', options: [], callback: async () => dispatch('stills_slideshow_stop', {}) },
    stills_slideshow_next: { name: 'Slideshow Next Image', options: [], callback: async () => dispatch('stills_slideshow_next', {}) },
    stills_slideshow_prev: { name: 'Slideshow Previous Image', options: [], callback: async () => dispatch('stills_slideshow_prev', {}) },

    // ════ Mode / display / A-B ════
    ab_switch: {
      name: 'Switch Active A/B Instance (Current Mode)',
      options: [],
      callback: async () => dispatch('ab_switch', {}),
    },
    set_display: {
      name: 'Set Target Display',
      options: [
        { type: 'textinput', id: 'display', label: 'Display Name or ID', default: '', useVariables: true, required: true },
      ],
      callback: async (event, context) => dispatch('set_display', { display: await parsed(context, event, 'display') }),
    },
    set_mode: {
      name: 'Switch Mode',
      options: [
        {
          type: 'dropdown',
          id: 'mode',
          label: 'Mode',
          default: 'slides',
          choices: [
            { id: 'slides', label: 'Slides' },
            { id: 'url', label: 'URL' },
            { id: 'l3', label: 'Lower Thirds' },
            { id: 'media-library', label: 'Still Store' },
            { id: 'idle', label: 'Idle' },
          ],
        },
      ],
      callback: async ({ options }) => dispatch('set_mode', { mode: options['mode'] }),
    },

    // ════ Render outputs (software path) ════
    set_render_bg: {
      name: 'Set Render Background Mode',
      description: 'Switches a /render page background without a reload (OBS key modes)',
      options: [
        {
          type: 'dropdown',
          id: 'content',
          label: 'Content Type',
          default: 'l3',
          choices: [
            { id: 'slides', label: 'Slides' },
            { id: 'l3', label: 'Lower Thirds' },
            { id: 'stills', label: 'Still Store' },
            { id: 'url', label: 'URL' },
          ],
        },
        {
          type: 'dropdown',
          id: 'bg',
          label: 'Background',
          default: 'transparent',
          choices: [
            { id: 'transparent', label: 'Transparent' },
            { id: 'black', label: 'Black (luma key)' },
            { id: 'white', label: 'White (luma key)' },
            { id: 'chroma', label: 'Chroma' },
            { id: 'opaque', label: 'Opaque' },
          ],
        },
        { type: 'textinput', id: 'chroma_color', label: 'Chroma color (hex, chroma mode only)', default: '#00b140' },
      ],
      callback: async (event) => {
        const content = String(event.options['content'])
        const body: Record<string, unknown> = { bg: event.options['bg'] }
        if (event.options['bg'] === 'chroma') body['chromaColor'] = event.options['chroma_color']
        try {
          await gscPost(`/api/render/${content}/background`, body)
        } catch (err) {
          log('error', `Set render background failed: ${(err as Error).message}`)
        }
      },
    },

    // Kept for transcript/debug convenience: show current app mode in logs.
    log_status: {
      name: 'Log Current Status (debug)',
      options: [],
      callback: async () => {
        const app = getApp()
        log(
          'info',
          `mode=${app.currentMode ?? 'idle'} slide=${app.slides ? app.slides.slideIndex + 1 : '-'} l3=${app.l3?.activeCueName ?? '-'} still=${app.mediaLibrary?.activeItemName ?? '-'}`
        )
      },
    },
  }
}

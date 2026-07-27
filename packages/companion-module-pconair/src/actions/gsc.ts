import type { CompanionActionDefinition } from '@companion-module/base'
import { type ActionDeps, makeGscAction, parsed, parsedNum, parsedChoice } from './helpers.js'

/**
 * GSC-compat actions — IDs must match companion-module-gslide-opener exactly.
 * Unsupported ones hit the compat endpoints and surface the server's honest
 * 400, except notes scroll/zoom which now have native window-manager backing
 * and dispatch directly.
 */
export function buildGscActions(deps: ActionDeps): Record<string, CompanionActionDefinition> {
  const { dispatch } = deps
  const gscAction = makeGscAction(deps)

  const urlOption = (label = 'URL'): CompanionActionDefinition['options'] => [
    { id: 'url', type: 'textinput', label, default: '', required: true, useVariables: true },
  ]

  return {
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
      [{ id: 'slide', type: 'textinput', label: 'Slide Number', default: '1', required: true, useVariables: true }],
      async (e, c) => ({ slide: await parsedNum(c, e, 'slide', 1) })
    ),
    reload_presentation: gscAction('Reload Presentation', '/api/reload-presentation'),
    toggle_video: gscAction('Toggle Video Playback (not supported)', '/api/toggle-video'),
    open_speaker_notes: gscAction('Open Speaker Notes', '/api/open-speaker-notes'),
    close_speaker_notes: gscAction('Close Speaker Notes', '/api/close-speaker-notes'),
    scroll_notes_down: {
      name: 'Scroll Speaker Notes Down',
      options: [],
      callback: async () => dispatch('slides_notes_scroll_down', {}),
    },
    scroll_notes_up: {
      name: 'Scroll Speaker Notes Up',
      options: [],
      callback: async () => dispatch('slides_notes_scroll_up', {}),
    },
    zoom_in_notes: {
      name: 'Zoom In Speaker Notes',
      options: [],
      callback: async () => dispatch('slides_notes_zoom_in', {}),
    },
    zoom_out_notes: {
      name: 'Zoom Out Speaker Notes',
      options: [],
      callback: async () => dispatch('slides_notes_zoom_out', {}),
    },
    show_share_qr: gscAction(
      'Show Tunnel QR',
      '/api/show-tunnel-qr',
      [{ id: 'durationSec', type: 'textinput', label: 'Display Duration (seconds)', default: '20', required: true, useVariables: true }],
      async (e, c) => ({ duration: await parsedNum(c, e, 'durationSec', 20) })
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
          allowCustom: true,
          choices: [
            { id: 'enable', label: 'Enable' },
            { id: 'disable', label: 'Disable' },
          ],
        },
      ],
      async (e, c) => ({ enabled: (await parsedChoice(c, e, 'enabled', ['enable', 'disable'], 'enable')) === 'enable' })
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
          allowCustom: true,
          choices: [
            { id: 'hide', label: 'Full Notes' },
            { id: 'default', label: 'Google Default' },
          ],
        },
      ],
      async (e, c) => ({ notesLayout: await parsedChoice(c, e, 'layout', ['hide', 'default'], 'hide') })
    ),
    relaunch_speaker_notes: gscAction('Relaunch Speaker Notes (not supported)', '/api/relaunch-speaker-notes'),
    perfectcue_enable_all: gscAction('PerfectCue: Enable All Ports (not supported)', '/api/set-perfectcue-enabled', [], async () => ({ enabled: true })),
    perfectcue_disable_all: gscAction('PerfectCue: Disable All Ports (not supported)', '/api/set-perfectcue-enabled', [], async () => ({ enabled: false })),
    perfectcue_set_port_enabled: gscAction(
      'PerfectCue: Enable/Disable Port (not supported)',
      '/api/toggle-perfectcue-port',
      [
        { id: 'port', type: 'textinput', label: 'Port Number', default: '8899', useVariables: true },
        {
          id: 'enabled',
          type: 'dropdown',
          label: 'State',
          default: 'true',
          allowCustom: true,
          choices: [
            { id: 'true', label: 'Enable' },
            { id: 'false', label: 'Disable' },
          ],
        },
      ],
      async (e, c) => ({
        port: await parsedNum(c, e, 'port', 8899),
        enabled: (await parsedChoice(c, e, 'enabled', ['true', 'false'], 'true')) === 'true',
      })
    ),
  }
}

import { combineRgb, type CompanionFeedbackDefinition } from '@companion-module/base'
import type { PcoState } from './client.js'

export type GetAppState = () => Partial<PcoState>

/**
 * Feedbacks = original PConAir set + GSC module IDs preserved exactly
 * (presentation_open, notes_open, on_slide, is_first_slide, is_last_slide,
 * login_state, backup_controls_enabled, notes_layout_is) + deep v2 feedbacks
 * per content type. Be generous: every boolean state field gets a feedback.
 */
export function buildFeedbacks(getApp: GetAppState, isConnected: () => boolean): Record<string, CompanionFeedbackDefinition> {
  const white = combineRgb(255, 255, 255)
  const green = combineRgb(0, 200, 0)
  const blue = combineRgb(0, 150, 255)
  const orange = combineRgb(255, 150, 0)
  const red = combineRgb(200, 30, 30)
  const purple = combineRgb(120, 0, 180)
  const gold = combineRgb(200, 160, 0)
  const teal = combineRgb(0, 170, 160)

  function slidesReady() {
    const s = getApp().slides
    return s && !s.isLoading ? s : null
  }

  return {
    // ── connection / mode (v1 PConAir set) ──
    is_connected: {
      type: 'boolean',
      name: 'Is Connected',
      description: 'Green when connected to PConAir',
      defaultStyle: { bgcolor: green, color: white },
      options: [],
      callback: () => isConnected(),
    },

    is_mode: {
      type: 'boolean',
      name: 'Is Mode Active',
      description: 'Highlights when the specified mode is active',
      defaultStyle: { bgcolor: teal, color: white },
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
      callback: ({ options }) => (getApp().currentMode ?? 'idle') === options['mode'],
    },

    is_ab_instance: {
      type: 'boolean',
      name: 'Is A/B Instance Active',
      description: 'Highlights when the specified A/B instance is active',
      defaultStyle: { bgcolor: gold, color: white },
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
      callback: ({ options }) => (getApp().abState?.activeInstance ?? 'A') === options['instance'],
    },

    slide_at: {
      type: 'boolean',
      name: 'At Slide Number',
      description: 'Highlights when the current slide matches the configured number',
      defaultStyle: { bgcolor: green, color: white },
      options: [
        { type: 'number', id: 'slide_number', label: 'Slide Number (1-based)', default: 1, min: 1, max: 9999 },
      ],
      callback: ({ options }) => {
        const s = slidesReady()
        return s !== null && s.slideIndex + 1 === Number(options['slide_number'])
      },
    },

    // ── GSC compat feedback IDs (exact) ──
    presentation_open: {
      type: 'boolean',
      name: 'Presentation is Open',
      description: 'Indicates when a presentation is currently open',
      defaultStyle: { color: white, bgcolor: green },
      options: [],
      callback: () => getApp().slides != null,
      showInvert: true,
    },
    notes_open: {
      type: 'boolean',
      name: 'Speaker Notes are Open',
      description: 'Indicates when the speaker notes capture window is open',
      defaultStyle: { color: white, bgcolor: blue },
      options: [],
      callback: () => getApp().slides?.notesOpen === true,
      showInvert: true,
    },
    on_slide: {
      type: 'boolean',
      name: 'On Specific Slide',
      description: 'Indicates when the presentation is on a specific slide number',
      defaultStyle: { color: white, bgcolor: orange },
      options: [{ type: 'number', id: 'slide', label: 'Slide Number', min: 1, max: 9999, default: 1 }],
      callback: ({ options }) => {
        const s = slidesReady()
        return s !== null && s.slideIndex + 1 === Number(options['slide'])
      },
      showInvert: true,
    },
    is_first_slide: {
      type: 'boolean',
      name: 'Is First Slide',
      description: 'Indicates when the presentation is on the first slide',
      defaultStyle: { color: white, bgcolor: combineRgb(100, 200, 100) },
      options: [],
      callback: () => {
        const s = slidesReady()
        return s !== null && s.slideIndex === 0
      },
      showInvert: true,
    },
    is_last_slide: {
      type: 'boolean',
      name: 'Is Last Slide',
      description: 'Indicates when the presentation is on the last slide',
      defaultStyle: { color: white, bgcolor: combineRgb(200, 100, 100) },
      options: [],
      callback: () => {
        const s = slidesReady()
        return s !== null && s.slideCount > 0 && s.slideIndex === s.slideCount - 1
      },
      showInvert: true,
    },
    login_state: {
      type: 'boolean',
      name: 'Logged In to Google (GSC compat)',
      description: 'PConAir does not track Google login; never active',
      defaultStyle: { color: white, bgcolor: combineRgb(66, 133, 244) },
      options: [],
      callback: () => false,
      showInvert: true,
    },
    backup_controls_enabled: {
      type: 'boolean',
      name: 'Backup Controls Enabled (GSC compat)',
      description: 'PConAir does not support backup command forwarding; never active',
      defaultStyle: { color: white, bgcolor: combineRgb(100, 200, 0) },
      options: [],
      callback: () => false,
      showInvert: true,
    },
    notes_layout_is: {
      type: 'boolean',
      name: 'Notes Layout Is (GSC compat)',
      description: 'PConAir always uses the full-notes layout ("hide")',
      defaultStyle: { color: white, bgcolor: blue },
      options: [
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
      callback: ({ options }) => options['layout'] === 'hide',
    },

    // ── slides v2 ──
    deck_loaded: {
      type: 'boolean',
      name: 'Deck Loaded',
      description: 'Active when a slide deck is loaded',
      defaultStyle: { bgcolor: green, color: white },
      options: [],
      callback: () => getApp().slides != null,
      showInvert: true,
    },
    backup_loaded: {
      type: 'boolean',
      name: 'Backup Deck Loaded',
      description: 'Active when an A/B backup deck is preloaded',
      defaultStyle: { bgcolor: teal, color: white },
      options: [],
      callback: () => getApp().slides?.backupLoaded === true,
      showInvert: true,
    },
    offline_mode_active: {
      type: 'boolean',
      name: 'Offline Mode Active',
      description: 'Active when slides offline mode is enabled',
      defaultStyle: { bgcolor: orange, color: white },
      options: [],
      callback: () => getApp().slides?.offlineMode === true,
      showInvert: true,
    },

    // ── lower thirds ──
    l3_on_air: {
      type: 'boolean',
      name: 'Lower Third On Air',
      description: 'Active when any lower third cue is live',
      defaultStyle: { bgcolor: green, color: white },
      options: [],
      callback: () => Boolean(getApp().l3?.activeCueId),
      showInvert: true,
    },
    l3_cue_live: {
      type: 'boolean',
      name: 'Specific L3 Cue is Live',
      description: 'Active when the configured cue (ID or name) is on air',
      defaultStyle: { bgcolor: purple, color: white },
      options: [
        { type: 'textinput', id: 'cue', label: 'Cue ID or Name', default: '' },
      ],
      callback: ({ options }) => {
        const l3 = getApp().l3
        const cue = String(options['cue'] ?? '')
        return cue.length > 0 && (l3?.activeCueId === cue || l3?.activeCueName === cue)
      },
      showInvert: true,
    },
    l3_stacking_active: {
      type: 'boolean',
      name: 'Lower Third Stacking On',
      description: 'Active when lower third stacking mode is enabled',
      defaultStyle: { bgcolor: orange, color: white },
      options: [],
      callback: () => getApp().l3?.isStacking === true,
    },
    l3_has_active_cue: {
      type: 'boolean',
      name: 'Has Active Lower Third Cue',
      description: 'Active when any lower third cue is currently on-air',
      defaultStyle: { bgcolor: purple, color: white },
      options: [],
      callback: () => Boolean(getApp().l3?.activeCueId),
    },
    l3_playlist_active: {
      type: 'boolean',
      name: 'L3 Playlist Active',
      description: 'Active when a lower-third playlist is selected',
      defaultStyle: { bgcolor: teal, color: white },
      options: [],
      callback: () => Boolean(getApp().l3?.currentPlaylistId),
      showInvert: true,
    },

    // ── still store ──
    stills_on_air: {
      type: 'boolean',
      name: 'Still On Air',
      description: 'Active when a still-store image is live',
      defaultStyle: { bgcolor: green, color: white },
      options: [],
      callback: () => Boolean(getApp().mediaLibrary?.activeItemId),
      showInvert: true,
    },
    still_live: {
      type: 'boolean',
      name: 'Specific Still is Live',
      description: 'Active when the configured image (ID or name) is on air',
      defaultStyle: { bgcolor: purple, color: white },
      options: [
        { type: 'textinput', id: 'item', label: 'Image ID or Name', default: '' },
      ],
      callback: ({ options }) => {
        const ml = getApp().mediaLibrary
        const item = String(options['item'] ?? '')
        return item.length > 0 && (ml?.activeItemId === item || ml?.activeItemName === item)
      },
      showInvert: true,
    },
    slideshow_running: {
      type: 'boolean',
      name: 'Slideshow Running',
      description: 'Active while the still-store slideshow is running (and not paused)',
      defaultStyle: { bgcolor: green, color: white },
      options: [],
      callback: () => {
        const show = getApp().mediaLibrary?.slideshow
        return Boolean(show?.running && !show.paused)
      },
      showInvert: true,
    },
    slideshow_paused: {
      type: 'boolean',
      name: 'Slideshow Paused',
      description: 'Active while the slideshow is paused',
      defaultStyle: { bgcolor: orange, color: white },
      options: [],
      callback: () => Boolean(getApp().mediaLibrary?.slideshow?.paused),
      showInvert: true,
    },

    // ── tunnel / system ──
    tunnel_active: {
      type: 'boolean',
      name: 'Tunnel Active',
      description: 'Active when the Cloudflare tunnel is up',
      defaultStyle: { bgcolor: green, color: white },
      options: [],
      callback: () => getApp().tunnel?.status === 'active',
      showInvert: true,
    },
    tunnel_error: {
      type: 'boolean',
      name: 'Tunnel Error',
      description: 'Active when the tunnel reports an error',
      defaultStyle: { bgcolor: red, color: white },
      options: [],
      callback: () => getApp().tunnel?.status === 'error',
    },
    panic_active: {
      type: 'boolean',
      name: 'Panic Slate Active',
      description: 'Active while the panic slate covers the program output',
      defaultStyle: { bgcolor: red, color: white },
      options: [],
      callback: () => getApp().reliability?.panicActive === true,
    },
    show_locked: {
      type: 'boolean',
      name: 'Show Lock Active',
      description: 'Active while the admin show lock is engaged',
      defaultStyle: { bgcolor: red, color: white },
      options: [],
      callback: () => getApp().connectionStatus?.adminShowLocked === true,
    },

    // ── render outputs ──
    render_bg_is: {
      type: 'boolean',
      name: 'Render Background Mode Is',
      description: 'Active when a content type render page uses the selected background mode',
      defaultStyle: { bgcolor: teal, color: white },
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
            { id: 'black', label: 'Black' },
            { id: 'white', label: 'White' },
            { id: 'chroma', label: 'Chroma' },
            { id: 'opaque', label: 'Opaque' },
          ],
        },
      ],
      callback: ({ options }) => {
        const ro = getApp().renderOutputs ?? {}
        return ro[String(options['content'])]?.bg === options['bg']
      },
    },
  }
}

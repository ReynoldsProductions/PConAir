import type { CompanionVariableDefinition, CompanionVariableValues } from '@companion-module/base'
import type { PcoState } from './client.js'

/**
 * Variable set = GSC module names preserved exactly (current_slide,
 * slide_info, …) + the original PConAir names + new v2 content types
 * (L3 playlists, still store/slideshow, tunnel, render outputs).
 * Nothing is removed — existing Companion buttons keep working.
 */
export const VARIABLE_DEFINITIONS: CompanionVariableDefinition[] = [
  // ── connection ──
  { variableId: 'connected', name: 'Connected (1/0)' },
  { variableId: 'connection_status', name: 'Connection Status' },

  // ── PConAir core (v1 names preserved) ──
  { variableId: 'current_mode', name: 'Current Mode' },
  { variableId: 'current_url', name: 'Current URL' },
  { variableId: 'current_preset_name', name: 'Current Preset Name' },
  { variableId: 'slide_index', name: 'Current Slide Number (1-based)' },
  { variableId: 'slide_count', name: 'Total Slide Count' },
  { variableId: 'deck_title', name: 'Slide Deck Title' },
  { variableId: 'l3_active_cue', name: 'Active Lower Third Cue' },
  { variableId: 'l3_stacking', name: 'Lower Third Stacking (on/off)' },
  { variableId: 'ab_active_instance', name: 'Active A/B Instance' },

  // ── GSC compat (names must match companion-module-gslide-opener exactly) ──
  { variableId: 'presentation_open', name: 'Presentation Open' },
  { variableId: 'notes_open', name: 'Speaker Notes Open' },
  { variableId: 'current_slide', name: 'Current Slide Number' },
  { variableId: 'total_slides', name: 'Total Slides' },
  { variableId: 'slide_info', name: 'Slide Info (e.g. "3 / 10")' },
  { variableId: 'next_slide', name: 'Next Slide Number' },
  { variableId: 'previous_slide', name: 'Previous Slide Number' },
  { variableId: 'is_first_slide', name: 'Is First Slide' },
  { variableId: 'is_last_slide', name: 'Is Last Slide' },
  { variableId: 'presentation_url', name: 'Presentation URL' },
  { variableId: 'content_kind', name: 'Content Kind (slides / slido)' },
  { variableId: 'presentation_title', name: 'Presentation Title' },
  { variableId: 'timer_elapsed', name: 'Timer Elapsed (unsupported — blank)' },
  { variableId: 'presentation_display_id', name: 'Presentation Display ID' },
  { variableId: 'notes_display_id', name: 'Notes Display ID' },
  { variableId: 'login_state', name: 'Login State (Yes/No)' },
  { variableId: 'logged_in_user', name: 'Logged In User (Email)' },
  { variableId: 'backup_controls_enabled', name: 'Backup Controls Enabled (Yes/No)' },
  { variableId: 'notes_zoom_steps', name: 'Speaker Notes Zoom Steps' },
  { variableId: 'notes_zoom_default', name: 'Default Speaker Notes Zoom Steps' },
  { variableId: 'notes_layout', name: 'Notes Layout (hide / default)' },
  { variableId: 'perfectcue_enabled', name: 'PerfectCue Global Enabled (unsupported — 0)' },
  // GSC defined 10 PerfectCue port slots; kept (blank) so imported pages don't break.
  ...Array.from({ length: 10 }, (_, i) => [
    { variableId: `perfectcue_port_${i + 1}_port`, name: `PerfectCue Slot ${i + 1} Port (unsupported)` },
    { variableId: `perfectcue_port_${i + 1}_name`, name: `PerfectCue Slot ${i + 1} Name (unsupported)` },
    { variableId: `perfectcue_port_${i + 1}_enabled`, name: `PerfectCue Slot ${i + 1} Enabled (unsupported)` },
    { variableId: `perfectcue_port_${i + 1}_adapter`, name: `PerfectCue Slot ${i + 1} Adapter (unsupported)` },
  ]).flat(),

  // ── slides v2 ──
  { variableId: 'deck_loaded', name: 'Deck Loaded (Yes/No)' },
  { variableId: 'backup_loaded', name: 'Backup Deck Loaded (Yes/No)' },
  { variableId: 'backup_deck_url', name: 'Backup Deck URL' },
  { variableId: 'offline_mode', name: 'Offline Mode (Yes/No)' },
  { variableId: 'cache_warmed', name: 'Offline Cache Warmed (Yes/No)' },
  { variableId: 'speaker_notes', name: 'Current Speaker Notes Text' },

  // ── lower thirds v2 ──
  { variableId: 'l3_on_air', name: 'Lower Third On Air (Yes/No)' },
  { variableId: 'l3_active_cue_id', name: 'Active Lower Third Cue ID' },
  { variableId: 'l3_active_title', name: 'Active Lower Third Title Line' },
  { variableId: 'l3_active_theme', name: 'Active Lower Third Theme' },
  { variableId: 'l3_playlist_id', name: 'Active L3 Playlist ID' },
  { variableId: 'l3_playlist_position', name: 'L3 Playlist Position (1-based)' },
  { variableId: 'l3_playlist_length', name: 'L3 Playlist Length' },

  // ── still store ──
  { variableId: 'stills_on_air', name: 'Still On Air (Yes/No)' },
  { variableId: 'still_active_id', name: 'Active Still ID' },
  { variableId: 'still_active_name', name: 'Active Still Name' },
  { variableId: 'slideshow_running', name: 'Slideshow Running (Yes/No)' },
  { variableId: 'slideshow_paused', name: 'Slideshow Paused (Yes/No)' },
  { variableId: 'slideshow_position', name: 'Slideshow Position (1-based)' },
  { variableId: 'slideshow_length', name: 'Slideshow Length' },
  { variableId: 'slideshow_interval', name: 'Slideshow Interval (seconds)' },
  { variableId: 'slideshow_transition', name: 'Slideshow Transition (cut/fade)' },

  // ── tunnel / system ──
  { variableId: 'tunnel_status', name: 'Tunnel Status (inactive/starting/active/error)' },
  { variableId: 'tunnel_url', name: 'Tunnel Public URL' },
  { variableId: 'tunnel_pin_required', name: 'Tunnel PIN Required (Yes/No)' },
  { variableId: 'panic_active', name: 'Panic Slate Active (Yes/No)' },
  { variableId: 'show_locked', name: 'Show Lock Active (Yes/No)' },
  { variableId: 'ws_clients', name: 'Connected WebSocket Clients' },

  // ── render outputs (software path) ──
  { variableId: 'render_bg_slides', name: 'Slides Render Background Mode' },
  { variableId: 'render_bg_l3', name: 'L3 Render Background Mode' },
  { variableId: 'render_bg_stills', name: 'Stills Render Background Mode' },
  { variableId: 'render_bg_url', name: 'URL Render Background Mode' },
]

function yn(v: boolean | null | undefined): string {
  return v ? 'Yes' : 'No'
}

export function stateToVariables(state: Partial<PcoState>, connected: boolean): CompanionVariableValues {
  const slides = state.slides ?? null
  const ready = slides !== null && !slides.isLoading
  // GSC semantics: 1-based slide numbers, null → blank.
  const currentSlide = ready ? slides.slideIndex + 1 : null
  const totalSlides = ready ? slides.slideCount : null
  const l3 = state.l3 ?? null
  const ml = state.mediaLibrary ?? null
  const show = ml?.slideshow ?? null
  const tunnel = state.tunnel ?? null
  const ro = state.renderOutputs ?? {}

  return {
    connected: connected ? '1' : '0',
    connection_status: connected ? 'connected' : 'disconnected',

    current_mode: state.currentMode ?? 'idle',
    current_url: state.currentUrl ?? '',
    current_preset_name: state.currentPreset?.name ?? '',
    slide_index: currentSlide !== null ? String(currentSlide) : '',
    slide_count: totalSlides !== null ? String(totalSlides) : '',
    deck_title: slides?.deckTitle ?? '',
    l3_active_cue: l3?.activeCueName ?? '',
    l3_stacking: l3?.isStacking ? 'on' : 'off',
    ab_active_instance: state.abState?.activeInstance ?? 'A',

    presentation_open: slides !== null ? 'Yes' : 'No',
    notes_open: yn(slides?.notesOpen),
    current_slide: currentSlide !== null ? String(currentSlide) : '',
    total_slides: totalSlides !== null ? String(totalSlides) : '',
    slide_info: currentSlide !== null && totalSlides !== null ? `${currentSlide} / ${totalSlides}` : '',
    next_slide: currentSlide !== null && totalSlides !== null && currentSlide < totalSlides ? String(currentSlide + 1) : '',
    previous_slide: currentSlide !== null && currentSlide > 1 ? String(currentSlide - 1) : '',
    is_first_slide: yn(currentSlide !== null && currentSlide === 1),
    is_last_slide: yn(currentSlide !== null && totalSlides !== null && currentSlide === totalSlides),
    presentation_url: slides?.deckUrl ?? (state.currentMode === 'url' ? state.currentUrl ?? '' : ''),
    content_kind: state.currentMode === 'url' ? 'slido' : 'slides',
    presentation_title: slides?.deckTitle ?? '',
    timer_elapsed: '',
    presentation_display_id: '',
    notes_display_id: '',
    login_state: 'No',
    logged_in_user: '',
    backup_controls_enabled: 'No',
    notes_zoom_steps: '',
    notes_zoom_default: '',
    notes_layout: 'hide',
    perfectcue_enabled: '0',
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        [`perfectcue_port_${i + 1}_port`, ''],
        [`perfectcue_port_${i + 1}_name`, ''],
        [`perfectcue_port_${i + 1}_enabled`, ''],
        [`perfectcue_port_${i + 1}_adapter`, ''],
      ]).flat()
    ),

    deck_loaded: yn(slides !== null),
    backup_loaded: yn(slides?.backupLoaded),
    backup_deck_url: slides?.backupDeckUrl ?? '',
    offline_mode: yn(slides?.offlineMode),
    cache_warmed: yn(slides?.cacheWarmed),
    speaker_notes: slides?.notes ?? '',

    l3_on_air: yn(Boolean(l3?.activeCueId)),
    l3_active_cue_id: l3?.activeCueId ?? '',
    l3_active_title: l3?.activeTitle ?? '',
    l3_active_theme: l3?.activeTheme ?? '',
    l3_playlist_id: l3?.currentPlaylistId ?? '',
    l3_playlist_position: l3?.playlistPosition != null ? String(l3.playlistPosition) : '',
    l3_playlist_length: l3?.playlistLength != null ? String(l3.playlistLength) : '',

    stills_on_air: yn(Boolean(ml?.activeItemId)),
    still_active_id: ml?.activeItemId ?? '',
    still_active_name: ml?.activeItemName ?? '',
    slideshow_running: yn(show?.running),
    slideshow_paused: yn(show?.paused),
    slideshow_position: show ? String(show.position + 1) : '',
    slideshow_length: show ? String(show.itemIds.length) : '',
    slideshow_interval: show ? String(show.intervalSec) : '',
    slideshow_transition: show?.transition ?? '',

    tunnel_status: tunnel?.status ?? 'inactive',
    tunnel_url: tunnel?.url ?? '',
    tunnel_pin_required: yn(tunnel?.pinRequired),
    panic_active: yn(state.reliability?.panicActive),
    show_locked: yn(state.connectionStatus?.adminShowLocked),
    ws_clients: state.connectionStatus ? String(state.connectionStatus.webSocketClients) : '',

    render_bg_slides: ro.slides?.bg ?? '',
    render_bg_l3: ro.l3?.bg ?? '',
    render_bg_stills: ro.stills?.bg ?? '',
    render_bg_url: ro.url?.bg ?? '',
  }
}

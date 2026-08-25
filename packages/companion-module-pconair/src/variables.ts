import type { CompanionVariableDefinition, CompanionVariableValues } from '@companion-module/base'
import type { PcoState, Transport } from './client.js'

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
  { variableId: 'transport', name: 'Transport (ws / http / blank)' },

  // ── PConAir core (v1 names preserved) ──
  { variableId: 'current_mode', name: 'Current Mode' },
  { variableId: 'current_url', name: 'Current URL' },
  { variableId: 'current_preset_name', name: 'Current Preset Name' },
  { variableId: 'slide_index', name: 'Current Slide Number (1-based)' },
  { variableId: 'slide_count', name: 'Total Slide Count' },
  { variableId: 'deck_title', name: 'Slide Deck Title' },
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

  // ── stagetimer overlay ──
  { variableId: 'stagetimer_overlay_enabled', name: 'Stagetimer Overlay Showing (Yes/No)' },
  { variableId: 'stagetimer_overlay_position', name: 'Stagetimer Overlay Position' },
  { variableId: 'stagetimer_overlay_size', name: 'Stagetimer Overlay Size (% of display)' },
  { variableId: 'stagetimer_room_id', name: 'Stagetimer Room ID' },
  { variableId: 'stagetimer_configured', name: 'Stagetimer Configured (Yes/No)' },

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

  // ── prompter ──
  { variableId: 'prompter_enabled', name: 'Prompter Enabled (Yes/No)' },
  { variableId: 'prompter_scrolling', name: 'Prompter Scrolling (Yes/No)' },
  { variableId: 'prompter_speed', name: 'Prompter Scroll Speed' },
  { variableId: 'prompter_font_size', name: 'Prompter Font Size' },
  { variableId: 'prompter_script_loaded', name: 'Prompter Script Loaded (Yes/No)' },
  { variableId: 'prompter_mirrored', name: 'Prompter Mirrored (Yes/No)' },

  // ── graphics: scoreboard ──
  { variableId: 'score_team_a_name', name: 'Scoreboard Team A Name' },
  { variableId: 'score_team_b_name', name: 'Scoreboard Team B Name' },
  { variableId: 'score_a', name: 'Scoreboard Team A Score' },
  { variableId: 'score_b', name: 'Scoreboard Team B Score' },
  { variableId: 'score_quarter', name: 'Scoreboard Quarter/Period' },
  { variableId: 'game_clock', name: 'Scoreboard Game Clock' },
  { variableId: 'game_clock_running', name: 'Game Clock Running (Yes/No)' },
  { variableId: 'shot_clock', name: 'Scoreboard Shot Clock' },
  { variableId: 'shot_clock_running', name: 'Shot Clock Running (Yes/No)' },
  { variableId: 'possession', name: 'Possession (a/b or blank)' },
  { variableId: 'fouls_a', name: 'Scoreboard Team A Fouls' },
  { variableId: 'fouls_b', name: 'Scoreboard Team B Fouls' },
  { variableId: 'timeouts_a', name: 'Scoreboard Team A Timeouts' },
  { variableId: 'timeouts_b', name: 'Scoreboard Team B Timeouts' },

  // ── graphics: lower third overlay ──
  { variableId: 'gfx_l3_left_visible', name: 'Graphics Lower Third (Left) Visible (Yes/No)' },
  { variableId: 'gfx_l3_left_name', name: 'Graphics Lower Third (Left) Name Line' },
  { variableId: 'gfx_l3_left_title', name: 'Graphics Lower Third (Left) Title Line' },
  { variableId: 'gfx_l3_left_subtitle', name: 'Graphics Lower Third (Left) Subtitle Line' },
  { variableId: 'gfx_l3_left_theme', name: 'Graphics Lower Third (Left) Theme' },
  { variableId: 'gfx_l3_left_animation', name: 'Graphics Lower Third (Left) Animation Style' },
  { variableId: 'gfx_l3_right_visible', name: 'Graphics Lower Third (Right) Visible (Yes/No)' },
  { variableId: 'gfx_l3_right_name', name: 'Graphics Lower Third (Right) Name Line' },
  { variableId: 'gfx_l3_right_title', name: 'Graphics Lower Third (Right) Title Line' },
  { variableId: 'gfx_l3_right_subtitle', name: 'Graphics Lower Third (Right) Subtitle Line' },
  { variableId: 'gfx_l3_right_theme', name: 'Graphics Lower Third (Right) Theme' },
  { variableId: 'gfx_l3_right_animation', name: 'Graphics Lower Third (Right) Animation Style' },

  // ── watchdog / health ──
  { variableId: 'watchdog_unresponsive', name: 'Program Unresponsive (Yes/No)' },
  { variableId: 'watchdog_unresponsive_secs', name: 'Program Unresponsive Seconds' },
  { variableId: 'memory_pressure', name: 'Memory Pressure (Yes/No)' },
  { variableId: 'memory_pct', name: 'Memory Used (%)' },

  // ── background ──
  { variableId: 'background_type', name: 'Program Background Type' },
  { variableId: 'background_value', name: 'Program Background Value' },
  { variableId: 'background_preset_name', name: 'Program Background Preset Name' },

  // ── displays ──
  { variableId: 'display_count', name: 'Connected Display Count' },
  { variableId: 'display_primary_name', name: 'Primary Display Name' },
  { variableId: 'display_names', name: 'All Display Names (comma-separated)' },

  // ── misc v2 ──
  { variableId: 'current_preset_id', name: 'Current Preset ID' },
  { variableId: 'tunnel_enabled', name: 'Tunnel Enabled (Yes/No)' },
  { variableId: 'tunnel_last_error', name: 'Tunnel Last Error' },
  { variableId: 'slides_loading', name: 'Slides Loading (Yes/No)' },
  { variableId: 'content_kind_native', name: 'Slides Content Kind (slides/url/none)' },
  { variableId: 'instance_a_url', name: 'Instance A URL' },
  { variableId: 'instance_b_url', name: 'Instance B URL' },
  { variableId: 'instance_a_ready', name: 'Instance A Ready (Yes/No)' },
  { variableId: 'instance_b_ready', name: 'Instance B Ready (Yes/No)' },
]

function yn(v: boolean | null | undefined): string {
  return v ? 'Yes' : 'No'
}

export function stateToVariables(
  state: Partial<PcoState>,
  connected: boolean,
  transport: Transport = connected ? 'ws' : null
): CompanionVariableValues {
  const slides = state.slides ?? null
  const ready = slides !== null && !slides.isLoading
  // GSC semantics: 1-based slide numbers, null → blank.
  const currentSlide = ready ? slides.slideIndex + 1 : null
  const totalSlides = ready ? slides.slideCount : null
  const ml = state.mediaLibrary ?? null
  const show = ml?.slideshow ?? null
  const tunnel = state.tunnel ?? null
  const ro = state.renderOutputs ?? {}
  const tp = state.prompter ?? null
  const sb = state.graphics?.scoreboard ?? null
  const gl3Left = state.graphics?.lowerThirds?.left ?? null
  const gl3Right = state.graphics?.lowerThirds?.right ?? null
  const wd = state.watchdog ?? null
  const bg = state.background ?? null
  const displays = state.displays ?? null

  return {
    connected: connected ? '1' : '0',
    // 'http_fallback' is still controllable — just polled, and PIN-gated for actions.
    connection_status: transport === 'ws' ? 'connected' : transport === 'http' ? 'http_fallback' : 'disconnected',
    transport: transport ?? '',

    current_mode: state.currentMode ?? 'idle',
    current_url: state.currentUrl ?? '',
    current_preset_name: state.currentPreset?.name ?? '',
    slide_index: currentSlide !== null ? String(currentSlide) : '',
    slide_count: totalSlides !== null ? String(totalSlides) : '',
    deck_title: slides?.deckTitle ?? '',
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

    stills_on_air: yn(Boolean(ml?.activeItemId)),
    still_active_id: ml?.activeItemId ?? '',
    still_active_name: ml?.activeItemName ?? '',
    slideshow_running: yn(show?.running),
    slideshow_paused: yn(show?.paused),
    slideshow_position: show ? String(show.position + 1) : '',
    slideshow_length: show ? String(show.itemIds.length) : '',
    slideshow_interval: show ? String(show.intervalSec) : '',
    slideshow_transition: show?.transition ?? '',

    stagetimer_overlay_enabled: yn(state.stageTimer?.overlayEnabled),
    stagetimer_overlay_position: state.stageTimer?.overlayPosition ?? 'bottom-left',
    stagetimer_overlay_size: state.stageTimer ? String(state.stageTimer.overlaySize) : '',
    stagetimer_room_id: state.stageTimer?.roomId ?? '',
    stagetimer_configured: yn(state.stageTimer?.configured),

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

    prompter_enabled: yn(tp?.enabled),
    prompter_scrolling: yn(tp?.scrolling),
    prompter_speed: tp ? String(tp.speed) : '',
    prompter_font_size: tp ? String(tp.fontSize) : '',
    prompter_script_loaded: yn(Boolean(tp?.script)),
    prompter_mirrored: yn(Boolean(tp?.mirrorX || tp?.mirrorY)),

    score_team_a_name: sb?.teamA ?? '',
    score_team_b_name: sb?.teamB ?? '',
    score_a: sb ? String(sb.scoreA) : '',
    score_b: sb ? String(sb.scoreB) : '',
    score_quarter: sb?.quarter ?? '',
    game_clock: sb?.gameClock ?? '',
    game_clock_running: yn(sb?.gameClockRunning),
    shot_clock: sb ? String(sb.shotClock) : '',
    shot_clock_running: yn(sb?.shotClockRunning),
    possession: sb?.possession ?? '',
    fouls_a: sb ? String(sb.foulsA) : '',
    fouls_b: sb ? String(sb.foulsB) : '',
    timeouts_a: sb ? String(sb.timeoutsA) : '',
    timeouts_b: sb ? String(sb.timeoutsB) : '',

    gfx_l3_left_visible: yn(gl3Left?.visible),
    gfx_l3_left_name: gl3Left?.name ?? '',
    gfx_l3_left_title: gl3Left?.title ?? '',
    gfx_l3_left_subtitle: gl3Left?.subtitle ?? '',
    gfx_l3_left_theme: gl3Left?.theme ?? '',
    gfx_l3_left_animation: gl3Left?.animationStyle ?? '',
    gfx_l3_right_visible: yn(gl3Right?.visible),
    gfx_l3_right_name: gl3Right?.name ?? '',
    gfx_l3_right_title: gl3Right?.title ?? '',
    gfx_l3_right_subtitle: gl3Right?.subtitle ?? '',
    gfx_l3_right_theme: gl3Right?.theme ?? '',
    gfx_l3_right_animation: gl3Right?.animationStyle ?? '',

    watchdog_unresponsive: yn(wd?.programUnresponsive),
    watchdog_unresponsive_secs: wd ? String(wd.programUnresponsiveSecs) : '',
    memory_pressure: yn(wd?.memoryPressure),
    memory_pct: wd ? String(wd.memoryPressurePct) : '',

    background_type: bg?.type ?? '',
    background_value: bg?.value ?? '',
    background_preset_name: bg?.presetName ?? '',

    display_count: displays ? String(displays.length) : '',
    display_primary_name: displays?.find((d) => d.isPrimary)?.name ?? '',
    display_names: displays ? displays.map((d) => d.name).join(', ') : '',

    current_preset_id: state.currentPreset?.id ?? '',
    tunnel_enabled: yn(tunnel?.enabled),
    tunnel_last_error: tunnel?.lastError ?? '',
    slides_loading: yn(slides?.isLoading),
    content_kind_native: slides?.contentKind ?? 'none',
    instance_a_url: state.abState?.instanceA?.url ?? '',
    instance_b_url: state.abState?.instanceB?.url ?? '',
    instance_a_ready: yn(state.abState?.instanceA?.isReady),
    instance_b_ready: yn(state.abState?.instanceB?.isReady),
  }
}

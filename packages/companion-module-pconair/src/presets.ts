import { combineRgb, type CompanionPresetDefinition } from '@companion-module/base'

export function buildPresets(): Record<string, CompanionPresetDefinition> {
  const gray = combineRgb(80, 80, 80)
  const white = combineRgb(255, 255, 255)
  const cyan = combineRgb(0, 180, 200)
  const blue = combineRgb(100, 150, 255)
  const gold = combineRgb(200, 160, 0)
  const red = combineRgb(200, 0, 0)
  const orange = combineRgb(200, 100, 0)
  const purple = combineRgb(120, 0, 180)

  return {
    // 7.1 Slide navigation
    slides_next: {
      type: 'button',
      category: 'Slides',
      name: 'Next Slide',
      style: { text: 'Next ›', size: '18', color: white, bgcolor: blue },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'slides_next', options: {} }], up: [] }],
    },

    slides_prev: {
      type: 'button',
      category: 'Slides',
      name: 'Previous Slide',
      style: { text: '‹ Prev', size: '18', color: white, bgcolor: blue },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'slides_prev', options: {} }], up: [] }],
    },

    slide_counter: {
      type: 'button',
      category: 'Slides',
      name: 'Slide Counter',
      style: {
        text: '$(pconair:slide_index)\n/\n$(pconair:slide_count)',
        size: '14',
        color: white,
        bgcolor: gray,
      },
      feedbacks: [],
      steps: [{ down: [], up: [] }],
    },

    // 7.2 Deck loading
    load_deck_1: {
      type: 'button',
      category: 'Slides',
      name: 'Load Deck (Slot 1)',
      style: { text: 'Deck 1', size: '18', color: white, bgcolor: cyan },
      feedbacks: [],
      steps: [
        {
          down: [{ actionId: 'slides_load', options: { deck_url: '', instance: 'active' } }],
          up: [],
        },
      ],
    },

    load_deck_2: {
      type: 'button',
      category: 'Slides',
      name: 'Load Deck (Slot 2)',
      style: { text: 'Deck 2', size: '18', color: white, bgcolor: cyan },
      feedbacks: [],
      steps: [
        {
          down: [{ actionId: 'slides_load', options: { deck_url: '', instance: 'active' } }],
          up: [],
        },
      ],
    },

    load_deck_3: {
      type: 'button',
      category: 'Slides',
      name: 'Load Deck (Slot 3)',
      style: { text: 'Deck 3', size: '18', color: white, bgcolor: cyan },
      feedbacks: [],
      steps: [
        {
          down: [{ actionId: 'slides_load', options: { deck_url: '', instance: 'active' } }],
          up: [],
        },
      ],
    },

    // 7.3 A/B switching
    ab_switch: {
      type: 'button',
      category: 'A/B',
      name: 'Switch A/B Instance',
      style: { text: '$(pconair:ab_active_instance)', size: '24', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'is_ab_instance', options: { instance: 'A' }, style: { bgcolor: gold } }],
      steps: [{ down: [{ actionId: 'ab_switch', options: {} }], up: [] }],
    },

    instance_a: {
      type: 'button',
      category: 'A/B',
      name: 'Instance A',
      style: { text: 'Instance A', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'is_ab_instance', options: { instance: 'A' }, style: { bgcolor: gold } }],
      steps: [{ down: [{ actionId: 'url_switch_to', options: { instance: 'A' } }], up: [] }],
    },

    instance_b: {
      type: 'button',
      category: 'A/B',
      name: 'Instance B',
      style: { text: 'Instance B', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'is_ab_instance', options: { instance: 'B' }, style: { bgcolor: gold } }],
      steps: [{ down: [{ actionId: 'url_switch_to', options: { instance: 'B' } }], up: [] }],
    },

    // 7.4 Mode switching
    mode_slides: {
      type: 'button',
      category: 'Mode',
      name: 'Mode – Slides',
      style: { text: 'SLIDES', size: '18', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'is_mode', options: { mode: 'slides' }, style: { bgcolor: cyan } }],
      steps: [{ down: [{ actionId: 'set_mode', options: { mode: 'slides' } }], up: [] }],
    },

    mode_url: {
      type: 'button',
      category: 'Mode',
      name: 'Mode – URL',
      style: { text: 'URL', size: '18', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'is_mode', options: { mode: 'url' }, style: { bgcolor: cyan } }],
      steps: [{ down: [{ actionId: 'set_mode', options: { mode: 'url' } }], up: [] }],
    },

    mode_idle: {
      type: 'button',
      category: 'Mode',
      name: 'Mode – Idle',
      style: { text: 'IDLE', size: '18', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'is_mode', options: { mode: 'idle' }, style: { bgcolor: cyan } }],
      steps: [{ down: [{ actionId: 'set_mode', options: { mode: 'idle' } }], up: [] }],
    },

    // 7.6 Status
    connection_status: {
      type: 'button',
      category: 'Status',
      name: 'Connection Status',
      style: { text: '$(pconair:connection_status)', size: '14', color: white, bgcolor: red },
      feedbacks: [
        { feedbackId: 'is_connected', options: {}, style: { bgcolor: combineRgb(0, 180, 0) } },
      ],
      steps: [{ down: [], up: [] }],
    },

    current_mode_display: {
      type: 'button',
      category: 'Status',
      name: 'Current Mode Display',
      style: { text: '$(pconair:current_mode)', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [], up: [] }],
    },


    // 7.8 Still store
    stills_clear: {
      type: 'button',
      category: 'Still Store',
      name: 'Clear Still',
      style: { text: 'Clear\nStill', size: '14', color: white, bgcolor: red },
      feedbacks: [{ feedbackId: 'stills_on_air', options: {}, style: { bgcolor: combineRgb(0, 180, 0) } }],
      steps: [{ down: [{ actionId: 'stills_clear', options: {} }], up: [] }],
    },
    slideshow_play: {
      type: 'button',
      category: 'Still Store',
      name: 'Slideshow Play',
      style: { text: '▶ Show', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'slideshow_running', options: {}, style: { bgcolor: combineRgb(0, 180, 0) } }],
      steps: [{ down: [{ actionId: 'stills_slideshow_play', options: { item_ids: '', interval_sec: '5', transition: 'cut' } }], up: [] }],
    },
    slideshow_pause: {
      type: 'button',
      category: 'Still Store',
      name: 'Slideshow Pause',
      style: { text: '⏸', size: '18', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'slideshow_paused', options: {}, style: { bgcolor: orange } }],
      steps: [{ down: [{ actionId: 'stills_slideshow_pause', options: {} }], up: [] }],
    },
    slideshow_stop: {
      type: 'button',
      category: 'Still Store',
      name: 'Slideshow Stop',
      style: { text: '⏹', size: '18', color: white, bgcolor: red },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'stills_slideshow_stop', options: {} }], up: [] }],
    },

    // 7.9 Tunnel / QR
    show_qr: {
      type: 'button',
      category: 'Tunnel',
      name: 'Show Tunnel QR',
      style: { text: 'QR', size: '18', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'tunnel_active', options: {}, style: { bgcolor: combineRgb(0, 180, 0) } }],
      steps: [{ down: [{ actionId: 'show_share_qr', options: { durationSec: '20' } }], up: [] }],
    },
    tunnel_status: {
      type: 'button',
      category: 'Tunnel',
      name: 'Tunnel Status',
      style: { text: '$(pconair:tunnel_status)', size: '14', color: white, bgcolor: gray },
      feedbacks: [
        { feedbackId: 'tunnel_active', options: {}, style: { bgcolor: combineRgb(0, 180, 0) } },
        { feedbackId: 'tunnel_error', options: {}, style: { bgcolor: red } },
      ],
      steps: [{ down: [], up: [] }],
    },

    // 7.10 Stagetimer overlay
    stagetimer_overlay: {
      type: 'button',
      category: 'Status',
      name: 'Toggle Stagetimer Overlay',
      style: { text: 'Stage\nTimer', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'stagetimer_overlay_active', options: {}, style: { bgcolor: combineRgb(0, 180, 0) } }],
      steps: [{ down: [{ actionId: 'stagetimer_overlay_toggle', options: {} }], up: [] }],
    },

    // 7.11 Offline mode
    offline_toggle: {
      type: 'button',
      category: 'Slides',
      name: 'Toggle Offline Mode',
      style: { text: 'Offline\nMode', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'offline_mode_active', options: {}, style: { bgcolor: orange } }],
      steps: [{ down: [{ actionId: 'toggle_offline_mode', options: {} }], up: [] }],
    },

    // 7.12 Speaker notes
    notes_scroll_up: {
      type: 'button',
      category: 'Slides',
      name: 'Notes Scroll Up',
      style: { text: 'Notes ▲', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'slides_notes_scroll_up', options: {} }], up: [] }],
    },
    notes_scroll_down: {
      type: 'button',
      category: 'Slides',
      name: 'Notes Scroll Down',
      style: { text: 'Notes ▼', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'slides_notes_scroll_down', options: {} }], up: [] }],
    },
    notes_zoom_in: {
      type: 'button',
      category: 'Slides',
      name: 'Notes Zoom In',
      style: { text: 'Notes +', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'slides_notes_zoom_in', options: {} }], up: [] }],
    },
    notes_zoom_out: {
      type: 'button',
      category: 'Slides',
      name: 'Notes Zoom Out',
      style: { text: 'Notes −', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'slides_notes_zoom_out', options: {} }], up: [] }],
    },

    // 7.13 Graphics: scoreboard
    score_bump_a1: {
      type: 'button',
      category: 'Graphics',
      name: 'Team A +1',
      style: { text: 'A +1', size: '18', color: white, bgcolor: blue },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'graphics_score_bump', options: { team: 'a', delta: '1' } }], up: [] }],
    },
    score_bump_a2: {
      type: 'button',
      category: 'Graphics',
      name: 'Team A +2',
      style: { text: 'A +2', size: '18', color: white, bgcolor: blue },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'graphics_score_bump', options: { team: 'a', delta: '2' } }], up: [] }],
    },
    score_bump_a3: {
      type: 'button',
      category: 'Graphics',
      name: 'Team A +3',
      style: { text: 'A +3', size: '18', color: white, bgcolor: blue },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'graphics_score_bump', options: { team: 'a', delta: '3' } }], up: [] }],
    },
    score_bump_b1: {
      type: 'button',
      category: 'Graphics',
      name: 'Team B +1',
      style: { text: 'B +1', size: '18', color: white, bgcolor: purple },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'graphics_score_bump', options: { team: 'b', delta: '1' } }], up: [] }],
    },
    score_bump_b2: {
      type: 'button',
      category: 'Graphics',
      name: 'Team B +2',
      style: { text: 'B +2', size: '18', color: white, bgcolor: purple },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'graphics_score_bump', options: { team: 'b', delta: '2' } }], up: [] }],
    },
    score_bump_b3: {
      type: 'button',
      category: 'Graphics',
      name: 'Team B +3',
      style: { text: 'B +3', size: '18', color: white, bgcolor: purple },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'graphics_score_bump', options: { team: 'b', delta: '3' } }], up: [] }],
    },
    scoreboard_display: {
      type: 'button',
      category: 'Graphics',
      name: 'Scoreboard Display',
      style: {
        text: '$(pconair:score_team_a_name) $(pconair:score_a)\n$(pconair:score_team_b_name) $(pconair:score_b)',
        size: '14',
        color: white,
        bgcolor: gray,
      },
      feedbacks: [],
      steps: [{ down: [], up: [] }],
    },
    game_clock_toggle: {
      type: 'button',
      category: 'Graphics',
      name: 'Game Clock Start',
      style: { text: '$(pconair:game_clock)', size: '18', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'game_clock_running', options: {}, style: { bgcolor: combineRgb(0, 180, 0) } }],
      steps: [{ down: [{ actionId: 'graphics_clock_start', options: {} }], up: [] }],
    },
    game_clock_stop: {
      type: 'button',
      category: 'Graphics',
      name: 'Game Clock Stop',
      style: { text: 'Clock\nStop', size: '14', color: white, bgcolor: red },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'graphics_clock_stop', options: {} }], up: [] }],
    },
    possession_a: {
      type: 'button',
      category: 'Graphics',
      name: 'Possession A',
      style: { text: 'Poss A', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'possession_is', options: { team: 'a' }, style: { bgcolor: gold } }],
      steps: [{ down: [{ actionId: 'graphics_possession_set', options: { possession: 'a' } }], up: [] }],
    },
    possession_b: {
      type: 'button',
      category: 'Graphics',
      name: 'Possession B',
      style: { text: 'Poss B', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'possession_is', options: { team: 'b' }, style: { bgcolor: gold } }],
      steps: [{ down: [{ actionId: 'graphics_possession_set', options: { possession: 'b' } }], up: [] }],
    },

    // 7.14 Graphics: lower thirds (left/right independent)
    gfx_l3_left_apply: {
      type: 'button',
      category: 'Graphics',
      name: 'Apply Graphics Lower Third (Left)',
      style: { text: 'GFX L3\nLeft Take', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'gfx_lower_third_visible', options: { side: 'left' }, style: { bgcolor: combineRgb(0, 180, 0) } }],
      steps: [
        {
          down: [
            {
              actionId: 'lower_third_apply',
              options: {
                side: 'left', cue_id: '', name: '', title: '',
                subtitle_mode: 'keep', subtitle: '',
                theme: 'keep', animation: 'keep', fade_enabled: 'keep', fade_ms: '',
                logo_mode: 'keep', logo_asset_id: '',
              },
            },
          ],
          up: [],
        },
      ],
    },
    gfx_l3_left_hide: {
      type: 'button',
      category: 'Graphics',
      name: 'Hide Graphics Lower Third (Left)',
      style: { text: 'GFX L3\nLeft Clear', size: '14', color: white, bgcolor: red },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'lower_third_hide', options: { side: 'left' } }], up: [] }],
    },
    gfx_l3_right_apply: {
      type: 'button',
      category: 'Graphics',
      name: 'Apply Graphics Lower Third (Right)',
      style: { text: 'GFX L3\nRight Take', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'gfx_lower_third_visible', options: { side: 'right' }, style: { bgcolor: combineRgb(0, 180, 0) } }],
      steps: [
        {
          down: [
            {
              actionId: 'lower_third_apply',
              options: {
                side: 'right', cue_id: '', name: '', title: '',
                subtitle_mode: 'keep', subtitle: '',
                theme: 'keep', animation: 'keep', fade_enabled: 'keep', fade_ms: '',
                logo_mode: 'keep', logo_asset_id: '',
              },
            },
          ],
          up: [],
        },
      ],
    },
    gfx_l3_right_hide: {
      type: 'button',
      category: 'Graphics',
      name: 'Hide Graphics Lower Third (Right)',
      style: { text: 'GFX L3\nRight Clear', size: '14', color: white, bgcolor: red },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'lower_third_hide', options: { side: 'right' } }], up: [] }],
    },

    // 7.15 Prompter
    prompter_toggle: {
      type: 'button',
      category: 'Prompter',
      name: 'Prompter Start/Stop',
      style: { text: 'Prompter\n▶/⏸', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'prompter_scrolling', options: {}, style: { bgcolor: combineRgb(0, 180, 0) } }],
      steps: [{ down: [{ actionId: 'prompter_toggle', options: {} }], up: [] }],
    },
    prompter_rewind: {
      type: 'button',
      category: 'Prompter',
      name: 'Rewind to Top',
      style: { text: 'Prompter\n⏮ Top', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'prompter_rewind', options: {} }], up: [] }],
    },
    prompter_faster: {
      type: 'button',
      category: 'Prompter',
      name: 'Scroll Faster',
      style: { text: 'Speed +\n$(pconair:prompter_speed)', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'prompter_scroll_faster', options: {} }], up: [] }],
    },
    prompter_slower: {
      type: 'button',
      category: 'Prompter',
      name: 'Scroll Slower',
      style: { text: 'Speed −\n$(pconair:prompter_speed)', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'prompter_scroll_slower', options: {} }], up: [] }],
    },
    prompter_font_up: {
      type: 'button',
      category: 'Prompter',
      name: 'Font Size +',
      style: { text: 'Font +\n$(pconair:prompter_font_size)', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'prompter_font_size_in', options: {} }], up: [] }],
    },
    prompter_font_down: {
      type: 'button',
      category: 'Prompter',
      name: 'Font Size −',
      style: { text: 'Font −\n$(pconair:prompter_font_size)', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'prompter_font_size_out', options: {} }], up: [] }],
    },

    // 7.16 Reliability / system
    panic_toggle: {
      type: 'button',
      category: 'System',
      name: 'Panic Slate Toggle',
      style: { text: 'PANIC', size: '18', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'panic_active', options: {}, style: { bgcolor: red } }],
      steps: [{ down: [{ actionId: 'panic_toggle', options: {} }], up: [] }],
    },
    reload_offair: {
      type: 'button',
      category: 'System',
      name: 'Reload Off-Air Instance',
      style: { text: 'Reload\nOff-Air', size: '14', color: white, bgcolor: gray },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'reload_instance', options: { instance: 'B' } }], up: [] }],
    },
    health_tile: {
      type: 'button',
      category: 'System',
      name: 'Health Tile',
      style: { text: 'MEM $(pconair:memory_pct)%', size: '14', color: white, bgcolor: gray },
      feedbacks: [
        { feedbackId: 'memory_pressure', options: {}, style: { bgcolor: red } },
        { feedbackId: 'watchdog_unresponsive', options: {}, style: { bgcolor: red, text: 'FROZEN' } },
      ],
      steps: [{ down: [], up: [] }],
    },
  }
}

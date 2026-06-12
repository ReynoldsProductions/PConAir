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

    mode_l3: {
      type: 'button',
      category: 'Mode',
      name: 'Mode – Lower Third',
      style: { text: 'L3', size: '18', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'is_mode', options: { mode: 'l3' }, style: { bgcolor: cyan } }],
      steps: [{ down: [{ actionId: 'set_mode', options: { mode: 'l3' } }], up: [] }],
    },

    mode_idle: {
      type: 'button',
      category: 'Mode',
      name: 'Mode – Idle',
      style: { text: 'IDLE', size: '18', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'is_mode', options: { mode: 'idle' }, style: { bgcolor: cyan } }],
      steps: [{ down: [{ actionId: 'set_mode', options: { mode: 'idle' } }], up: [] }],
    },

    // 7.5 Lower thirds
    l3_take_1: {
      type: 'button',
      category: 'Lower Thirds',
      name: 'Take Lower Third (Slot 1)',
      style: { text: 'Speaker 1', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'l3_has_active_cue', options: {}, style: { bgcolor: purple } }],
      steps: [
        {
          down: [{ actionId: 'l3_take', options: { cue_id: '', name: '', title: '', theme: '' } }],
          up: [],
        },
      ],
    },

    l3_take_2: {
      type: 'button',
      category: 'Lower Thirds',
      name: 'Take Lower Third (Slot 2)',
      style: { text: 'Speaker 2', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'l3_has_active_cue', options: {}, style: { bgcolor: purple } }],
      steps: [
        {
          down: [{ actionId: 'l3_take', options: { cue_id: '', name: '', title: '', theme: '' } }],
          up: [],
        },
      ],
    },

    l3_clear: {
      type: 'button',
      category: 'Lower Thirds',
      name: 'Clear Lower Third',
      style: { text: 'Clear L3', size: '14', color: white, bgcolor: red },
      feedbacks: [],
      steps: [{ down: [{ actionId: 'l3_clear', options: {} }], up: [] }],
    },

    stacking_on: {
      type: 'button',
      category: 'Lower Thirds',
      name: 'Stacking On',
      style: { text: 'Stacking\nON', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'l3_stacking_active', options: {}, style: { bgcolor: orange } }],
      steps: [{ down: [{ actionId: 'l3_stacking_on', options: {} }], up: [] }],
    },

    stacking_off: {
      type: 'button',
      category: 'Lower Thirds',
      name: 'Stacking Off',
      style: { text: 'Stacking\nOFF', size: '14', color: white, bgcolor: orange },
      feedbacks: [{ feedbackId: 'l3_stacking_active', options: {}, style: { bgcolor: gray } }],
      steps: [{ down: [{ actionId: 'l3_stacking_off', options: {} }], up: [] }],
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

    // 7.7 L3 playlists
    l3_playlist_next: {
      type: 'button',
      category: 'Lower Thirds',
      name: 'Playlist Next',
      style: { text: 'L3 ›\n$(pconair:l3_playlist_position)/$(pconair:l3_playlist_length)', size: '14', color: white, bgcolor: blue },
      feedbacks: [{ feedbackId: 'l3_on_air', options: {}, style: { bgcolor: combineRgb(0, 180, 0) } }],
      steps: [{ down: [{ actionId: 'l3_next', options: {} }], up: [] }],
    },
    l3_playlist_prev: {
      type: 'button',
      category: 'Lower Thirds',
      name: 'Playlist Previous',
      style: { text: '‹ L3', size: '14', color: white, bgcolor: blue },
      feedbacks: [{ feedbackId: 'l3_on_air', options: {}, style: { bgcolor: combineRgb(0, 180, 0) } }],
      steps: [{ down: [{ actionId: 'l3_prev', options: {} }], up: [] }],
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
      steps: [{ down: [{ actionId: 'stills_slideshow_play', options: { item_ids: '', interval_sec: 5, transition: 'cut' } }], up: [] }],
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
      steps: [{ down: [{ actionId: 'show_share_qr', options: { durationSec: 20 } }], up: [] }],
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

    // 7.10 Offline mode
    offline_toggle: {
      type: 'button',
      category: 'Slides',
      name: 'Toggle Offline Mode',
      style: { text: 'Offline\nMode', size: '14', color: white, bgcolor: gray },
      feedbacks: [{ feedbackId: 'offline_mode_active', options: {}, style: { bgcolor: orange } }],
      steps: [{ down: [{ actionId: 'toggle_offline_mode', options: {} }], up: [] }],
    },
  }
}

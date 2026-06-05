# PC On Air — Built-in Graphics Templates

Self-contained 1920×1080 **transparent** HTML graphics, designed to be played out by PC On Air (URL mode for full-frame graphics, L3 mode for the lower-third) and keyed over camera/program downstream.

Each template is a single `index.html` with no build step. Dynamic content is driven by **URL query params** today; the plan (see [`../specs/13-graphics-templates.md`](../specs/13-graphics-templates.md)) describes moving live data onto PC On Air's WebSocket state + Companion.

| Folder | Template | Mode | Key params |
|---|---|---|---|
| `news/` | Faire Nightly News — lower-third + live clock + "Faire Wire" ticker | URL (or L3 for the bar alone) | `name,title,theme,label` |
| `quarterly/` | Faire Quarterly — editorial magazine-cover frame, camera as cover portrait | URL | `name,role,headline,kicker,issue,ed` |
| `tactical-hud/` | ORBITAL — sci-fi tactical HUD (mission clock, radar, waveform, target lock, glitch) | URL | `brand,grade=thermal` |
| `scoreboard-basketball/` | COURTVISION — NBA-style scorebug (game + shot clock, scores, fouls, possession, player card, ticker) | URL | `a,b,sa,sb,q,clock,shot,poss,fA,fB,toA,toB,card` |

> Transparent backgrounds: PC On Air outputs these with luma key / solid background for downstream keying. Built in `obs-mcp` via the OBS MCP; this is now their canonical home.

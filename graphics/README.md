# PC On Air — Built-in Graphics Templates

Self-contained 1920×1080 **transparent** HTML graphics, designed to be played out by PC On Air (URL mode for full-frame graphics, L3 mode for the lower-third) and keyed over camera/program downstream.

Each template is a single `index.html` with no build step. Dynamic content is driven by **URL query params** today; the plan (see [`../specs/13-graphics-templates.md`](../specs/13-graphics-templates.md)) describes moving live data onto PC On Air's WebSocket state + Companion.

| Folder | Template | Mode | Key params |
|---|---|---|---|
| `news/` | Faire Wire — headline ticker with the Faire logo bug | URL | `ticker,speed,logo` |
| `lower-third-left/` | Lower third, left-hand card; auto-animates on → holds → off | URL | `name,title,subtitle,theme,delay,in,hold,out,w,bottom` |
| `lower-third-right/` | Same, mirrored to the right — stack both to title two speakers | URL | *(as above)* |
| `quarterly/` | Faire Quarterly — editorial magazine-cover frame, camera as cover portrait | URL | `name,role,headline,kicker,issue,ed` |
| `tactical-hud/` | ORBITAL — sci-fi tactical HUD (mission clock, radar, waveform, target lock, glitch) | URL | `brand,grade=thermal` |
| `scoreboard-basketball/` | COURTVISION — NBA-style scorebug (game + shot clock, scores, fouls, possession, player card, ticker) | URL | `a,b,sa,sb,q,clock,shot,poss,fA,fB,toA,toB,card` |

> Transparent backgrounds: PC On Air outputs these with luma key / solid background for downstream keying. Built in `obs-mcp` via the OBS MCP; this is now their canonical home.

## Scenes that stack

`news/` (ticker + logo bug) and the two lower thirds are separate scenes on purpose, so the
ticker can sit up persistently while the name cards come and go. Layer them in this order:

```
lower-third-left/  ·  lower-third-right/     ← non-persistent, self-animating
news/                                        ← persistent ticker bar (96px, bottom)
camera / recorded spot
```

The L3 pages default to `bottom=124` so they clear the 96px ticker bar. Running an L3 without
the ticker under it? Pass `bottom=96` to drop it to the standard margin.

### Editing the ticker

Edit the `items` array in [`news/ticker.json`](news/ticker.json) and reload the graphic — no
restart needed. Wrap a lead-in phrase in `**double asterisks**` to render it in the tan accent
colour. `speed` is how many seconds one full run takes to cross (bigger = slower).

For a one-off launch you can skip the file and pass headlines inline instead, pipe-separated:

```
/graphics/news/index.html?ticker=**New**+perks+are+live|Toronto+sets+a+record&speed=30
```

> In a packaged build `ticker.json` lives inside the app bundle
> (`PConAir.app/Contents/Resources/graphics/news/ticker.json`), which is awkward to edit — use
> the `?ticker=` param on the preset URL there.

### Lower-third timing

The card plays itself once on load: `delay` → animate in (`in`) → `hold` → animate out (`out`).
All four are **seconds** (suffix `ms` for milliseconds), defaulting to `0.4 / 0.55 / 6 / 0.4`.
Pass `hold=inf` to keep it up until dismissed. While the page has focus, `R` replays and `H`
hides; `window.l3.play()` / `.hide()` / `.set({…})` do the same from script.

Long names shrink to fit (52px down to 34px) before ellipsis kicks in; the panel hugs its text
between 400px and `w` (default 780px), so a left and a right card can never collide.

# PC On Air — Built-in Graphics Templates

Self-contained 1920×1080 **transparent** HTML graphics, designed to be played out by PC On Air (URL mode for full-frame graphics, L3 mode for the lower-third) and keyed over camera/program downstream.

Each template is a single `index.html` with no build step. Dynamic content is driven by **URL query params** today; the plan (see [`../specs/13-graphics-templates.md`](../specs/13-graphics-templates.md)) describes moving live data onto PC On Air's WebSocket state + Companion.

| Folder | Template | Mode | Key params |
|---|---|---|---|
| `news/` | Faire Wire — headline ticker with the Faire logo bug | URL | `ticker,speed,logo` |
| `lower-third-left/` | Lower third, left-hand card; auto-animates on → holds → off | URL | `name,title,subtitle,theme,delay,in,hold,out,w,bottom` |
| `lower-third-right/` | Same, mirrored to the right | URL | *(as above)* |
| `lower-third-duo/` | **Both cards in one output** — title two speakers from a single URL | URL | *(as above, with `L`/`R` suffixes)* |
| `quarterly/` | Faire Quarterly — editorial magazine-cover frame, camera as cover portrait | URL | `name,role,headline,kicker,issue,ed` |
| `tactical-hud/` | ORBITAL — sci-fi tactical HUD (mission clock, radar, waveform, target lock, glitch) | URL | `brand,grade=thermal` |
| `scoreboard-basketball/` | COURTVISION — NBA-style scorebug (game + shot clock, scores, fouls, possession, player card, ticker) | URL | `a,b,sa,sb,q,clock,shot,poss,fA,fB,toA,toB,card` |

> Transparent backgrounds: PC On Air outputs these with luma key / solid background for downstream keying. Built in `obs-mcp` via the OBS MCP; this is now their canonical home.

## Scenes that stack

`news/` (ticker + logo bug) and the lower thirds are separate scenes on purpose, so the ticker
can sit up persistently while the name cards come and go. Layer them in this order:

```
lower-third-duo/   (or left/ + right/)       ← non-persistent, self-animating
news/                                        ← persistent ticker bar (96px, bottom)
camera / recorded spot
```

The L3 pages default to `bottom=124` so they clear the 96px ticker bar. Running an L3 without
the ticker under it? Pass `bottom=96` to drop it to the standard margin.

### Titling two speakers at once

Which page you want depends on how many outputs your playout gives you:

- **One URL per output** (PC On Air URL mode) → use **`lower-third-duo/`**. One page, both
  cards. Params take an `L` or `R` suffix; unsuffixed timings apply to both, so `?hold=8` pins
  both and `?delayR=1.6` staggers the right-hand card in after the left:

  ```
  /graphics/lower-third-duo/index.html?nameL=Jane+Smith&titleL=Chief+Executive+Officer&nameR=Alex+Chen&titleR=Head+of+Supply&delayR=1.6
  ```

  A card with no `name`/`title`/`subtitle` param at all is hidden, so this page also handles a
  single speaker — no need to switch templates.

- **Two layerable sources** (OBS browser sources, separate displays) → use `lower-third-left/`
  and `lower-third-right/` and stack them. Same look, independently triggerable.

Cards hug their text between 400px and `w` (default 780px), so a left and a right card can
never collide — worst case leaves a 172px gutter. Long names shrink 52px → 34px before ellipsis.

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
hides; from script, `window.l3.play()` / `.hide()` drive every card, and `window.l3.left` /
`.right` (or `window.l3.cards`) reach one card's `.play()` / `.hide()` / `.set({…})`.

### Dropping a line of text

Pass the param **empty** to remove that row — the line collapses rather than blanking, so the
remaining text stays vertically centred:

```
?name=Tom+Reynolds&title=          → name only, no second line
?title=Head+of+AV&subtitle=        → no third line
```

*Omitting* the param does the opposite: it leaves the placeholder text that ships in the
template's markup. That is the distinction — empty means "clear this", absent means "leave it
alone" — so `?title=` and no `title` at all behave differently on purpose.

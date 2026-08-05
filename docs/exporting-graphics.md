# Exporting graphics as video files

This turns the Faire Wire graphics — the ticker and the lower thirds — into video
files you can drop straight onto a timeline in Premiere, Resolve or Final Cut.

The files have a **see-through background** (a real alpha channel), so you put the
clip on a track *above* your video and the graphic sits on top. No green screen,
no keying.

---

## Set up once

Three things, once per machine.

**1. Install ffmpeg** (the thing that writes the video file):

```bash
brew install ffmpeg
```

**2. Go to the project folder:**

```bash
cd ~/Documents/Claude/PConAir
```

**3. Install the project bits and copy the fonts in:**

```bash
npm ci && npm run copy-fonts
```

The fonts step matters. Without it the graphics come out in the wrong typeface.
The export refuses to run if it spots this, so you can't get it wrong silently.

---

## Export the ticker

Type this:

```bash
npx electron scripts/export-overlay.js --render=ticker --mode=both
```

Then wait. **A 200-second ticker takes about 10 minutes.** That is normal — it is
drawing every single frame one at a time on purpose, because that is what makes
the motion perfectly smooth.

You get **two files**:

| File | What it is | When to use it |
|---|---|---|
| `ticker_intro+loop…mov` | The bar slides up from the bottom, then the headlines crawl | **First**, at the start of your video |
| `ticker_loop…mov` | No slide-up. Bar is already there, headlines just crawl | **After** it, repeated as many times as you need |

Put the intro one down first, then butt the loop one up against it, then keep
repeating the loop until you reach the end of your video, and trim the last one
wherever your video ends.

The loop file is built so that its last frame flows perfectly into its first
frame. You will not see a bump where one copy ends and the next begins.

## Export a lower third

```bash
npx electron scripts/export-overlay.js --render=l3 --side=left \
  --name="Rhodes, Punak, Lee vie for Q3 title" --hold=5000
```

- `--side=left` or `--side=right` — which corner it slides in from
- `--name="…"` — the big line of text
- `--title="…"` — the smaller line underneath (leave it out for one line only)
- `--hold=5000` — how long it sits still on screen, **in thousandths of a second**.
  So `5000` = 5 seconds, `3000` = 3 seconds.

The slide-on and slide-off are always the same length, so every title cuts
together nicely. Only the hold changes.

These are quick — a few seconds each.

**Tip:** leave `--name` out entirely and it uses whatever text is currently typed
into the control page in the app. Handy when you have already set it up there.

---

## Where the files go

```
~/Movies/faire-wire-exports/
```

Want them somewhere else? Add `--outdir=/some/other/folder`.

> **Do not put them in `~/Documents`.** That folder is synced to Google Drive, and
> Drive deletes big video files out from under you. Files really have vanished
> mid-export this way. `~/Movies` is safe.

---

## Changing the ticker speed

There are two ways, and they work in **opposite directions**. This trips
everyone up, so read this bit twice.

**Way 1 — the app's control page.** The box called *Seconds per full pass*.

> This is a **time**, so a **bigger number is SLOWER**.
> `180` → `200` makes the headlines crawl more slowly.

**Way 2 — on the export command.** Add `--speed=`.

> This is a **speed in pixels per second**, so a **bigger number is FASTER**.
> `140` → `110` makes the headlines crawl more slowly.

```bash
npx electron scripts/export-overlay.js --render=ticker --mode=both --speed=110
```

Roughly, with 27 headlines:

| `--speed=` | crawl | loop length |
|---|---|---|
| `160` | fast | 157s |
| `140` | about how it started out | 180s |
| `126` | a bit slower | 200s |
| `110` | slower again | 229s |
| `100` | slowest of these | 252s |

### Why there are two ways at all

The *Seconds per full pass* box does not set a speed. It sets **how long the
whole list takes to go past once**. So if you add more headlines, the ticker has
further to travel in the same time — and it speeds up on its own, even though you
never touched the box.

Ten headlines at 200 seconds crawls gently. Forty headlines at 200 seconds
whizzes past.

`--speed=` fixes that. It pins the actual crawl speed and works out the timing
for you, so the ticker looks the same however many headlines you have.

**The trade-off:** you can lock the speed, or you can lock the loop length, but
not both. If you use `--speed=`, the loop stops being a round number of seconds,
and you will have to redo the maths for how many copies fill your video. If you
need the loop to stay exactly 200 seconds, use the box in the app instead.

---

## If it looks like it has broken

**Nothing prints for ages.** It updates every 200 frames with a countdown. If the
countdown is still moving, it is fine. Still not sure? Look at the file getting
bigger:

```bash
ls -l ~/Movies/faire-wire-exports/
```

Run that twice a few seconds apart. If the number is going up, it is working.

**`MaxListenersExceededWarning`.** Harmless, and fixed — but if you see it,
you are on an old copy of the script. Ignore it. The video will be fine.

**`Error: listen EADDRINUSE`.** You are already running one export. Either wait,
or add `--port=8901` to the second one.

**`graphics/_fonts is empty`.** Run `npm run copy-fonts`.

**`ffmpeg not runnable`.** Run `brew install ffmpeg`.

**A file you exported has vanished.** It was in `~/Documents` and Google Drive ate
it. Export to `~/Movies` instead.

---

## Things worth knowing

- The export **cannot disturb a live show.** It reads your text but never writes
  anything back to the app, and it draws the graphics in its own hidden window.
  Nothing can flash onto the output while you are on air.
- Every file comes out **1920×1080, 59.94 fps, ProRes 4444** with alpha. That is
  a broadcast-standard format every editor understands.
- The files are **big** — roughly 1.5 GB for a 200-second ticker. That is normal
  for this format; it is high quality and barely compressed.
- The graphics are slightly see-through by design (94% opaque), so your footage
  shows faintly through the panels, exactly like it does live.

## The full list of options

```
--render=ticker|l3         which graphic
--mode=loop|intro|both     ticker only (default: both)
--side=left|right          lower third only (default: left)
--name= --title= --subtitle=   lower third text; omit to use what's live
--hold=<ms>                lower third hold, default 4000 (= 4 seconds)
--speed=<px/sec>           ticker: lock the crawl speed
--pxPerFrame=<px>          ticker: same idea, per frame instead
--state=<url|file>         where to read the text from
--outdir=<dir>             default ~/Movies/faire-wire-exports
--out=<filename>           name the file yourself
--port=<n>                 change this if you run two at once
--fpsNum= --fpsDen=        frame rate, default 60000/1001 (= 59.94)
```

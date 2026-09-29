# Spike 0A — OSR pipeline (throwaway, never merges to main)

Run: `xvfb-run -a -s "-screen 0 1920x1080x24" node_modules/electron/dist/electron --no-sandbox spike/0a/main.js`
Env: SPIKE_MODE=fake-camera|animated, SPIKE_SECONDS, SPIKE_DUMP, SPIKE_OUT.

Rig: headless Linux container, Xvfb, software GL, Electron 44.4.5 / Chromium 152, Chromium fake video device
(no real camera). NOT macOS, NOT a Mac mini, NOT a UVC/AVFoundation device. 20 s runs, not 10 min.
Fake device delivered 20 fps (not 30) at 1920x1080.

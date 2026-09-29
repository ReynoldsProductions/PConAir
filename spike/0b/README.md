# Spike 0B — getDisplayMedia self-capture (throwaway, never merges to main)
Run: `xvfb-run -a -s "-screen 0 1920x1080x24" node_modules/electron/dist/electron --no-sandbox spike/0b/main.js`
Rig identical to 0A: headless Linux, Xvfb (no compositor), Electron 44.4.5, fake camera, 20 s runs. Not macOS/ScreenCaptureKit.
Picker returned only the Xvfb screen source, so the capture was the whole monitor, not the window.

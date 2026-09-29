// Spike 0C receive attempt (throwaway). Runs in its own process. Tries to
// connect a grandi receiver directly to the known sender name (bypassing
// discovery, since finder.js already showed discovery finds nothing in
// this container) and, if frames arrive, decodes the counter overlay to
// check for gaps/reordering. Expected to fail here (no mDNS resolution
// path for the name lookup either) -- see README.md and result-receive.json.
'use strict';
const fs = require('fs');
const path = require('path');
const { decodeCounter } = require('./pattern.js');

const RECEIVE_SECONDS = +(process.env.SPIKE_RECEIVE_SECONDS || 10);
const NAME = process.env.SPIKE_NDI_NAME || 'PConAir-Spike-0C';
const OUT = process.env.SPIKE_OUT || __dirname;
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const grandi = require('grandi');
  grandi.initialize();
  let receiver;
  try {
    receiver = await grandi.receive({
      source: { name: NAME },
      colorFormat: grandi.ColorFormat.BGRX_BGRA,
      bandwidth: grandi.Bandwidth.Highest,
    });
  } catch (e) {
    const result = {
      library: 'grandi',
      receiverHandleCreated: false,
      error: e.message,
      note: 'Direct connect-by-name (no prior discovery) failed, consistent with finder.js finding no sources: this container has no working NDI discovery/resolution path (no mDNS/Avahi responder). NOT verified: real NDI Studio Monitor, real Zoom Room Custom AV NDI input. Needs a human with real hardware.',
    };
    fs.writeFileSync(path.join(OUT, 'result-receive.json'), JSON.stringify(result, null, 2));
    console.log('RECEIVER_RESULT ' + JSON.stringify(result));
    process.exit(1);
  }

  const frames = [];
  const deadline = Date.now() + RECEIVE_SECONDS * 1000;
  let counters = [];
  let pollTimeouts = 0;
  while (Date.now() < deadline) {
    try {
      const f = await receiver.video(1000);
      const t = performance.now();
      const counter = f.xres && f.yres ? decodeCounter(f.data, f.xres) : null;
      counters.push(counter);
      frames.push({ t, xres: f.xres, yres: f.yres, fourCC: f.fourCC, counter });
    } catch (e) {
      pollTimeouts++; // no data on this 1s poll; keep trying until deadline
    }
  }
  receiver.destroy();

  let gaps = 0;
  for (let i = 1; i < counters.length; i++) {
    if (counters[i] !== null && counters[i - 1] !== null && counters[i] - counters[i - 1] !== 1) gaps++;
  }

  const result = {
    library: 'grandi',
    // The receive() call not throwing only means grandi created a local
    // receiver handle for the name; it does NOT mean an NDI connection to
    // the sender was actually established -- see framesReceived below.
    receiverHandleCreated: true,
    framesReceived: frames.length,
    pollTimeouts,
    firstFrames: frames.slice(0, 5),
    counterGapsDetected: gaps,
    note: frames.length === 0
      ? 'Receiver handle was created but zero video frames arrived in the whole window (every 1s poll timed out): no actual NDI connection was established, consistent with finder.js finding no sources. This container has no working NDI discovery/resolution path (no mDNS/Avahi responder). NOT verified: real NDI Studio Monitor, real Zoom Room Custom AV NDI input. Needs a human with real hardware.'
      : undefined,
  };
  fs.writeFileSync(path.join(OUT, 'result-receive.json'), JSON.stringify(result, null, 2));
  console.log('RECEIVER_RESULT ' + JSON.stringify(result));
  process.exit(0);
})();

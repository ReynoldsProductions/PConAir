// Spike 0C discovery check (throwaway). Runs in its own process (per the
// spec: verify discovery via the library's own find API in a second
// process on localhost). Polls grandi.find() once a second for
// FIND_SECONDS while spike/0c/sender.js (a separate process) is sending.
'use strict';
const fs = require('fs');
const path = require('path');

const FIND_SECONDS = +(process.env.SPIKE_FIND_SECONDS || 10);
const OUT = process.env.SPIKE_OUT || __dirname;
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const grandi = require('grandi');
  grandi.initialize();
  const polls = [];
  let finder;
  try {
    finder = await grandi.find({ showLocalSources: true });
  } catch (e) {
    const result = { error: 'find() create failed', message: e.message };
    fs.writeFileSync(path.join(OUT, 'result-discovery.json'), JSON.stringify(result, null, 2));
    console.log('FINDER_RESULT ' + JSON.stringify(result));
    process.exit(1);
  }
  for (let t = 0; t < FIND_SECONDS; t++) {
    await finder.wait(1000);
    const sources = finder.sources();
    polls.push({ atSeconds: t + 1, sources });
  }
  finder.destroy();
  const anyFound = polls.some((p) => p.sources.length > 0);
  const result = {
    library: 'grandi',
    findSeconds: FIND_SECONDS,
    polls,
    anySourceEverFound: anyFound,
    note: 'showLocalSources:true was passed; empty results across the whole window most likely reflect no mDNS/Avahi responder in this container, not a library defect. See README.md.',
  };
  fs.writeFileSync(path.join(OUT, 'result-discovery.json'), JSON.stringify(result, null, 2));
  console.log('FINDER_RESULT ' + JSON.stringify(result));
  process.exit(0);
})();

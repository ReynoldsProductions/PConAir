// Spike 0C orchestrator (throwaway, never merges to main). NDI needs
// separate OS processes to exercise discovery meaningfully (a sender
// process, and a second process independently finding/receiving it), so
// unlike 0A/0B's single-process main.js this spawns three: sender.js
// (runs SPIKE_SECONDS), then after a warmup, finder.js and receiver.js
// concurrently. All three write their own spike/0c/result-*.json.
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const SECONDS = +(process.env.SPIKE_SECONDS || 20);
const WARMUP_MS = 3000;
const FIND_SECONDS = Math.max(5, SECONDS - Math.ceil(WARMUP_MS / 1000) - 2);
const OUT = process.env.SPIKE_OUT || __dirname;

function run(script, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; process.stdout.write(`[${script}] ${d}`); });
    child.stderr.on('data', (d) => { err += d; process.stderr.write(`[${script}] ${d}`); });
    child.on('exit', (code) => resolve({ script, code, out, err }));
  });
}

(async () => {
  console.log(`[main] starting sender.js for ${SECONDS}s, out=${OUT}`);
  const senderPromise = run('sender.js', { SPIKE_SECONDS: String(SECONDS), SPIKE_OUT: OUT });

  await new Promise((r) => setTimeout(r, WARMUP_MS));
  console.log(`[main] warmup done, starting finder.js (${FIND_SECONDS}s) and receiver.js (${FIND_SECONDS}s) concurrently`);
  const [finderResult, receiverResult] = await Promise.all([
    run('finder.js', { SPIKE_FIND_SECONDS: String(FIND_SECONDS), SPIKE_OUT: OUT }),
    run('receiver.js', { SPIKE_RECEIVE_SECONDS: String(FIND_SECONDS), SPIKE_OUT: OUT }),
  ]);

  const senderResult = await senderPromise;

  console.log('[main] all processes finished. Exit codes:', {
    sender: senderResult.code,
    finder: finderResult.code,
    receiver: receiverResult.code,
  });
  process.exit(senderResult.code === 0 ? 0 : 1);
})();

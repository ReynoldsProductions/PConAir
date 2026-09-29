// Synthetic 1080p BGRA test pattern: moving color bars + a binary frame-counter
// overlay in the top-left corner (readable back by decodeCounter for round-trip
// verification, if a receiver ever gets frames in this run).
'use strict';

const BAR_COLORS_BGRA = [
  [255, 255, 255, 255], // white
  [0, 255, 255, 255],   // yellow (BGRA: B=0,G=255,R=255)
  [255, 255, 0, 255],   // cyan
  [0, 255, 0, 255],     // green
  [255, 0, 255, 255],   // magenta
  [0, 0, 255, 255],     // red
  [255, 0, 0, 255],     // blue
  [0, 0, 0, 255],       // black
];

const COUNTER_BITS = 24; // enough for ~155 hours at 30fps
const BIT_PX = 12;        // px per bit square
const COUNTER_MARGIN = 8;

function buildRowTemplate(width) {
  // Double-width row of bar colors so any width-wide window sliding across it
  // wraps seamlessly, giving cheap "moving bars" without recomputing per frame.
  const doubled = new Uint8Array(width * 2 * 4);
  const bandWidth = Math.floor(width / BAR_COLORS_BGRA.length);
  for (let x = 0; x < width * 2; x++) {
    const band = Math.floor((x % width) / bandWidth) % BAR_COLORS_BGRA.length;
    const [b, g, r, a] = BAR_COLORS_BGRA[band];
    const o = x * 4;
    doubled[o] = b; doubled[o + 1] = g; doubled[o + 2] = r; doubled[o + 3] = a;
  }
  return doubled;
}

function makeFrameBuilder(width, height) {
  const template = buildRowTemplate(width);
  const frame = Buffer.alloc(width * height * 4);
  const rowBytes = width * 4;

  return function build(frameIndex, phasePxPerFrame = 4) {
    const phase = (frameIndex * phasePxPerFrame) % width;
    const row = Buffer.from(template.buffer, phase * 4, rowBytes);
    for (let y = 0; y < height; y++) {
      row.copy(frame, y * rowBytes);
    }
    drawCounter(frame, width, frameIndex);
    return frame; // caller must copy out before this is mutated again (buffer pool)
  };
}

function drawCounter(frame, width, frameIndex) {
  const rowBytes = width * 4;
  for (let bit = 0; bit < COUNTER_BITS; bit++) {
    const on = (frameIndex >>> bit) & 1;
    const x0 = COUNTER_MARGIN + bit * BIT_PX;
    const color = on ? [255, 255, 255, 255] : [0, 0, 0, 255]; // white=1, black=0
    for (let y = COUNTER_MARGIN; y < COUNTER_MARGIN + BIT_PX; y++) {
      const rowOff = y * rowBytes;
      for (let x = x0; x < x0 + BIT_PX - 1; x++) {
        const o = rowOff + x * 4;
        frame[o] = color[0]; frame[o + 1] = color[1]; frame[o + 2] = color[2]; frame[o + 3] = color[3];
      }
    }
  }
}

function decodeCounter(frame, width) {
  const rowBytes = width * 4;
  let value = 0;
  const sampleY = COUNTER_MARGIN + Math.floor(BIT_PX / 2);
  const rowOff = sampleY * rowBytes;
  for (let bit = 0; bit < COUNTER_BITS; bit++) {
    const x = COUNTER_MARGIN + bit * BIT_PX + Math.floor(BIT_PX / 2);
    const o = rowOff + x * 4;
    const on = frame[o] > 127 ? 1 : 0; // blue channel bright => white square
    value |= (on << bit);
  }
  return value >>> 0;
}

module.exports = { makeFrameBuilder, drawCounter, decodeCounter, COUNTER_BITS };

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createStateStore } from '../src/main/state';
import { createFullServer } from './_test-server';
import { buildL3ProgramMarkup } from '../src/main/l3/window-manager';

// Admin → Background wrote AppState.background, but nothing anywhere read it:
// each output surface hardcoded its own backdrop, so whether a take came out
// over black or over nothing depended purely on which operator page took it.
// The Background page is now the authority for PConAir's own output windows.
//
// Stacking needs no special case here: the whole stack renders into ONE window
// with a single backdrop painted behind it, so the upper cards are inherently
// transparent and both the card below and the background show through.

const SOLID = { presetId: null, presetName: null, type: 'solid' as const, value: '#1133ff' };
const LUMA = { presetId: null, presetName: null, type: 'luma' as const, value: '#000000' };
const TRANSPARENT = { presetId: null, presetName: null, type: 'transparent' as const, value: '#000000' };

describe('buildL3ProgramMarkup — background', () => {
  it('is transparent when no background is configured', () => {
    const html = buildL3ProgramMarkup([{ name: 'A', title: 'B' }], null, null);
    expect(html).toContain('background:transparent');
  });

  it('is transparent for the transparent type, whatever the value says', () => {
    const html = buildL3ProgramMarkup([{ name: 'A', title: 'B' }], null, TRANSPARENT);
    expect(html).toContain('background:transparent');
    expect(html).not.toContain('#000000;');
  });

  it('paints a solid background colour', () => {
    const html = buildL3ProgramMarkup([{ name: 'A', title: 'B' }], null, SOLID);
    expect(html).toContain('#1133ff');
  });

  it('paints a luma background colour', () => {
    const html = buildL3ProgramMarkup([{ name: 'A', title: 'B' }], null, LUMA);
    expect(html).toContain('#000000');
  });

  it('paints exactly one backdrop behind a stack of three', () => {
    const stack = [
      { name: 'One', title: 'First' },
      { name: 'Two', title: 'Second' },
      { name: 'Three', title: 'Third' },
    ];
    const html = buildL3ProgramMarkup(stack, null, SOLID);
    // One backdrop, not one per card — upper layers stay see-through.
    expect(html.match(/#1133ff/g)?.length).toBe(1);
    expect(html).toContain('One');
    expect(html).toContain('Two');
    expect(html).toContain('Three');
  });

  it('never gives an individual cue card its own opaque fill', () => {
    const html = buildL3ProgramMarkup(
      [{ name: 'One', title: 'First' }, { name: 'Two', title: 'Second' }],
      null,
      SOLID
    );
    const cueRule = html.slice(html.indexOf('.cue{'), html.indexOf('}', html.indexOf('.cue{')));
    expect(cueRule).not.toContain('background');
  });
});

describe('POST /api/background — transparent type', () => {
  let app: Express;
  let srv: ReturnType<typeof createFullServer>;
  let adm: string;

  beforeEach(async () => {
    srv = createFullServer({
      store: createStateStore(),
      operatorPin: 'test1234',
      adminPin: 'adminpass8',
      port: 0,
    });
    await srv.listen();
    app = srv.app;
    adm = ((await request(app).post('/auth/admin').send({ pin: 'adminpass8' }))
      .headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  });

  afterEach(() => srv.close());

  it('accepts type transparent', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', adm)
      .send({ type: 'transparent', value: '#000000' });
    expect(res.status).toBe(200);
    expect(res.body.background.type).toBe('transparent');
  });

  it('accepts a transparent preset', async () => {
    const created = await request(app)
      .post('/api/background/presets')
      .set('Cookie', adm)
      .send({ name: 'Keyed', type: 'transparent', value: '#000000' });
    expect(created.status).toBe(201);

    const applied = await request(app)
      .post('/api/background')
      .set('Cookie', adm)
      .send({ presetId: created.body.id ?? created.body.preset?.id });
    expect(applied.status).toBe(200);
    expect(applied.body.background.type).toBe('transparent');
  });

  it('still rejects a bogus type', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', adm)
      .send({ type: 'plaid', value: '#000000' });
    expect(res.status).toBe(400);
  });

  it('still rejects a bad colour', async () => {
    const res = await request(app)
      .post('/api/background')
      .set('Cookie', adm)
      .send({ type: 'solid', value: 'blue' });
    expect(res.status).toBe(400);
  });
});

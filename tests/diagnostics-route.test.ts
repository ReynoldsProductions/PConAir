import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createFullServer } from './_test-server';
import { createStateStore } from '../src/main/state';

const PINS = { operatorPin: '1234', adminPin: 'supersecret' };

describe('T9 & T10 — Diagnostics route and secret leak guard', () => {
  let server: any;
  let bundledRoot: string;

  beforeEach(async () => {
    bundledRoot = path.join(process.cwd(), 'bundled-packages');
    const store = createStateStore();
    server = createFullServer({ store, ...PINS, port: 0, packagesRoot: bundledRoot });
    await server.listen();
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('GET /api/diagnostics requires operator auth', async () => {
    const res = await request(server.app).get('/api/diagnostics');
    expect(res.status).toBe(401);
  });

  it('GET /api/diagnostics returns diagnostics for authenticated operator', async () => {
    const agent = request.agent(server.app);
    // Login as operator
    await agent
      .post('/api/login')
      .send({ pin: '1234' });

    const res = await agent.get('/api/diagnostics');
    expect(res.status).toBe(200);

    // Check shape
    expect(res.body).toHaveProperty('version');
    expect(typeof res.body.version).toBe('string');
    
    expect(res.body).toHaveProperty('uptimeSeconds');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    
    expect(res.body).toHaveProperty('platform');
    expect(typeof res.body.platform).toBe('string');
    
    expect(res.body).toHaveProperty('memoryMB');
    expect(res.body.memoryMB).toHaveProperty('rss');
    expect(res.body.memoryMB).toHaveProperty('heapUsed');
    
    expect(res.body).toHaveProperty('packages');
    expect(Array.isArray(res.body.packages)).toBe(true);
    
    expect(res.body).toHaveProperty('presence');
  });

  it('packages array has correct shape', async () => {
    const agent = request.agent(server.app);
    await agent.post('/api/login').send({ pin: '1234' });

    const res = await agent.get('/api/diagnostics');
    
    for (const pkg of res.body.packages) {
      expect(pkg).toHaveProperty('id');
      expect(typeof pkg.id).toBe('string');
      
      expect(pkg).toHaveProperty('version');
      expect(typeof pkg.version).toBe('string');
      
      expect(pkg).toHaveProperty('renders');
      expect(Array.isArray(pkg.renders)).toBe(true);
      
      expect(pkg).toHaveProperty('hasControl');
      expect(typeof pkg.hasControl).toBe('boolean');
    }
  });

  it('T10: secret leak guard - no pin, hash, token, secret in response', async () => {
    const agent = request.agent(server.app);
    await agent.post('/api/login').send({ pin: '1234' });

    const res = await agent.get('/api/diagnostics');
    expect(res.status).toBe(200);
    
    const body = JSON.stringify(res.body);
    const sensitivePatterns = /pin|hash|token|secret/gi;
    const matches = body.match(sensitivePatterns);
    
    expect(matches).toBeNull();
  });
});

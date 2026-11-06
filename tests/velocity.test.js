import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import VelocityBoost from '../src/index.js';
import CacheEngine from '../src/core/CacheEngine.js';
import CompressionEngine from '../src/core/CompressionEngine.js';
import MonitoringSystem from '../src/core/MonitoringSystem.js';
import LoadShedder from '../src/core/LoadShedder.js';

const startApp = async (options) => {
  const app = express();
  const booster = new VelocityBoost(options);
  booster.initializeMiddleware(app);
  app.get('/api/data', (req, res) => res.json({ message: 'hello' }));
  app.get('/api/random', booster.cache.skipCache(), (req, res) => res.json({ n: Math.random() }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, booster };
};

test('defaults: todas las features activadas y no pisadas por undefined', () => {
  const booster = new VelocityBoost({ cacheTTL: 60, adminMiddleware: undefined, enableCompression: undefined });
  assert.equal(booster.options.enableCaching, true);
  assert.equal(booster.options.enableCompression, true);
  assert.equal(booster.options.enableRateLimit, true);
  assert.equal(booster.options.enableMonitoring, true);
  assert.equal(booster.options.enableLoadShedding, true);
  assert.equal(booster.options.enableNoStore, false);
  assert.equal(booster.options.cacheTTL, 60);
  assert.equal(booster.options.adminMiddleware, null);
});

test('cache: MISS la primera vez, HIT la segunda', async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  const first = await fetch(base + '/api/data');
  assert.equal(first.headers.get('x-cache'), 'MISS');
  const second = await fetch(base + '/api/data');
  assert.equal(second.headers.get('x-cache'), 'HIT');
  const body = await second.json();
  assert.equal(body.message, 'hello');
});

test('skipCache: la ruta nunca queda cacheada', async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  const a = await fetch(base + '/api/random');
  const b = await fetch(base + '/api/random');
  assert.equal(a.headers.get('x-cache'), null);
  assert.equal(b.headers.get('x-cache'), null);
  assert.notEqual((await a.json()).n, (await b.json()).n);
});

test('rate limit: responde 429 al exceder el maximo', async (t) => {
  const { server, base } = await startApp({ rateLimitMax: 3, rateLimitWindow: 60 * 1000 });
  t.after(() => server.close());
  const codes = [];
  for (let i = 0; i < 4; i++) {
    const r = await fetch(base + '/api/data');
    codes.push(r.status);
  }
  assert.deepEqual(codes.sort(), [200, 200, 200, 429]);
});

test('enableNoStore: agrega Cache-Control no-store cuando se pide', async (t) => {
  const { server, base } = await startApp({ enableNoStore: true });
  t.after(() => server.close());
  const r = await fetch(base + '/api/data');
  assert.match(r.headers.get('cache-control') || '', /no-store/);
});

test('sin enableNoStore no se envia Cache-Control global', async (t) => {
  const { server, base } = await startApp({ enableSecurityHeaders: true });
  t.after(() => server.close());
  const first = await fetch(base + '/api/data');
  const second = await fetch(base + '/api/data');
  assert.equal(first.headers.get('cache-control'), null);
  assert.equal(second.headers.get('cache-control'), null);
  // headers de seguridad presentes tambien en el HIT de cache (orden de middlewares)
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(second.headers.get('x-content-type-options'), 'nosniff');
});

test('endpoints de admin responden', async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  const health = await fetch(base + '/velocity/health');
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.ok(['healthy', 'warning', 'critical'].includes(body.status));
  const stats = await fetch(base + '/velocity/stats');
  assert.equal(stats.status, 200);
  const clear = await fetch(base + '/velocity/cache/clear', { method: 'POST' });
  assert.equal(clear.status, 200);
});

test('dashboard sirve HTML', async (t) => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  const dash = await fetch(base + '/velocity/dashboard');
  assert.equal(dash.status, 200);
  assert.match(dash.headers.get('content-type') || '', /html/);
});

test('CacheEngine: TTL, expiracion y eviction LRU', async () => {
  const engine = new CacheEngine({ cacheTTL: 0.3, cacheMaxSize: 2 });
  assert.equal(engine.getStats().storageType, 'MEMORY');
  await engine.set('a', { x: 1 });
  assert.deepEqual(await engine.get('a'), { x: 1 });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await engine.get('a'), null);
  await engine.set('b', 1);
  await engine.set('c', 2);
  await engine.set('d', 3);
  assert.equal(await engine.get('b'), null);
  assert.equal(await engine.get('c'), 2);
  const cleared = await engine.clear();
  assert.equal(cleared.type, 'MEMORY');
  assert.equal(cleared.cleared, 2);
});

test('MonitoringSystem: descarta la metrica mas vieja sin copiar arrays', () => {
  const mon = new MonitoringSystem({ monitoringMaxMetrics: 3 });
  for (let i = 0; i < 5; i++) mon.recordMetric({ path: '/x' + i, duration: i });
  assert.equal(mon.metrics.length, 3);
  assert.equal(mon.metrics[0].path, '/x2');
  assert.equal(mon.metrics[2].path, '/x4');
  assert.equal(mon.getRecentMetrics(2)[0].path, '/x4');
});

test('CompressionEngine: el modo deriva de maxEventLoopLag/2', () => {
  const hot = new CompressionEngine({}, { currentLag: 60, maxEventLoopLag: 70 });
  assert.equal(hot.getStats().currentMode, 'LOW_CPU_MODE');
  const cool = new CompressionEngine({}, { currentLag: 10, maxEventLoopLag: 70 });
  assert.equal(cool.getStats().currentMode, 'MAX_COMPRESSION');
  const custom = new CompressionEngine({}, { currentLag: 30, maxEventLoopLag: 40 });
  assert.equal(custom.getStats().currentMode, 'LOW_CPU_MODE');
});

test('LoadShedder: getStats reporta el umbral configurado', () => {
  const shedder = new LoadShedder({ maxEventLoopLag: 40, lagCheckInterval: 100 });
  const stats = shedder.getStats();
  assert.equal(stats.maxAllowedLagMs, 40);
  assert.equal(typeof stats.currentLagMs, 'number');
  assert.ok(['HEALTHY', 'OVERLOADED'].includes(stats.status));
});

# ⚡ VelocityBoost - Performance Optimization Module

[![Node.js CI](https://github.com/Axelix09/velocity-boost/actions/workflows/ci.yml/badge.svg)](https://github.com/Axelix09/velocity-boost/actions/workflows/ci.yml)

Professional performance optimization module for Node.js APIs. Production-grade caching, compression, rate limiting, load shedding, and monitoring.

## Why VelocityBoost?

Unlike typical performance middleware, VelocityBoost provides **manual load-shedding controls** for handling traffic spikes, making it ideal for AI APIs, high-traffic backends, and resource-constrained environments.

- **Automatic Response Caching** - Cache GET responses with configurable TTL
- **Smart Compression** - Adaptive compression based on server load
- **Rate Limiting** - Protect endpoints from abuse with configurable limits
- **Load Shedding** - Monitor event loop lag and shed traffic during overload
- **Memory Management** - Track requests and force garbage collection
- **Real-time Monitoring** - Live metrics dashboard and health checks

## Installation

```bash
npm install velocity-boost
```

## Quick Start

```javascript
import VelocityBoost from 'velocity-boost';
import express from 'express';

const app = express();

const booster = new VelocityBoost({
  // Caching
  cacheTTL: 300,
  cacheMaxSize: 10000,

  // Load Shedding
  maxEventLoopLag: 70,
  lagCheckInterval: 500,

  // Rate Limiting
  rateLimitMax: 100,
  rateLimitWindow: 60 * 1000,

  // Monitoring
  monitoringMaxMetrics: 10000,

  // Security headers
  enableSecurityHeaders: true,

  // Response headers
  enableNoStore: false,

  // Admin route protection
  adminMiddleware: null,
});

booster.initializeMiddleware(app);
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableCaching` | boolean | `true` | Enable response caching |
| `cacheTTL` | number | `3600` | Cache time-to-live in seconds |
| `cacheMaxSize` | number | `10000` | Max entries in memory cache |
| `cacheKeyGenerator` | function | `null` | Custom cache key generator `(req) => string`. Default: `method:URL` |
| `enableCompression` | boolean | `true` | Enable adaptive compression |
| `enableRateLimit` | boolean | `true` | Enable rate limiting |
| `rateLimitMax` | number | `1000` | Max requests per window |
| `rateLimitWindow` | number | `60000` | Rate limit window in ms |
| `enableMonitoring` | boolean | `true` | Request metrics collection |
| `monitoringMaxMetrics` | number | `10000` | Max metrics kept in memory |
| `enableSecurityHeaders` | boolean | `false` | Add security headers to all responses |
| `enableNoStore` | boolean | `false` | Send `Cache-Control: no-cache, no-store, must-revalidate` on all responses |
| `enableAdminRoutes` | boolean | `false` | Expose `/velocity/*` admin routes. Enabled automatically when `adminMiddleware` is set |
| `adminMiddleware` | function | `null` | Middleware to protect `/velocity/*` routes |

---

## Features

### Automatic Caching

JSON responses to GET requests (routes that reply with `res.json()`) are cached automatically. The middleware intercepts the response, caches it, and serves it from cache on subsequent identical requests. The cache key is the method plus the URL. Responses include an `X-Cache: HIT` or `X-Cache: MISS` header. Routes using `skipCache()` receive no `X-Cache` header at all, since they are never cached.

**Security:** GET requests carrying an `Authorization` or `Cookie` header are never cached or served from cache, so authenticated endpoints cannot leak one user's response to another. Responses marked `Cache-Control: private` or `no-store` are excluded too. If your API returns per-user content in another way, protect that route with `skipCache()` or supply a `cacheKeyGenerator(req)` that includes the user identity.

```javascript
// Never cache this route (per-user data)
app.get('/api/user/profile', booster.cache.skipCache(), handler);
```

The `/velocity/*` admin routes are never cached.

#### Cache Storage

Memory by default. If `REDIS_URL` is set (e.g. on Vercel or any platform with a Redis addon), the cache automatically switches to Redis. The fallback is transparent — your app keeps running regardless.

### Smart Compression

Adaptive compression that adjusts the compression level based on current event loop lag:
- **Normal load:** High compression level (level 9, best size reduction)
- **High load:** Lower compression level (level 4, faster, less CPU)

### Rate Limiting

Per-IP rate limiting using `express-rate-limit`:

```javascript
// Global (applied automatically via initializeMiddleware)
// Defaults: 1000 requests per 60s

// Custom per-route
app.get('/api/public', booster.rateLimit.generous(), (req, res) => {
  res.json({ data: 'public' });
});

app.post('/api/ai', booster.rateLimit.strict(), (req, res) => {
  res.json({ result: '...' });
});
```

### Load Shedding

Monitors the event loop lag via `perf_hooks.monitorEventLoopDelay`, checked every `lagCheckInterval` ms (default 500), using the p99.9 of the delay histogram so transient spikes are detected. If lag exceeds `maxEventLoopLag`, new requests receive a `503` with a `Retry-After: 5` header until the server recovers. Admin routes are never shed.

### Security Headers

Optional (`enableSecurityHeaders: true`): adds `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, and `Permissions-Policy` to every response.

### Admin Dashboard & Monitoring

Admin routes (`/velocity/health`, `/velocity/stats`, `/velocity/metrics`, `/velocity/dashboard`, `/velocity/cache/clear`, `/velocity/gc`) are **disabled by default**. They are enabled either with `enableAdminRoutes: true` (local development) or by setting an `adminMiddleware`, which is then applied to all of them:

```javascript
const booster = new VelocityBoost({
  enableAdminRoutes: process.env.NODE_ENV !== 'production',
  adminMiddleware: (req, res, next) => {
    if (req.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
});
```

---

## Usage Examples

### Basic Express Setup

```javascript
import VelocityBoost from 'velocity-boost';
import express from 'express';

const app = express();
const booster = new VelocityBoost({ cacheTTL: 300 });

booster.initializeMiddleware(app);

app.get('/api/data', (req, res) => {
  res.json({ items: [...], cached: 'for 5 minutes' });
});

app.listen(3000);
```

### Vercel Deployment

```javascript
// api/index.js
import VelocityBoost from 'velocity-boost';
import express from 'express';

const app = express();
app.set('trust proxy', 1); // detras del proxy de Vercel, antes de initializeMiddleware

const booster = new VelocityBoost({ cacheTTL: 300 });
booster.initializeMiddleware(app);

export default app;
```

#### Serverless caveats

- The in-memory cache, rate limiter counters and load shedder are **per instance**: they reset on every cold start and are not shared between lambdas. Set `REDIS_URL` to share cache state across instances (the rate limiter still counts per instance).
- Behind Vercel's (or any platform's) proxy, set `app.set('trust proxy', 1)` **before** `initializeMiddleware(app)`. Otherwise every request appears to come from the proxy IP and the rate limiter groups all your users into a single bucket.

---

## Middleware Order

VelocityBoost registers its middlewares in this order:

1. **Load Shedding** - shed requests before doing any work
2. **Monitoring** - record request metrics
3. **Compression** - adaptive compression
4. **Rate Limiting** - per-IP limits
5. **Optimization (headers)** - security/response headers
6. **Caching** - intercept and serve cached responses

This ensures headers are always set regardless of cache HIT or MISS, and monitoring covers shedded requests too.

---

## Tests

```bash
npm test
```

Runs the test suite with Node's built-in test runner (no extra dependencies).

---

## License

MIT — [AxelDev09](https://github.com/Axelix09)

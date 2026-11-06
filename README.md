# velocity-boost ⚡

Professional performance optimization module for Node.js APIs. Drop-in middleware that adds caching, compression, rate limiting, load shedding, and real-time monitoring to any Express app — compatible with Vercel, AWS Lambda, and traditional servers.

---

## Installation

```bash
npm install velocity-boost
```

If you want Redis support:

```bash
npm install velocity-boost ioredis
```

---

## Quick Start

```js
import express from 'express';
import VelocityBoost from 'velocity-boost';

const app = express();
const booster = new VelocityBoost();

booster.initializeMiddleware(app);
app.use(express.json());

app.get('/api/data', (req, res) => {
  res.json({ message: 'Hello World' });
});

app.listen(3000);
```

That's it. Compression, caching, rate limiting, and monitoring are active by default.

---

## Configuration

All options are passed to the constructor. Every feature is enabled by default and can be toggled individually.

```js
const booster = new VelocityBoost({
  // Cache
  enableCaching: true,
  cacheTTL: 3600,
  cacheMaxSize: 10000,

  // Compression
  enableCompression: true,

  // Rate limiting
  enableRateLimit: true,
  rateLimitMax: 1000,
  rateLimitWindow: 15 * 60 * 1000,
  strictLimitMax: 100,
  generousLimitMax: 5000,

  // Load shedding
  enableLoadShedding: true,
  maxEventLoopLag: 70,
  lagCheckInterval: 500,

  // Monitoring
  enableMonitoring: true,
  monitoringMaxMetrics: 10000,

  // Security headers
  enableSecurityHeaders: false,

  // Response headers
  enableNoStore: false,

  // Admin route protection
  adminMiddleware: null,
});
```

### Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableCaching` | boolean | `true` | Automatic GET response caching |
| `cacheTTL` | number | `3600` | Cache TTL in seconds |
| `cacheMaxSize` | number | `10000` | Max in-memory cache entries |
| `enableCompression` | boolean | `true` | Gzip/Brotli response compression |
| `enableRateLimit` | boolean | `true` | Global rate limiting |
| `rateLimitMax` | number | `1000` | Max requests per window (global) |
| `rateLimitWindow` | number | `900000` | Rate limit window in ms (15 min) |
| `strictLimitMax` | number | `100` | Max requests for strict limiter |
| `generousLimitMax` | number | `5000` | Max requests for generous limiter |
| `enableLoadShedding` | boolean | `true` | Reject requests when event loop is lagging |
| `maxEventLoopLag` | number | `70` | Max allowed event loop lag in ms |
| `lagCheckInterval` | number | `500` | Lag check interval in ms |
| `enableMonitoring` | boolean | `true` | Request metrics collection |
| `monitoringMaxMetrics` | number | `10000` | Max metrics kept in memory |
| `enableSecurityHeaders` | boolean | `false` | Add security headers to all responses |
| `enableNoStore` | boolean | `false` | Send `Cache-Control: no-cache, no-store, must-revalidate` on all responses |
| `adminMiddleware` | function | `null` | Middleware to protect `/velocity/*` routes |

---

## Redis Support

Set the `REDIS_URL` environment variable and velocity-boost will automatically use Redis for caching. If Redis is unavailable or `ioredis` is not installed, it falls back to in-memory cache with no configuration needed.

```env
REDIS_URL=redis://localhost:6379
```

The fallback is transparent — your app keeps running regardless.

---

## Features

### Automatic Caching

JSON responses to GET requests (routes that reply with `res.json()`) are cached automatically. The middleware intercepts the response, caches it, and serves it from cache on subsequent identical requests. The cache key is the method plus the URL, so routes whose response varies per user should use `skipCache()`. Responses include an `X-Cache: HIT` or `X-Cache: MISS` header.

The `/velocity/*` admin routes are never cached.

To disable caching on a specific route:

```js
app.post('/api/upload', booster.cache.skipCache(), (req, res) => {
  res.json({ uploaded: true });
});
```

### Adaptive Compression

Responses are compressed with gzip/Brotli (level 9 by default). When the server is under load (event loop lag above 50% of the threshold), compression automatically drops to level 4 to save CPU.

Streaming routes (`/stream`) are excluded from compression.

### Rate Limiting

Three rate limit tiers are available. The global limiter is applied automatically. Strict and generous limiters can be applied per route:

```js
app.get('/api/auth', booster.rateLimit.strict(), (req, res) => {
  res.json({ token: '...' });
});

app.get('/api/public', booster.rateLimit.generous(), (req, res) => {
  res.json({ data: '...' });
});
```

### Load Shedding

Monitors the event loop lag via `perf_hooks.monitorEventLoopDelay`, checked every `lagCheckInterval` ms (default 500). If lag exceeds `maxEventLoopLag`, new requests receive a `503` with a `Retry-After: 5` header until the server recovers. Admin routes are never shed.

### Security Headers

Opt-in via `enableSecurityHeaders: true`. Adds:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`

### Admin Route Protection

Protect all `/velocity/*` routes with any Express middleware:

```js
const booster = new VelocityBoost({
  adminMiddleware: (req, res, next) => {
    if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  },
});
```

---

## Admin Endpoints

All admin endpoints are mounted under `/velocity` and protected by `adminMiddleware` if configured.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/velocity/dashboard` | Visual monitoring dashboard |
| `GET` | `/velocity/health` | Server health status |
| `GET` | `/velocity/stats` | Full stats for all modules |
| `GET` | `/velocity/metrics?limit=50` | Recent request metrics |
| `POST` | `/velocity/cache/clear` | Clear all cached entries |
| `POST` | `/velocity/gc` | Force garbage collection (requires `--expose-gc`) |

### Health Response Example

```json
{
  "status": "healthy",
  "uptime": "2h 15m",
  "memory": {
    "heapUsed": "45 MB",
    "heapTotal": "64 MB",
    "heapPercentage": "70.31%"
  },
  "stats": { ... }
}
```

Status can be `healthy`, `warning` (heap > 80%), or `critical` (load shedding active).

### Stats Response Example

```json
{
  "memory": {
    "heapUsedMB": 45,
    "heapTotalMB": 64,
    "requests": 1200,
    "errors": 3,
    "avgResponseTime": 12,
    "slowRequests": 1
  },
  "cache": {
    "entries": 42,
    "hits": 980,
    "misses": 220,
    "hitRate": "81.67",
    "storageType": "REDIS"
  },
  "rateLimit": {
    "totalRequests": 1200,
    "blockedRequests": 5,
    "blockPercentage": "0.42"
  },
  "loadShedding": {
    "currentLagMs": 3,
    "status": "HEALTHY",
    "maxAllowedLagMs": 70
  },
  "compression": {
    "compressedResponses": 950,
    "bytesSaved": 2048000,
    "compressionRatio": "68.00%",
    "currentMode": "MAX_COMPRESSION"
  },
  "timestamp": "2026-05-24T15:30:00.000Z"
}
```

---

## Vercel / Serverless

velocity-boost works out of the box on Vercel. Redis is recommended for caching since in-memory cache does not persist between function invocations.

```js
import express from 'express';
import VelocityBoost from 'velocity-boost';

const app = express();
const booster = new VelocityBoost({
  cacheTTL: 300,
  rateLimitMax: 1000,
});

booster.initializeMiddleware(app);
app.use(express.json());

app.get('/api/data', (req, res) => {
  res.json({ message: 'Hello from Vercel' });
});

export default app;
```

---

## Garbage Collection

Force GC via `POST /velocity/gc`. Requires launching Node with the `--expose-gc` flag:

```bash
node --expose-gc server.js
```

---

## Middleware Order

velocity-boost registers middleware in this order internally:

1. Load Shedder
2. Monitoring
3. Compression
4. Rate Limiter
5. Optimization headers
6. Cache

This ensures headers are always set regardless of cache HIT or MISS, and monitoring captures every request including rejected ones.

---

## Tests

```bash
npm test
```

Runs the test suite with Node's built-in test runner (no extra dependencies).

---

## License

MIT — [AxelDev09](https://github.com/Axelix09)

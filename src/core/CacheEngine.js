import crypto from 'crypto';

class CacheEngine {
  constructor(options = {}, redisClient = null) {
    this.redis = redisClient;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    this.maxSize = options.cacheMaxSize || 10000;
    this.defaultTTL = options.cacheTTL || 3600;
  }

  generateKey(req) {
    const key = `${req.method}:${req.originalUrl}`;
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  async get(key) {
    if (this.redis && this.redis.status === 'ready') {
      try {
        const data = await this.redis.get(`vb:cache:${key}`);
        if (data) {
          this.hits++;
          return JSON.parse(data);
        }
      } catch (_) {}
    }

    const item = this.cache.get(key);
    if (!item || (item.expires && item.expires < Date.now())) {
      if (item) this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.cache.delete(key);
    this.cache.set(key, item);
    this.hits++;
    return item.value;
  }

  async set(key, value, ttl = null) {
    const finalTTL = ttl || this.defaultTTL;

    if (this.redis && this.redis.status === 'ready') {
      try {
        await this.redis.set(`vb:cache:${key}`, JSON.stringify(value), 'EX', finalTTL);
        return;
      } catch (_) {}
    }

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expires: Date.now() + finalTTL * 1000,
    });
  }

  async clear() {
    if (this.redis && this.redis.status === 'ready') {
      try {
        const keys = await this.redis.keys('vb:cache:*');
        if (keys.length > 0) await this.redis.del(...keys);
        return { cleared: keys.length, type: 'redis' };
      } catch (_) {}
    }
    const size = this.cache.size;
    this.cache.clear();
    return { cleared: size, type: 'memory' };
  }

  middleware() {
    return async (req, res, next) => {
      if (req.method !== 'GET' || res.skipCache || req.path.startsWith('/velocity')) return next();

      try {
        const key = this.generateKey(req);
        const cached = await this.get(key);

        if (cached !== null) {
          res.setHeader('X-Cache', 'HIT');
          return res.json(cached);
        }

        const originalJson = res.json.bind(res);
        res.json = (body) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && !res.skipCache) {
            this.set(key, body).catch(() => {});
            // Solo se marca MISS cuando la respuesta realmente entra
            // al cache; las rutas con skipCache no deben llevar el header.
            res.setHeader('X-Cache', 'MISS');
          }
          return originalJson(body);
        };
      } catch (_) {}

      next();
    };
  }

  skipCache() {
    return (req, res, next) => {
      res.skipCache = true;
      next();
    };
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(2) : '0.00',
      storageType: (this.redis && this.redis.status === 'ready') ? 'REDIS' : 'MEMORY',
    };
  }
}

export default CacheEngine;

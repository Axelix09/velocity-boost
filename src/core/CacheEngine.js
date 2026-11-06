import crypto from 'crypto';

class CacheEngine {
  constructor(options = {}, redisClient = null) {
    this.redis = redisClient;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    this.maxSize = options.cacheMaxSize || 10000;
    this.defaultTTL = options.cacheTTL || 3600;
    // Generador de clave configurable: permite incluir identidad de usuario
    // o cualquier otra dimension en la clave de cache.
    this.keyGenerator = options.cacheKeyGenerator || null;
  }

  generateKey(req) {
    const base = typeof this.keyGenerator === 'function'
      ? this.keyGenerator(req)
      : `${req.method}:${req.originalUrl}`;
    return crypto.createHash('sha256').update(String(base)).digest('hex').substring(0, 16);
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
    // Permite TTL 0 explicito; solo usa el default si no se paso un numero.
    const finalTTL = typeof ttl === 'number' ? ttl : this.defaultTTL;

    if (this.redis && this.redis.status === 'ready') {
      try {
        await this.redis.set(`vb:cache:${key}`, JSON.stringify(value), 'EX', Math.max(1, finalTTL));
        return;
      } catch (_) {}
    }

    // Si la clave ya existe, se actualiza sin expulsar otra entrada.
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
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
        // SCAN en vez de KEYS: KEYS es O(N) y bloquea el event loop de Redis.
        let cleared = 0;
        let cursor = '0';
        do {
          const [next, keys] = await this.redis.scan(cursor, 'MATCH', 'vb:cache:*', 'COUNT', 500);
          cursor = next;
          if (keys.length > 0) {
            await this.redis.del(...keys);
            cleared += keys.length;
          }
        } while (cursor !== '0');
        return { cleared, type: 'redis' };
      } catch (_) {}
    }
    const size = this.cache.size;
    this.cache.clear();
    return { cleared: size, type: 'memory' };
  }

  middleware() {
    return async (req, res, next) => {
      if (req.method !== 'GET' || res.skipCache || req.path.startsWith('/velocity')) return next();

      // Seguridad: nunca cachear peticiones autenticadas. Con la clave por
      // defecto (metodo + URL) un GET con Authorization o Cookie devolveria
      // la respuesta de otro usuario. Estas peticiones pasan sin cache.
      const authSensitive = Boolean(req.headers['authorization'] || req.headers['cookie']);
      if (authSensitive) return next();

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
            // Respuestas marcadas private o no-store no deben compartirse.
            const cacheControl = String(res.getHeader('Cache-Control') || '');
            const cacheable = !/private|no-store/i.test(cacheControl);
            if (cacheable) {
              this.set(key, body).catch(() => {});
              // Solo se marca MISS cuando la respuesta realmente entra
              // al cache; las rutas con skipCache no deben llevar el header.
              res.setHeader('X-Cache', 'MISS');
            }
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

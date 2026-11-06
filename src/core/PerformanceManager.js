import RequestTracker from './MemoryManager.js';
import CacheEngine from './CacheEngine.js';
import CompressionEngine from './CompressionEngine.js';
import RateLimiter from './RateLimiter.js';
import MonitoringSystem from './MonitoringSystem.js';
import OptimizationMiddleware from './optimizationMiddleware.js';
import LoadShedder from './LoadShedder.js';

class PerformanceManager {
  constructor(options = {}) {
    // Las normalizaciones van DESPUÉS del spread para que los defaults
    // no puedan ser pisados por valores `undefined` del objeto crudo.
    this.options = {
      ...options,
      enableCompression: options.enableCompression !== false,
      enableCaching: options.enableCaching !== false,
      enableRateLimit: options.enableRateLimit !== false,
      enableMonitoring: options.enableMonitoring !== false,
      enableLoadShedding: options.enableLoadShedding !== false,
      enableSecurityHeaders: options.enableSecurityHeaders || false,
      enableNoStore: options.enableNoStore || false,
      // Seguridad: las rutas /velocity/* quedan deshabilitadas salvo que se
      // configure enableAdminRoutes o se pase adminMiddleware.
      enableAdminRoutes: Boolean(options.enableAdminRoutes || options.adminMiddleware),
      cacheKeyGenerator: options.cacheKeyGenerator || null,
      adminMiddleware: options.adminMiddleware || null,
    };

    this.memory = new RequestTracker(this.options);
    this.loadShedder = new LoadShedder(this.options);
    this.cache = new CacheEngine(this.options, null);
    this.compression = new CompressionEngine(this.options, this.loadShedder);
    this.rateLimit = new RateLimiter(this.options);
    this.monitoring = new MonitoringSystem(this.options);
    this.optimization = new OptimizationMiddleware(this.options);

    if (process.env.REDIS_URL) this.redisInit = this._initRedis(process.env.REDIS_URL);
  }

  async _initRedis(url) {
    try {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(url, { maxRetriesPerRequest: 1, retryStrategy: () => null });
      client.on('error', () => {});
      this.cache.redis = client;
    } catch (_) {}
  }

  initializeMiddleware(app) {
    // Los headers se aplican ANTES del cache para que las respuestas
    // servidas desde cache (HIT) también los reciban.
    if (this.options.enableLoadShedding) app.use(this.loadShedder.middleware());
    if (this.options.enableMonitoring) app.use(this.monitoring.middleware());
    if (this.options.enableCompression) app.use(this.compression.middleware());
    if (this.options.enableRateLimit) app.use(this.rateLimit.middleware());
    app.use(this.optimization.middleware());
    if (this.options.enableCaching) app.use(this.cache.middleware());
    return app;
  }

  async getStats() {
    return {
      memory: this.memory.getStats(),
      loadShedding: this.loadShedder.getStats(),
      cache: this.cache.getStats(),
      compression: this.compression.getStats(),
      rateLimit: this.rateLimit.getStats(),
      monitoring: this.monitoring.getStats(),
      timestamp: new Date().toISOString(),
    };
  }

  async getHealth() {
    const stats = await this.getStats();
    const mem = process.memoryUsage();
    const heapPercentage = (mem.heapUsed / mem.heapTotal) * 100;

    return {
      status: this.loadShedder.isOverloaded ? 'critical' : (heapPercentage > 80 ? 'warning' : 'healthy'),
      uptime: this.formatUptime(process.uptime()),
      memory: {
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
        heapPercentage: `${heapPercentage.toFixed(2)}%`,
      },
      stats,
    };
  }

  async clearCache() { return this.cache.clear(); }

  forceGC() {
    if (global.gc) {
      global.gc();
      return { message: '✅ Garbage Collection ejecutado exitosamente' };
    }
    return { message: '⚠️ GC no disponible. Ejecuta: node --expose-gc server.js' };
  }

  formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
}

export default PerformanceManager;

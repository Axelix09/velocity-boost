class MonitoringSystem {
  constructor(options = {}) {
    this.options = options;
    this.metrics = [];
    this.maxMetrics = options.monitoringMaxMetrics || 10000;
    this.alerts = [];
  }

  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const startMem = process.memoryUsage().heapUsed;

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const memDelta = process.memoryUsage().heapUsed - startMem;

        this.recordMetric({
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration,
          memoryDelta: Math.round(memDelta / 1024),
          timestamp: new Date().toISOString(),
        });
      });

      next();
    };
  }

  recordMetric(metric) {
    this.metrics.push(metric);
    // shift() es O(1) amortizado; el slice anterior copiaba el array
    // completo (hasta 10k entradas) en cada request.
    if (this.metrics.length > this.maxMetrics) this.metrics.shift();
  }

  getStats() {
    if (this.metrics.length === 0) {
      return { message: 'Sin métricas registradas aún' };
    }

    const avgDuration = Math.round(
      this.metrics.reduce((sum, m) => sum + m.duration, 0) / this.metrics.length
    );

    const slowestEndpoints = [...this.metrics]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5)
      .map((m) => ({ path: m.path, duration: m.duration, status: m.status }));

    return {
      totalMetrics: this.metrics.length,
      avgDuration,
      slowestEndpoints,
    };
  }

  getRecentMetrics(limit = 100) {
    return this.metrics.slice(-limit).reverse();
  }
}

export default MonitoringSystem;

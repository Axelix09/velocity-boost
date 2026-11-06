import { monitorEventLoopDelay } from 'perf_hooks';

class LoadShedder {
  constructor(options = {}) {
    this.maxEventLoopLag = options.maxEventLoopLag || 70;
    this.loadThreshold = options.loadThreshold || 0.9;
    this.lagCheckInterval = options.lagCheckInterval || 1000;

    // Histograma de delay del event loop (en nanosegundos).
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();
    this.currentLag = 0;
    this.consecutiveBreaches = 0;
    this.status = 'HEALTHY';
    this.stats = { checked: 0, breaches: 0, meanLagMs: 0 };

    this.lagInterval = setInterval(() => {
      // Se usa el percentil 99.9 en lugar del promedio: la media amortigua
      // los picos puntuales y no detecta sobrecargas transitorias.
      const lagMs = this.histogram.percentile(99.9) / 1e6;
      this.histogram.reset();
      this.currentLag = lagMs;
      this.stats.checked++;
      this.stats.meanLagMs = Number(((this.stats.meanLagMs * (this.stats.checked - 1) + lagMs) / this.stats.checked).toFixed(2));

      if (lagMs > this.maxEventLoopLag) {
        this.consecutiveBreaches++;
        this.stats.breaches++;
        this.status = 'OVERLOADED';
        this.triggeredAt = Date.now();
      } else if (this.status === 'OVERLOADED' && lagMs < this.maxEventLoopLag / 2) {
        this.consecutiveBreaches = 0;
        this.status = 'HEALTHY';
      }
    }, this.lagCheckInterval);
    this.lagInterval.unref();
  }

  shouldShed() {
    return this.status === 'OVERLOADED';
  }

  getStats() {
    return {
      currentLagMs: Number(this.currentLag.toFixed(2)),
      maxAllowedLagMs: this.maxEventLoopLag,
      status: this.status,
      ...this.stats,
    };
  }

  stop() {
    if (this.lagInterval) clearInterval(this.lagInterval);
    this.histogram.disable();
  }
}

export default LoadShedder;

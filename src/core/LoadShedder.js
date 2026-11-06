import { monitorEventLoopDelay } from 'perf_hooks';

class LoadShedder {
  constructor(options = {}) {
    this.maxEventLoopLag = options.maxEventLoopLag || 70;
    this.checkInterval = options.lagCheckInterval || 500;
    this.currentLag = 0;
    this.isOverloaded = false;
    this._startMonitoring();
  }

  _startMonitoring() {
    // monitorEventLoopDelay mide el delay real del event loop (bloqueos),
    // a diferencia del diff de reloj con setInterval, que solo aproxima.
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();

    this._timer = setInterval(() => {
      // Se usa el percentil 99.9 en lugar del promedio: la media amortigua
      // los picos puntuales y no detecta sobrecargas transitorias.
      const samples = this.histogram.count;
      this.currentLag = samples > 0 ? Math.round(this.histogram.percentile(99.9) / 1e6) : 0;
      this.histogram.reset();
      this.isOverloaded = this.currentLag > this.maxEventLoopLag;
    }, this.checkInterval);
    this._timer.unref();
  }

  middleware() {
    return (req, res, next) => {
      if (this.isOverloaded && !req.path.startsWith('/velocity')) {
        res.setHeader('Retry-After', '5');
        return res.status(503).json({
          status: false,
          message: "Servidor temporalmente sobrecargado. Reintentar en breve."
        });
      }
      next();
    };
  }

  getStats() {
    return {
      currentLagMs: this.currentLag,
      status: this.isOverloaded ? 'OVERLOADED' : 'HEALTHY',
      maxAllowedLagMs: this.maxEventLoopLag
    };
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this.histogram.disable();
  }
}

export default LoadShedder;

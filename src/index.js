import PerformanceManager from './core/PerformanceManager.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class VelocityBoost extends PerformanceManager {
  constructor(options = {}) {
    super(options);
    this._publicDir = join(dirname(__dirname), 'public');
  }

  initializeMiddleware(app) {
    super.initializeMiddleware(app);
    this.initializeRoutes(app);
    return app;
  }

  initializeRoutes(app) {
    // Seguridad: las rutas /velocity/* quedan deshabilitadas por defecto.
    // Sin esto, cualquiera podria ver metricas, limpiar el cache o forzar GC.
    if (!this.options.enableAdminRoutes) return app;

    const auth = this.options.adminMiddleware || ((req, res, next) => next());

    app.use('/velocity', auth);

    app.get('/velocity/dashboard', async (req, res) => {
      try {
        const html = await readFile(join(this._publicDir, 'dashboard.html'), 'utf-8');
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      } catch (e) {
        // No filtrar detalles del error al cliente.
        console.error('VelocityBoost: error sirviendo dashboard:', e.message);
        res.status(500).json({ error: 'Dashboard no disponible' });
      }
    });

    app.get('/velocity/health', async (req, res) => {
      res.json(await this.getHealth());
    });

    app.get('/velocity/stats', async (req, res) => {
      res.json(await this.getStats());
    });

    app.get('/velocity/metrics', (req, res) => {
      const limit = parseInt(req.query.limit) || 50;
      res.json({ limit, count: this.monitoring.metrics.length, metrics: this.monitoring.getRecentMetrics(limit) });
    });

    app.post('/velocity/cache/clear', async (req, res) => {
      const result = await this.clearCache();
      res.json({ message: 'Cache limpiado', cleared: result.cleared, type: result.type });
    });

    app.post('/velocity/gc', (req, res) => {
      res.json(this.forceGC());
    });

    return app;
  }
}

export default VelocityBoost;

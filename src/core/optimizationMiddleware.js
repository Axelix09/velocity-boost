class OptimizationMiddleware {
  constructor(options = {}) {
    this.enableSecurityHeaders = options.enableSecurityHeaders || false;
    this.enableNoStore = options.enableNoStore || false;
  }

  middleware() {
    return (req, res, next) => {
      if (this.enableSecurityHeaders) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      }

      // Opt-in: enviar Cache-Control: no-store a todo contradice el
      // propósito del paquete, así que solo se envia si se pide.
      if (this.enableNoStore) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }

      next();
    };
  }
}

export default OptimizationMiddleware;

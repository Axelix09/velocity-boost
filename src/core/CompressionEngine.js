import compression from 'compression';

class CompressionEngine {
  constructor(options = {}, loadShedder = null) {
    this.options = options;
    this.loadShedder = loadShedder;
    this.compressedResponses = 0;
    this.bytesOriginal = 0;
    this.bytesCompressed = 0;

    this.highComp = compression({ level: 9, threshold: 1024 });
    this.lowComp = compression({ level: 4, threshold: 2048 });
  }

  middleware() {
    return (req, res, next) => {
      if (req.originalUrl.includes('/stream')) return next();

      const originalSend = res.send;
      res.send = function (body) {
        if (body && !req._originalSize) {
          try { req._originalSize = Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)); }
          catch (e) { req._originalSize = 0; }
        }
        originalSend.call(this, body);
      };

      res.on('finish', () => {
        const enc = res.getHeader('Content-Encoding');
        if (enc && (enc.includes('gzip') || enc.includes('br') || enc.includes('deflate'))) {
          this.compressedResponses++;
          const original = req._originalSize || 0;
          const compressed = Number(res.getHeader('Content-Length')) || 0;
          if (original > 0 && compressed > 0) {
            this.bytesOriginal += original;
            this.bytesCompressed += compressed;
          }
        }
      });

      if (this.loadShedder && this.loadShedder.currentLag > (this.loadShedder.maxEventLoopLag / 2)) {
        return this.lowComp(req, res, next);
      }

      this.highComp(req, res, next);
    };
  }

  getStats() {
    const saved = Math.max(0, this.bytesOriginal - this.bytesCompressed);
    const percentage = this.bytesOriginal > 0 ? ((saved / this.bytesOriginal) * 100).toFixed(2) : 0;
    return {
      compressedResponses: this.compressedResponses,
      bytesOriginal: this.bytesOriginal,
      bytesCompressed: this.bytesCompressed,
      bytesSaved: saved,
      compressionRatio: `${percentage}%`,
      currentMode: (this.loadShedder && this.loadShedder.currentLag > (this.loadShedder.maxEventLoopLag / 2)) ? 'LOW_CPU_MODE' : 'MAX_COMPRESSION'
    };
  }
}

export default CompressionEngine;

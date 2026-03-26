import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FingerprintHelper } from './Fingerprint.js';

export interface RateLimitOptions {
  windowMs?: number; // 默认 60 秒
  maxRequests?: number; // 默认 30 次
  excludePaths?: string[]; // 排除路径
  fingerprintHeaders?: string[]; // 用于计算指纹的请求头
}

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

export class FingerprintRateLimiter {
  private static store = new Map<string, RateLimitInfo>();
  private static options: Required<RateLimitOptions>;

  static init(options: RateLimitOptions = {}) {
    this.options = {
      windowMs: options.windowMs || 60000,
      maxRequests: options.maxRequests || 30,
      excludePaths: options.excludePaths || ['/static', '/favicon.ico', '/'],
      fingerprintHeaders: options.fingerprintHeaders || ['user-agent', 'x-fingerprint'],
    };

    // 定期清理过期的记录
    setInterval(() => {
      const now = Date.now();
      for (const [key, info] of this.store.entries()) {
        if (now > info.resetTime) {
          this.store.delete(key);
        }
      }
    }, Math.min(this.options.windowMs, 60000));
  }

  static getMiddleware() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // 排除不需要限制的路径
      if (this.options.excludePaths.some(path => request.url.startsWith(path))) {
        return;
      }

      const fingerprint = FingerprintHelper.getFingerprint(request);
      const now = Date.now();
      let info = this.store.get(fingerprint);

      if (!info || now > info.resetTime) {
        info = {
          count: 1,
          resetTime: now + this.options.windowMs,
        };
      } else {
        info.count++;
      }

      this.store.set(fingerprint, info);

      // 设置响应头
      const remaining = Math.max(0, this.options.maxRequests - info.count);
      reply.header('X-RateLimit-Limit', this.options.maxRequests);
      reply.header('X-RateLimit-Remaining', remaining);
      reply.header('X-RateLimit-Reset', Math.ceil(info.resetTime / 1000));

      if (info.count > this.options.maxRequests) {
        request.log.warn({ fingerprint, url: request.url }, 'Rate limit exceeded');
        reply.status(429).send({
          success: false,
          error: 'Too Many Requests',
          message: '请求过于频繁，请稍后再试。',
          retryAfter: Math.ceil((info.resetTime - now) / 1000),
        });
        return reply;
      }
    };
  }
}

import { FastifyRequest } from 'fastify';

export class FingerprintHelper {
  /**
   * 获取请求的唯一指纹标识
   * 优先使用 X-Fingerprint 请求头，回退到 IP + User-Agent
   */
  static getFingerprint(request: FastifyRequest): string {
    const xFingerprint = request.headers['x-fingerprint'] as string;
    if (xFingerprint) return xFingerprint;

    // 如果没有 X-Fingerprint，回退到 IP + User-Agent
    const ip = request.ip || 'unknown';
    const userAgent = (request.headers['user-agent'] as string) || 'unknown';
    
    // 移除可能存在的特殊字符，确保指纹格式整洁
    return `${ip}:${userAgent}`.replace(/\s+/g, '');
  }
}

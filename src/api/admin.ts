import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function adminRoutes(fastify: FastifyInstance) {
  const SECRET = process.env.JWT_SECRET || process.env.KB_PASSWORD || 'hex2077-secret-key';

  const checkAuth = async (request: any, reply: any) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      reply.status(401).send({ error: 'Missing authorization header' });
      return;
    }

    try {
      const token = authHeader.replace('Bearer ', '');
      jwt.verify(token, SECRET);
    } catch (err) {
      reply.status(401).send({ error: 'Invalid or expired token' });
      return;
    }
  };

  fastify.post('/admin/reload', { preHandler: checkAuth }, async (request, reply) => {
    try {
      // Reload .env file
      const envPath = path.join(process.cwd(), '.env');
      const result = config({ path: envPath, override: true });
      
      if (result.error) {
        throw result.error;
      }

      fastify.log.info('Environment variables reloaded');
      return { success: true, message: 'Configuration reloaded successfully' };
    } catch (err: any) {
      fastify.log.error({ error: err.message }, 'Failed to reload environment variables');
      reply.status(500).send({ success: false, error: err.message });
    }
  });
}

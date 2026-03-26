import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export class ErrorHandler {
  static setup(fastify: FastifyInstance) {
    fastify.setErrorHandler((error: any, request: any, reply: any) => {
      fastify.log.error({ 
        err: error, 
        requestId: request.id,
        method: request.method,
        url: request.url,
        body: request.body
      }, 'Global error handler caught an error');

      if (error.validation) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          details: error.validation
        });
      }

      if (error.statusCode) {
        return reply.status(error.statusCode).send({
          success: false,
          error: error.message
        });
      }

      return reply.status(500).send({
        success: false,
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    });

    fastify.setNotFoundHandler((request, reply) => {
      reply.status(404).send({
        success: false,
        error: 'Not Found',
        message: `Route ${request.method} ${request.url} not found`
      });
    });
  }
}

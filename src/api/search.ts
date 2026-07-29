import { Router, Request, Response, NextFunction } from "express";
import { SearchService } from "../services/search.service.js";
import { ContextBuilderService } from "../services/context-builder.service.js";
import { validatePayload } from "../middlewares/validation.middleware.js";
import { logger } from "../services/logger.service.js";

const router = Router();

/**
 * POST /search
 * Performs semantic search and context building.
 */
router.post(
  "/",
  validatePayload({
    query: "string",
    topK: "number",
    scoreThreshold: "number",
    filters: "object",
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    const requestId = req.headers["x-request-id"] as string;

    try {
      const { query, topK, scoreThreshold, filters } = req.body;

      if (!query || typeof query !== "string" || query.trim() === "") {
        const duration = parseFloat((performance.now() - start).toFixed(2));
        logger.warn("[ADMIN] Falha na validação da busca: query vazia", {
          requestId,
          duration,
          status: "error",
        });

        return res.status(400).json({
          success: false,
          error: "O campo 'query' é obrigatório e deve ser uma string não vazia.",
        });
      }

      // Perform vector search
      const results = await SearchService.search(
        query,
        topK,
        scoreThreshold,
        filters
      );

      // Build context
      const context = ContextBuilderService.buildContext(results);

      const duration = parseFloat((performance.now() - start).toFixed(2));
      logger.info("[ADMIN] Busca semântica executada com sucesso", {
        requestId,
        duration,
        status: "success",
        query: "[REDACTED]",
      });

      return res.json({
        query,
        results,
        context,
      });
    } catch (error) {
      const duration = parseFloat((performance.now() - start).toFixed(2));
      logger.error("[ADMIN] Falha ao executar busca semântica", error, {
        requestId,
        duration,
        status: "error",
      });
      next(error);
    }
  }
);

export default router;

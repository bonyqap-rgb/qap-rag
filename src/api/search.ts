import { Router, Request, Response, NextFunction } from "express";
import { SearchService } from "../services/search.service.js";
import { ContextBuilderService } from "../services/context-builder.service.js";

const router = Router();

/**
 * POST /search
 * Performs semantic search and context building.
 */
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query, topK, scoreThreshold, filters } = req.body;

    if (!query || typeof query !== "string" || query.trim() === "") {
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

    return res.json({
      query,
      results,
      context,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

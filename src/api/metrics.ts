import { Router, Request, Response, NextFunction } from "express";
import { metricsService } from "../services/metrics.service.js";
import { supabase } from "../config/supabase.js";

const router = Router();

/**
 * GET /metrics
 * Returns comprehensive observability, application performance and system metrics.
 */
router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Dynamically retrieve the total number of indexed documents from knowledge_documents table
    let indexedDocsCount = 0;
    try {
      const { count, error } = await supabase
        .from("knowledge_documents")
        .select("*", { count: "exact", head: true });

      if (!error && count !== null) {
        indexedDocsCount = count;
      }
    } catch (err) {
      // Fail silently, maintaining count as 0 to keep endpoint highly available
    }

    const metrics = metricsService.getMetrics();

    return res.status(200).json({
      uptime: metrics.uptime,
      versao: metrics.versao,
      ambiente: metrics.ambiente,
      memoria_utilizada: metrics.memoriaUtilizada,
      uso_cpu: metrics.usoCpu,
      tempo_medio_requisicoes_ms: metrics.tempoMedioRequisicoesMs,
      numero_total_requisicoes: metrics.numeroTotalRequisicoes,
      quantidade_erros: metrics.quantidadeErros,
      quantidade_chats_executados: metrics.quantidadeChatsExecutados,
      quantidade_buscas_rag: metrics.quantidadeBuscasRAG,
      quantidade_documentos_indexados: indexedDocsCount,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

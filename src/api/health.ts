import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";

const router = Router();

/**
 * GET /health
 * Extremely lightweight and fast check to verify the process is alive.
 */
router.get("/health", (_, res) => {
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * GET /ready
 * Deep readiness probe to check external integrations and essential configurations.
 */
router.get("/ready", async (_, res) => {
  const readinessDetails: {
    status: "ok" | "error";
    database: { status: "ok" | "error"; message?: string };
    pgvector: { status: "ok" | "error"; message?: string };
    config: { status: "ok" | "error"; message?: string };
    google_api: { status: "ok" | "error"; message?: string };
    openrouter_api: { status: "ok" | "error"; message?: string };
  } = {
    status: "ok",
    database: { status: "ok" },
    pgvector: { status: "ok" },
    config: { status: "ok" },
    google_api: { status: "ok" },
    openrouter_api: { status: "ok" },
  };

  // 1. Verify environment configs
  const missingConfigs = [];
  if (!env.SUPABASE_URL) missingConfigs.push("SUPABASE_URL");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missingConfigs.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!env.GOOGLE_API_KEY) missingConfigs.push("GOOGLE_API_KEY");
  if (!env.OPENROUTER_API_KEY) missingConfigs.push("OPENROUTER_API_KEY");

  if (missingConfigs.length > 0) {
    readinessDetails.status = "error";
    readinessDetails.config = {
      status: "error",
      message: `Configurações obrigatórias ausentes: ${missingConfigs.join(", ")}`,
    };
  }

  // 2. Verify Google GenAI API Key availability
  if (!env.GOOGLE_API_KEY || env.GOOGLE_API_KEY === "dummy_key") {
    readinessDetails.google_api = {
      status: "error",
      message: "GOOGLE_API_KEY ausente ou configurado com chave dummy",
    };
    if (env.NODE_ENV === "production") {
      readinessDetails.status = "error";
    }
  }

  // 3. Verify OpenRouter API Key availability
  if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY === "dummy_key") {
    readinessDetails.openrouter_api = {
      status: "error",
      message: "OPENROUTER_API_KEY ausente ou configurado com chave dummy",
    };
    if (env.NODE_ENV === "production") {
      readinessDetails.status = "error";
    }
  }

  // 4. Verify Supabase Database connection & pgvector RPC match_documents
  try {
    const { error: dbError } = await supabase
      .from("knowledge_documents")
      .select("id")
      .limit(1);

    if (dbError) {
      readinessDetails.status = "error";
      readinessDetails.database = {
        status: "error",
        message: `Erro na consulta do banco de dados: ${dbError.message}`,
      };
    }
  } catch (error: any) {
    readinessDetails.status = "error";
    readinessDetails.database = {
      status: "error",
      message: `Falha ao tentar se conectar ao Supabase: ${error.message || error}`,
    };
  }

  // 5. Verify pgvector (RPC match_documents with a zero embedding vector)
  try {
    const dummyEmbedding = new Array(1536).fill(0); // Standard length or just empty array
    const { error: rpcError } = await supabase.rpc("match_documents", {
      query_embedding: dummyEmbedding,
      match_count: 1,
    });

    if (rpcError) {
      if (rpcError.message.includes("does not exist")) {
        readinessDetails.status = "error";
        readinessDetails.pgvector = {
          status: "error",
          message: `Função match_documents RPC não existe no banco de dados.`,
        };
      } else {
        readinessDetails.status = "error";
        readinessDetails.pgvector = {
          status: "error",
          message: `Erro ao executar a função match_documents pgvector: ${rpcError.message}`,
        };
      }
    }
  } catch (error: any) {
    readinessDetails.status = "error";
    readinessDetails.pgvector = {
      status: "error",
      message: `Falha de rede/RPC ao validar pgvector: ${error.message || error}`,
    };
  }

  const responseStatus = readinessDetails.status === "ok" ? 200 : 503;
  return res.status(responseStatus).json(readinessDetails);
});

export default router;

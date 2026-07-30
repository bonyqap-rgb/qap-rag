import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";

const router = Router();

/**
 * GET /health
 * Fast check to verify process is alive and external systems are reachable.
 */
router.get("/health", async (_, res) => {
  let databaseStatus = "connected";
  try {
    const { error } = await supabase
      .from("knowledge_documents")
      .select("id")
      .limit(1);

    if (error) {
      databaseStatus = "disconnected";
    }
  } catch (err) {
    databaseStatus = "disconnected";
  }

  const isDummy = env.GROQ_API_KEY === "dummy_key";
  const isProd = env.NODE_ENV === "production";
  const groqStatus = (env.GROQ_API_KEY && (!isProd || !isDummy)) ? "connected" : "disconnected";

  const isOk = databaseStatus === "connected" && groqStatus === "connected";

  return res.status(isOk ? 200 : 503).json({
    status: isOk ? "ok" : "error",
    version: "1.0",
    database: databaseStatus,
    groq: groqStatus,
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
    groq_api: { status: "ok" | "error"; message?: string };
  } = {
    status: "ok",
    database: { status: "ok" },
    pgvector: { status: "ok" },
    config: { status: "ok" },
    groq_api: { status: "ok" },
  };

  // 1. Verify environment configs
  const missingConfigs = [];
  if (!env.SUPABASE_URL) missingConfigs.push("SUPABASE_URL");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missingConfigs.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!env.GROQ_API_KEY) missingConfigs.push("GROQ_API_KEY");

  if (missingConfigs.length > 0) {
    readinessDetails.status = "error";
    readinessDetails.config = {
      status: "error",
      message: `Configurações obrigatórias ausentes: ${missingConfigs.join(", ")}`,
    };
  }

  // 2. Verify Groq API Key availability
  if (!env.GROQ_API_KEY || env.GROQ_API_KEY === "dummy_key") {
    const errorDetails = {
      status: "error" as const,
      message: "GROQ_API_KEY ausente ou configurado com chave dummy",
    };
    readinessDetails.groq_api = errorDetails;
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

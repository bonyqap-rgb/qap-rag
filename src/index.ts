import express from "express";
import cors from "cors";
import { Server } from "http";

import { env } from "./config/env.js";
import { supabase } from "./config/supabase.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { logger } from "./services/logger.service.js";
import uploadRouter from "./api/upload.js";
import chatRouter from "./api/chat.js";
import documentsRouter from "./api/documents.js";
import searchRouter from "./api/search.js";

// 1. Startup Logging - Environment validation confirmation
logger.info(`[STARTUP] Variáveis de ambiente validadas com sucesso. Ambiente: ${env.NODE_ENV}`);

// 2. Startup Logging - Gemini initialization check
if (env.GOOGLE_API_KEY) {
  logger.info("[STARTUP] Gemini SDK inicializado e pronto.");
} else {
  logger.warn("[STARTUP] Alerta: GOOGLE_API_KEY não foi configurado.");
}

// 3. Startup Logging - Supabase connection check
if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  logger.info("[STARTUP] Cliente Supabase inicializado e pronto.");
} else {
  logger.warn("[STARTUP] Alerta: Credenciais do Supabase não configuradas.");
}

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: "10mb",
  })
);

// Middleware de Logs de requisições estruturado
app.use((req, _, next) => {
  logger.info(`[REQUEST] ${req.method} ${req.originalUrl}`, {
    method: req.method,
    route: req.originalUrl,
  });
  next();
});

// Página temporária para testar upload pelo navegador
app.get("/upload-test", (_, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Teste Upload PDF</title>
<style>
body{
    font-family:Arial;
    max-width:700px;
    margin:60px auto;
}
button{
    padding:10px 18px;
    cursor:pointer;
}
</style>
</head>

<body>

<h2>QAP RAG - Teste de Upload</h2>

<form
    action="/upload"
    method="POST"
    enctype="multipart/form-data"
>

<input
    type="file"
    name="file"
    accept=".pdf"
    required
/>

<br><br>

<button type="submit">
Enviar PDF
</button>

</form>

</body>
</html>
`);
});

// Endpoint de teste
app.post("/teste", (req, res) => {
  logger.info("BODY RECEBIDO via endpoint de teste");
  res.json({
    success: true,
    body: req.body,
  });
});

app.use("/upload", uploadRouter);
app.use("/chat", chatRouter);
app.use("/documents", documentsRouter);
app.use("/search", searchRouter);

// Enhanced /health endpoint according to requirements
app.get("/health", async (_, res) => {
  let databaseConnected = false;
  let dbErrorMsg: string | null = null;

  try {
    const { error } = await supabase
      .from("knowledge_documents")
      .select("id")
      .limit(1);

    if (error) {
      dbErrorMsg = error.message;
    } else {
      databaseConnected = true;
    }
  } catch (error) {
    dbErrorMsg = error instanceof Error ? error.message : String(error);
  }

  const healthData = {
    serviceName: "qap-rag",
    version: "1.0.0",
    status: databaseConnected ? "ok" : "error",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    supabase: {
      connected: databaseConnected,
      error: dbErrorMsg,
    },
  };

  const responseStatus = databaseConnected ? 200 : 500;
  return res.status(responseStatus).json(healthData);
});

// Global error handling middleware
app.use(errorHandler);

const PORT = env.PORT;

const server: Server = app.listen(PORT, () => {
  logger.info(`[STARTUP] QAP RAG ativo e escutando na porta: ${PORT}`);
});

// Graceful Shutdown implementation
function handleGracefulShutdown(signal: string) {
  logger.info(`[SHUTDOWN] Recebido sinal ${signal}. Iniciando encerramento gracioso...`);

  server.close(() => {
    logger.info("[SHUTDOWN] Servidor Express encerrado com sucesso.");
    process.exit(0);
  });

  // Timeout de fallback para evitar travar o processo
  setTimeout(() => {
    logger.warn("[SHUTDOWN] Forçando término após timeout de segurança de 10s.");
    process.exit(1);
  }, 10000);
}

process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));

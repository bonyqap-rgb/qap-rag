import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server } from "http";

import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { logger } from "./services/logger.service.js";
import uploadRouter from "./api/upload.js";
import chatRouter from "./api/chat.js";
import documentsRouter from "./api/documents.js";
import searchRouter from "./api/search.js";
import healthRouter from "./api/health.js";
import metricsRouter from "./api/metrics.js";

// Middlewares
import { requestLogger } from "./middlewares/request-logger.middleware.js";
import { chatRateLimiter, searchRateLimiter, indexRateLimiter } from "./middlewares/rate-limit.middleware.js";

// 1. Startup Logging - Environment validation confirmation
logger.info(`[STARTUP] Variáveis de ambiente validadas com sucesso. Ambiente: ${env.NODE_ENV}`);

// 2. Startup Logging - Groq initialization check
if (env.GROQ_API_KEY) {
  logger.info("[STARTUP] Groq SDK inicializado e pronto.");
} else {
  logger.warn("[STARTUP] Alerta: GROQ_API_KEY não foi configurado.");
}

// 3. Startup Logging - Supabase connection check
if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  logger.info("[STARTUP] Cliente Supabase inicializado e pronto.");
} else {
  logger.warn("[STARTUP] Alerta: Credenciais do Supabase não configuradas.");
}

const app = express();

// Set HTTP Security headers using helmet
app.use(helmet());

// CORS configuration supporting ALLOWED_ORIGINS env variable and default fallback
const allowedOrigins = env.ALLOWED_ORIGINS;
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);

      // Check if origin is allowed, or allow all in development / test environments
      if (
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(origin) ||
        env.NODE_ENV !== "production"
      ) {
        return callback(null, true);
      }

      return callback(new Error("Não permitido pelo CORS"), false);
    },
    credentials: true,
  })
);

// Max payload limit
app.use(
  express.json({
    limit: "10mb",
  })
);

// Apply Standardized JSON HTTP request logging
app.use(requestLogger);

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

// Health router endpoints (contains /health and /ready)
app.use("/", healthRouter);

// Apply Rate Limiters to specific endpoints
app.use("/upload", indexRateLimiter, uploadRouter);
app.use("/chat", chatRateLimiter, chatRouter);
app.use("/documents", indexRateLimiter, documentsRouter);
app.use("/search", searchRateLimiter, searchRouter);
app.use("/metrics", metricsRouter);

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

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server } from "http";

import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { logger } from "./services/logger.service.js";
import uploadRouter from "./api/upload.js";
import chatRouter from "./api/chat.js";
import documentsRouter, { documentService } from "./api/documents.js";
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

// Página administrativa para gerenciamento e reindexação completa
app.get("/admin", (_, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>QAP IA - Painel de Controle Administrativo</title>
  <style>
    :root {
      --bg-color: #0f172a;
      --card-bg: #1e293b;
      --accent-color: #3b82f6;
      --accent-hover: #2563eb;
      --text-color: #f8fafc;
      --text-muted: #94a3b8;
      --border-color: #334155;
      --success-color: #10b981;
      --error-color: #ef4444;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-color);
      margin: 0;
      padding: 40px 20px;
      display: flex;
      justify-content: center;
    }
    .container {
      max-width: 800px;
      width: 100%;
    }
    header {
      margin-bottom: 30px;
      text-align: center;
    }
    h1 {
      margin: 0 0 10px 0;
      font-size: 2.2rem;
      font-weight: 800;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.subtitle {
      color: var(--text-muted);
      margin: 0;
      font-size: 1.1rem;
    }
    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
      margin-bottom: 25px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: var(--text-color);
    }
    input[type="password"] {
      width: 100%;
      padding: 12px;
      background-color: #0f172a;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-color);
      font-size: 1rem;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: var(--accent-color);
    }
    .btn {
      background-color: var(--accent-color);
      color: #fff;
      border: none;
      padding: 14px 28px;
      font-size: 1rem;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      transition: background-color 0.2s, transform 0.1s;
    }
    .btn:hover {
      background-color: var(--accent-hover);
    }
    .btn:active {
      transform: scale(0.99);
    }
    .btn:disabled {
      background-color: var(--border-color);
      color: var(--text-muted);
      cursor: not-allowed;
    }
    .console {
      background-color: #020617;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
      padding: 20px;
      min-height: 150px;
      max-height: 300px;
      overflow-y: auto;
      margin-top: 20px;
      box-sizing: border-box;
    }
    .console-line {
      margin-bottom: 6px;
      line-height: 1.4;
      font-size: 0.9rem;
    }
    .line-info { color: #60a5fa; }
    .line-success { color: var(--success-color); }
    .line-error { color: var(--error-color); }
    .line-text { color: var(--text-color); }
    .line-muted { color: var(--text-muted); }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 25px;
    }
    .stat-card {
      background-color: #0f172a;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 15px;
      text-align: center;
    }
    .stat-num {
      font-size: 1.8rem;
      font-weight: 700;
      color: var(--accent-color);
      margin-bottom: 4px;
    }
    .stat-label {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .hidden { display: none; }
  </style>
</head>
<body>

<div class="container">
  <header>
    <h1>QAP IA</h1>
    <p class="subtitle">Painel de Controle Administrativo</p>
  </header>

  <div class="card">
    <div class="form-group">
      <label for="adminKey">Chave de Administração (SUPABASE_SERVICE_ROLE_KEY)</label>
      <input type="password" id="adminKey" placeholder="Insira a chave secreta de administração..." required />
    </div>

    <button id="reindexBtn" class="btn">
      Regenerar Embeddings (Reindexação Completa)
    </button>

    <div class="stats-grid hidden" id="statsGrid">
      <div class="stat-card">
        <div class="stat-num" id="statDocs">0</div>
        <div class="stat-label">Documentos</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" id="statChunks">0</div>
        <div class="stat-label">Chunks Criados</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" id="statTime">0ms</div>
        <div class="stat-label">Tempo Gasto</div>
      </div>
    </div>

    <div class="console" id="console">
      <div class="console-line line-muted">[SISTEMA] Pronto para execução. Aguardando interação...</div>
    </div>
  </div>
</div>

<script>
  const adminKeyInput = document.getElementById('adminKey');
  const reindexBtn = document.getElementById('reindexBtn');
  const consoleElem = document.getElementById('console');
  const statsGrid = document.getElementById('statsGrid');
  const statDocs = document.getElementById('statDocs');
  const statChunks = document.getElementById('statChunks');
  const statTime = document.getElementById('statTime');

  function log(text, type = 'text') {
    const line = document.createElement('div');
    line.className = 'console-line line-' + type;

    const timestamp = new Date().toLocaleTimeString();
    line.innerText = '[' + timestamp + '] ' + text;

    consoleElem.appendChild(line);
    consoleElem.scrollTop = consoleElem.scrollHeight;
  }

  reindexBtn.addEventListener('click', async () => {
    const key = adminKeyInput.value.trim();
    if (!key) {
      alert('Por favor, informe a Chave de Administração para prosseguir.');
      return;
    }

    // Prepare state
    reindexBtn.disabled = true;
    reindexBtn.innerHTML = '<span class="spinner"></span>Processando reindexação em lote...';
    statsGrid.classList.add('hidden');
    consoleElem.innerHTML = '';

    log('Iniciando processo de reindexação em lote de todos os documentos...', 'info');
    log('Enviando requisição segura para o backend...', 'muted');

    try {
      const response = await fetch('/admin/reindex-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': key
        }
      });

      if (response.status === 401) {
        log('ERRO: Chave de administração incorreta ou inválida.', 'error');
        alert('Chave de administração inválida. Acesso negado.');
        return;
      }

      if (!response.ok) {
        const errText = await response.text();
        log('ERRO NO BACKEND: ' + errText, 'error');
        alert('Ocorreu um erro ao processar a requisição no backend.');
        return;
      }

      const result = await response.json();

      if (result.success) {
        log('MIGRAÇÃO CONCLUÍDA COM SUCESSO!', 'success');
        log('Documentos processados: ' + result.documentsProcessed, 'success');
        log('Total de chunks reindexados: ' + result.chunksProcessed, 'success');
        log('Duração total: ' + result.durationMs + 'ms', 'info');

        statDocs.innerText = result.documentsProcessed;
        statChunks.innerText = result.chunksProcessed;
        statTime.innerText = result.durationMs + 'ms';
        statsGrid.classList.remove('hidden');
      } else {
        log('AVISO: Processamento concluído com alguns erros.', 'error');
        log('Documentos processados com sucesso: ' + result.documentsProcessed, 'info');
        if (result.errors && result.errors.length > 0) {
          result.errors.forEach(err => {
            log('FALHA no arquivo "' + err.filename + '": ' + err.error, 'error');
          });
        }

        statDocs.innerText = result.documentsProcessed;
        statChunks.innerText = result.chunksProcessed;
        statTime.innerText = result.durationMs + 'ms';
        statsGrid.classList.remove('hidden');
      }

    } catch (err) {
      log('ERRO DE REDE/DESCONHECIDO: ' + err.message, 'error');
      console.error(err);
    } finally {
      reindexBtn.disabled = false;
      reindexBtn.innerText = 'Regenerar Embeddings (Reindexação Completa)';
    }
  });
</script>

</body>
</html>
`);
});

// Endpoint de reindexação em massa administrativo
app.post("/admin/reindex-all", indexRateLimiter, async (req, res, next) => {
  const start = performance.now();
  const requestId = req.headers["x-request-id"] as string;

  // Protect endpoint
  const adminKey = req.headers["x-admin-key"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (!adminKey || adminKey !== env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      timestamp: new Date().toISOString(),
      message: "Acesso administrativo não autorizado. Token inválido ou ausente.",
      route: req.originalUrl || req.url,
      requestId
    });
  }

  try {
    const result = await documentService.reindexAllCompletedDocuments();
    const duration = parseFloat((performance.now() - start).toFixed(2));

    logger.info("[ADMIN] Reindexação em massa (/admin/reindex-all) de documentos concluída com sucesso", {
      requestId,
      duration,
      status: "success",
      documentsProcessed: result.documentsProcessed,
      chunksProcessed: result.chunksProcessed,
    });

    return res.status(200).json({
      success: result.success,
      documentsProcessed: result.documentsProcessed,
      chunksProcessed: result.chunksProcessed,
      durationMs: result.durationMs,
      errors: result.errors
    });
  } catch (error) {
    const duration = parseFloat((performance.now() - start).toFixed(2));
    logger.error("[ADMIN] Falha crítica na reindexação em massa (/admin/reindex-all)", error, {
      requestId,
      duration,
      status: "error",
    });
    next(error);
  }
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

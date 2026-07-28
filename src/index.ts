import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "http";

import { supabase } from "./config/supabase.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import uploadRouter from "./api/upload.js";
import chatRouter from "./api/chat.js";

dotenv.config();

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: "10mb",
  })
);

// Middleware para mostrar tudo que chega na API
app.use((req, _, next) => {
  console.log("====================================");
  console.log(`${req.method} ${req.originalUrl}`);
  console.log("Headers:");
  console.log(req.headers);
  console.log("====================================");
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
  console.log("BODY RECEBIDO:");
  console.log(req.body);

  res.json({
    success: true,
    body: req.body,
  });
});

app.use("/upload", uploadRouter);
app.use("/chat", chatRouter);

app.get("/health", async (_, res) => {
  try {
    const { error } = await supabase
      .from("knowledge_documents")
      .select("id")
      .limit(1);

    if (error) {
      return res.status(500).json({
        status: "error",
        message: error.message,
      });
    }

    return res.json({
      status: "ok",
      message: "Conectado ao Supabase com sucesso!",
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Registrar o middleware global de tratamento de erros
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

const server: Server = app.listen(PORT, () => {
  console.log(`🚀 QAP RAG rodando na porta ${PORT}`);
});

// Função para encerrar o servidor de forma graciosa (Graceful Shutdown)
function handleGracefulShutdown(signal: string) {
  console.log(`\n[SHUTDOWN] Recebido sinal ${signal}. Iniciando encerramento gracioso...`);

  server.close(() => {
    console.log("[SHUTDOWN] Conexões ativas fechadas. Servidor Express encerrado.");
    process.exit(0);
  });

  // Timeout forçado de segurança para evitar travar o processo indefinidamente
  setTimeout(() => {
    console.warn("[SHUTDOWN] Forçando saída após timeout de segurança.");
    process.exit(1);
  }, 10000);
}

// Configuração de ouvintes para encerramento gracioso
process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));

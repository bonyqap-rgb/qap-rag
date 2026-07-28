import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { supabase } from "./config/supabase.js";
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

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 QAP RAG rodando na porta ${PORT}`);
});
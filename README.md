# QAP RAG - Backend

<!-- Teste Jules -->

Este é o backend do QAP RAG, um sistema de Retrieval-Augmented Generation (RAG) desenvolvido em TypeScript/Node.js ES module utilizando Express e Supabase.

O projeto foi refatorado para padronizar e robustecer a **camada de API (Routing & Middlewares)**, centralizando o tratamento de erros e o registro de logs de requisições, mantendo a integridade absoluta das regras de negócio e de todas as assinaturas de rotas externas.

---

## 🛠️ Melhorias na Camada de API e Middlewares

Foram implementados novos componentes estruturais na camada HTTP da aplicação:

```
src/middlewares/
├── error.middleware.ts          # Middleware global para tratamento centralizado de erros
└── request-logger.middleware.ts # Registro estruturado de requisições HTTP recebidas
```

### 1. Tratamento Centralizado de Erros (`src/middlewares/error.middleware.ts`)
- Todas as rotas de API (`/upload`, `/chat`) agora encaminham erros de forma assíncrona para o middleware centralizado de tratamento de erros (`errorHandler`) utilizando o callback `next(error)`.
- O middleware captura e registra de forma detalhada o erro no terminal (incluindo `message`, `code`, `details`, `hint` e `stack trace`), respondendo ao cliente com um formato JSON limpo e padronizado exatamente compatível com o comportamento original:
  ```json
  {
    "success": false,
    "error": "Descrição do Erro"
  }
  ```

### 2. Registro Centralizado de Requisições (`src/middlewares/request-logger.middleware.ts`)
- Um middleware Express dedicado intercepta e formata as informações de requisições que chegam na API, gerando logs limpos contendo método, URL original e headers no terminal.

---

## 🚀 Como Executar

### Instalação das Dependências
```bash
npm ci
```

### Executar em Desenvolvimento (Watch Mode)
```bash
npm run dev
```

### Executar em Produção
```bash
npm run start
```

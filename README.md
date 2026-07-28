# QAP RAG - Backend

<!-- Teste Jules -->

Este é o backend do QAP RAG, um sistema de Retrieval-Augmented Generation (RAG) desenvolvido em TypeScript/Node.js ES module utilizando Express e Supabase.

---

## 🛠️ Tratamento de Erros Padronizado e Encerramento Gracioso

Para garantir a robustez de nível empresarial, foram adicionadas melhorias significativas no tratamento de erros da API e no ciclo de vida do servidor Express.

### 1. Esquema de Erros Unificado (`src/middlewares/error.middleware.ts`)
- Todas as rotas de API (`/upload`, `/chat`) agora encaminham exceções para o middleware centralizado de erros através do callback `next(error)`.
- O middleware intercepta os erros e retorna uma resposta JSON contendo o seguinte esquema estruturado:
  ```json
  {
    "error": "ERROR",
    "timestamp": "2026-07-28T16:32:00.000Z",
    "request": {
      "method": "POST",
      "headers": { ... },
      "body": { ... }
    },
    "stack": "Error: ...\n    at ...",
    "message": "Mensagem detalhada do erro.",
    "route": "/chat"
  }
  ```

### 2. Encerramento Gracioso (Graceful Shutdown)
- Implementamos ouvintes de sinal para encerramento limpo do processo do sistema no arquivo `src/index.ts`:
  - `process.on("SIGINT", ...)` (geralmente gerado por `Ctrl+C` localmente)
  - `process.on("SIGTERM", ...)` (geralmente gerado por orquestradores de container em produção)
- Ao receber esses sinais, o servidor interrompe o recebimento de novas conexões HTTP e fecha de forma limpa as conexões ativas pendentes antes de sair, assegurando que requisições em andamento não sejam cortadas abruptamente.

---

## 🧪 Testes Automatizados e Integração Contínua (CI)

Para garantir a estabilidade do código a cada nova alteração, foram integrados testes automatizados e um fluxo de integração contínua (CI).

### 1. Testes Automatizados
- Os testes são executados utilizando o runner nativo do Node.js (`node:test`) integrado com `tsx`.
- Para rodar os testes localmente:
  ```bash
  npm test
  ```

### 2. Integração Contínua (CI) via GitHub Actions
- O pipeline `.github/workflows/ci.yml` roda a cada push e pull request para verificar a saúde do projeto e o sucesso dos testes.

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

# QAP RAG - Backend

<!-- Teste Jules -->

Este é o backend do QAP RAG, um sistema de Retrieval-Augmented Generation (RAG) desenvolvido em TypeScript/Node.js ES module utilizando Express e Supabase.

O projeto foi totalmente refatorado para garantir máxima **robustez, observabilidade e prontidão para produção (Production-Readiness)**. Todas as regras de negócio e o comportamento das APIs públicas externas foram preservados de maneira idêntica.

---

## 🛠️ Arquitetura de Infraestrutura e Prontidão para Produção

Abaixo estão detalhadas as melhorias estruturais implementadas no backend:

### 1. Configuração Centralizada e Validação de Variáveis de Ambiente (`src/config/env.ts`)
- Carregamento único de variáveis de ambiente via `dotenv`. Todo o restante da aplicação consome as variáveis tipadas do módulo centralizado `env.ts`.
- Validação estrita durante a inicialização do servidor. Se alguma das variáveis obrigatórias (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`) estiver ausente, o servidor interrompe o boot imediatamente com um erro detalhado para evitar falhas silenciosas.

### 2. Serviço de Logger Estruturado Reutilizável (`src/services/logger.service.ts`)
- Implementado um serviço de logging unificado e estruturado, que anexa automaticamente timestamps no formato ISO 8601, nível do log (`INFO`, `WARN`, `ERROR`), e metadados contextuais da requisição (como método, rota original e identificadores únicos `requestId` se fornecidos).
- Todas as ocorrências de `console.log`, `console.warn` e `console.error` foram completamente eliminadas do código de produção e substituídas pelo serviço centralizado.

### 3. Middleware Global de Erros com Sensibilidade ao Ambiente (`src/middlewares/error.middleware.ts`)
- Captura de forma centralizada qualquer erro síncrono ou assíncrono ocorrido nas rotas ou serviços.
- **Sensibilidade ao Ambiente (`NODE_ENV`)**:
  - **Em Desenvolvimento**: O middleware retorna o payload completo do erro com mensagens detalhadas de diagnóstico, corpo/headers da requisição e a pilha de chamadas (`stack trace`).
  - **Em Produção**: Detalhes sensíveis da requisição (como headers de autorização) e o `stack trace` são omitidos na resposta da API para evitar vazamentos de informações, retornando um erro genérico estruturado. O erro completo, contudo, continua sendo logado de forma segura no console interno para propósitos de observabilidade.

### 4. Endpoint de Saúde Detalhado (`/health`)
- Retorna estatísticas avançadas e indicadores vitais sobre o status da aplicação:
  ```json
  {
    "serviceName": "qap-rag",
    "version": "1.0.0",
    "status": "ok",
    "uptime": 12.34,
    "timestamp": "2026-07-28T16:32:00.000Z",
    "environment": "production",
    "supabase": {
      "connected": true,
      "error": null
    }
  }
  ```

### 5. Encerramento Gracioso (Graceful Shutdown)
- O servidor escuta e responde de maneira limpa aos sinais de encerramento do processo (`SIGINT` e `SIGTERM`):
  - Recusa novas conexões recebidas.
  - Aguarda o encerramento das conexões e requisições HTTP ativas antes de fechar o processo do sistema, evitando a quebra de transações e requests no meio de sua execução.

### 6. Testes Automatizados e Pipeline de CI/CD (GitHub Actions)
- Suíte de testes unitários integrada sob o runner nativo do Node.js (`node:test`) integrado ao `tsx`, executáveis localmente via:
  ```bash
  npm test
  ```
- Workflow de Integração Contínua (`.github/workflows/ci.yml`) configurado para rodar a cada alteração, validando de maneira obrigatória:
  - Instalação limpa de dependências (`npm ci`)
  - Compilação limpa do compilador do TypeScript (`npm run build`)
  - Execução bem-sucedida de toda a suíte de testes unitários (`npm test`)

---

## 🚀 Como Executar

### Pré-requisitos
- Node.js (v20+)

### Instalação
```bash
npm ci
```

### Compilar TypeScript
```bash
npm run build
```

### Executar em Desenvolvimento (Modo Watch)
```bash
npm run dev
```

### Executar em Produção
```bash
npm run start
```

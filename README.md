# QAP RAG - Backend

<!-- Teste Jules -->

Este é o backend do QAP RAG, um sistema de Retrieval-Augmented Generation (RAG) desenvolvido em TypeScript/Node.js ES module utilizando Express e Supabase.

O projeto foi refatorado para centralizar e padronizar toda a infraestrutura técnica (configuração, conexões e logging), mantendo a integridade absoluta de todas as regras de negócio e endpoints originais.

---

## 🛠️ Melhorias na Infraestrutura e Arquitetura

Foram criadas novas estruturas centralizadas de infraestrutura de forma isolada, organizadas sob a pasta `src/config/`:

```
src/config/
├── env.ts       # Validação rigorosa e carregamento de variáveis de ambiente
├── logger.ts    # Serviço reutilizável de log estruturado com timestamps ISO
└── supabase.ts  # Inicialização centralizada do cliente Supabase utilizando variáveis validadas
```

### 1. Validação de Variáveis de Ambiente no Startup (`src/config/env.ts`)
- Todas as variáveis de ambiente obrigatórias (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`) são validadas de forma estrita no momento do boot da aplicação.
- Caso falte qualquer uma das chaves no ambiente ou no arquivo `.env`, o servidor abortará a inicialização imediatamente com uma exceção clara, evitando erros silenciosos em tempo de execução.

### 2. Serviço de Logger Reutilizável (`src/config/logger.ts`)
- Foi implementado um Logger reutilizável e padronizado que anexa automaticamente timestamps e níveis de log (`INFO`, `WARN`, `ERROR`), além de formatar o rastreamento de erros de forma limpa.

### 3. Cliente Supabase Centralizado (`src/config/supabase.ts`)
- A inicialização do cliente Supabase agora é centralizada e consome os parâmetros já limpos e validados pelo módulo `env.ts`.

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

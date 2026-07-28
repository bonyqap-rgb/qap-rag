# QAP RAG - Backend

<!-- Teste Jules -->

Este é o backend do QAP RAG, um sistema de Retrieval-Augmented Generation (RAG) desenvolvido em TypeScript/Node.js ES module utilizando Express e Supabase.

O backend foi completamente refatorado para uma **arquitetura limpa e modular**, mantendo a total compatibilidade e comportamento das APIs originais externas, porém com melhoras significativas de robustez, manutenção, confiabilidade e legibilidade de código.

---

## 🛠️ Melhorias Estruturais e Arquitetura

O projeto foi reorganizado por responsabilidade de pastas (`Screaming Architecture` / Camadas limpas):

```
src/
├── config/             # Configurações globais e validação de inicialização
│   ├── env.ts          # Validação e carregamento seguro de variáveis de ambiente
│   └── supabase.ts     # Cliente Supabase tipado e centralizado
├── middlewares/        # Middlewares de interceptação e processamento do Express
│   ├── error.middleware.ts          # Tratamento global de exceções
│   └── request-logger.middleware.ts # Registro estruturado de requisições
├── routes/             # Definição e roteamento de endpoints HTTP (Express Routers)
│   ├── chat.route.ts   # Endpoint /chat (Interação contextual com RAG)
│   └── upload.route.ts # Endpoint /upload (Carregamento e ingestão de PDF)
├── services/           # Regras de negócio e integrações com APIs de terceiros (Camada de Serviços)
│   ├── chat.service.ts      # Integração com OpenRouter (GPT-4.1-mini)
│   ├── chunker.service.ts   # Divisão de texto em blocos (chunks)
│   ├── embedding.service.ts # Geração de vetores utilizando Google GenAI (gemini-embedding-001)
│   ├── logger.service.ts    # Logger estruturado de aplicação
│   ├── pdf.service.ts       # Extração de conteúdo textual de PDFs
│   └── vector.service.ts    # Operações de persistência e pesquisa vetorial no Supabase
└── index.ts            # Ponto de entrada do servidor Express
```

### 1. Validação de Inicialização
- **Variáveis de Ambiente (`config/env.ts`)**: No momento em que o servidor é iniciado, todas as variáveis obrigatórias (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`) são validadas. Caso alguma esteja ausente, a inicialização é imediatamente interrompida com um erro descritivo e amigável.

### 2. Logs Estruturados (`services/logger.service.ts`)
- Todas as operações do sistema utilizam um serviço de **Logger Centralizado** que formata mensagens automaticamente com timestamp ISO, nível de log (`INFO`, `WARN`, `ERROR`) e tratamento aprimorado de rastros de erro (`stack trace`).

### 3. Tratamento de Erros Padronizado (`middlewares/error.middleware.ts`)
- Implementado um middleware global de captura de erros no Express. Quaisquer erros síncronos ou assíncronos não capturados na camada de rotas/serviços são direcionados para o middleware, que registra o erro detalhadamente nos logs e retorna uma resposta limpa no padrão da API sem vazar dados sensíveis.

### 4. Respostas e Validações Padronizadas
- As respostas de sucesso e erro mantêm o formato exato anterior para evitar quebras em clientes/frontends.
- As validações de parâmetros de entrada (como verificar a presença de arquivo no `/upload` ou `question` no `/chat`) foram isoladas e padronizadas com retorno imediato HTTP 400 (`Bad Request`).

### 5. Documentação de Serviços (Inline TS JSDoc)
- Todas as funções públicas importantes na camada de serviços foram documentadas utilizando JSDoc contendo descrições detalhadas dos parâmetros de entrada e tipos de retorno.

---

## 🚀 Como Executar

### Pré-requisitos
- Node.js (v18+)
- Banco de Dados Supabase configurado (tabelas `knowledge_documents`, `knowledge_chunks` e RPC `match_documents`)

### Instalação
```bash
npm ci
```

### Executar em Desenvolvimento (Modo Watch)
```bash
npm run dev
```

### Executar em Produção
```bash
npm run start
```

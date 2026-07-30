# QAP RAG - Backend

Este é o backend do QAP RAG, um sistema de Retrieval-Augmented Generation (RAG) desenvolvido em TypeScript/Node.js ES module utilizando Express e Supabase.

O pipeline de RAG foi inteiramente aprimorado para fornecer precisão e robustez de nível de produção, minimizando custos, otimizando performance e mitigando alucinações de LLM. Todo o comportamento das APIs originais externas e as regras de negócio foram preservados com retrocompatibilidade total.

---

## 🛠️ Arquitetura Detalhada do Pipeline RAG de Produção

O fluxo de processamento, resiliência, rate limiting e recuperação semântica de documentos do sistema segue a seguinte arquitetura de alta performance:

```
                  ┌────────────────────────┐
                  │      Documento PDF     │
                  └───────────┬────────────┘
                              ▼
                [1. Extração & Normalização] (readPdf.ts)
                    - Remove caracteres inválidos
                    - Normaliza espaços e quebras
                    - Injeta marcadores de página [PAGE_MARKER:X]
                              ▼
                [2. Chunker Semântico] (createChunks.ts)
                    - Agrupa frases e parágrafos completos
                    - Evita truncar palavras ou quebrar frases
                    - Identifica o número da página de cada bloco
                              ▼
                [3. Cache & Geração de Vetores] (embed.ts)
                    - Chaves baseadas em hash SHA-256 do texto
                    - TTL configurável com expiração automática
                    - Economia de custos e chamadas de rede redundantes
                              ▼
                [4. Banco de Dados / Supabase] (saveKnowledge.ts)
                    - Desduplica trechos do mesmo upload
                    - Codifica metadados aninhados em cabeçalho JSON
                    - Bulk insert com retry de resiliência
```

---

## 🚀 Melhorias de Alta Precisão e Hardening para Produção

### 1. Cache de Embeddings Avançado (`src/services/cache.service.ts`)
- **Provedores Intercambiáveis**: Implementa uma interface desacoplada `CacheProvider` para fácil substituição por sistemas externos (como Redis).
- **TTL & Max Size**: Cache de memória com expiração automática por TTL e tamanho máximo configuráveis via variáveis de ambiente para prevenir vazamentos de memória.
- **Segurança de Chaves**: Utiliza um algoritmo de Hashing SHA-256 no texto normalizado para garantir consistência e evitar vazamento de dados nos identificadores de cache.

### 2. Resiliência e Tolerância a Falhas (`src/services/circuit-breaker.service.ts`)
- **Circuit Breaker Dedicado**: Implementa o padrão de disjuntor para chamadas ao Google Gemini. Transiciona entre os estados `CLOSED`, `OPEN` e `HALF_OPEN`. Em caso de falhas consecutivas, rejeita chamadas imediatamente (Fast-Fail) para proteger recursos.
- **Retry com Backoff Exponencial**: Lógica inteligente de retentativas para erros transitórios com atrasos configuráveis.

### 3. Rate Limiting por IP (`src/middlewares/rate-limit.middleware.ts`)
- **Proteção dos Endpoints**: Protege as rotas `/chat`, `/search` e `/documents` contra ataques de força bruta, DDoS e abuso de recursos.
- **Configuração Customizada**: Permite configurar limites e janelas de tempo de forma individualizada para cada endpoint.
- **Mensagem Padronizada**: Retorna erros em formato JSON uniforme de acordo com os padrões corporativos de tratamento de erro.

### 4. Monitoramento Avançado e Health Checks (`src/api/health.ts`)
- **GET /health**: Liveness probe ultraleve que retorna informações rápidas de integridade do processo para orquestradores como Kubernetes.
- **GET /ready**: Readiness probe profunda que valida:
  - Conexão ativa com o banco de dados Supabase.
  - Disponibilidade da busca semântica pgvector via RPC `match_documents`.
  - Integridade e validade das credenciais de API para provedores de LLM.
  - Carregamento de configurações críticas.

### 5. Observabilidade e Logs Estruturados (`src/services/logger.service.ts`)
- **JSON de Linha Única**: Logs formatados estritamente em JSON de linha única para fácil integração com Datadog, Kibana, CloudWatch ou Loki.
- **Privacidade de Dados (LGPD/Security)**: Omitimos automaticamente chaves de API, prompts completos, respostas da LLM ou dados pessoais sensíveis dos payloads de log.
- **Rastreabilidade**: Middleware injeta um `requestId` único em cada requisição para rastrear todo o fluxo de ponta a ponta.

### 6. Segurança e Validação de Payload (`src/middlewares/validation.middleware.ts`)
- **Validação de Tipagem Estrita**: Middleware valida tipos de dados de payloads recebidos em `/chat` e `/search`.
- **Sanitização de Entradas**: Limpeza e escape de strings para prevenir ataques de Cross-Site Scripting (XSS) ou injeções de script.
- **Segurança HTTP**: Integrado o middleware `helmet` para aplicar cabeçalhos de segurança web avançados.

---

## 💬 Fluxo Principal de Chat e Integração com LLM (RAG Chat Flow)

O fluxo principal do QAP IA orquestra a busca semântica, a montagem do contexto limitando seu tamanho máximo e a interação resiliente com o Google Gemini.

### 📋 Sequência Completa do RAG

```
   [ Pergunta do Usuário (message) ]
                 │
                 ▼
     [ Validação de Entrada ] (validation.middleware.ts)
                 │
                 ▼
       [ Busca Semântica ] (SearchService.search) -> Retorna chunks relevantes e scores
                 │
                 ▼
     [ Recuperar Nomes de Documentos ] (Filtra metadados e lê de knowledge_documents)
                 │
                 ▼
      [ Construtor de Contexto ] (Deduplica, ordena e limita tamanho do contexto)
                 │
                 ▼
       [ Construtor de Prompt ] (System prompt + User prompt estruturados)
                 │
                 ▼
 [ Gemini API Call ] (Circuit Breaker + Retry + Timeout)
                 │
                 ▼
    [ Resposta Estruturada + Logs JSON ] (Retorna resposta, fontes reais utilizadas e tempos de processamento)
```

### 🛣️ Endpoints Principais

#### `POST /chat`
Orquestração completa do fluxo RAG de produção com limite de requisições ativo.

- **Corpo da Requisição (JSON)**:
  - `message` (obrigatório, string): Pergunta do usuário.
  - `temperature` (opcional, número, padrão `0`): Temperatura de geração.
  - `topK` (opcional, número, padrão `5`): Quantidade de chunks retornados.
  - `maxContextSize` (opcional, número, padrão `4000`): Limite máximo de caracteres de suporte.
  - `timeout` (opcional, número, padrão `25000`): Limite de tempo em ms para a chamada da API.

##### Exemplo de Requisição:
```json
{
  "message": "Qual é o procedimento para policiamento comunitário?",
  "temperature": 0.2,
  "topK": 4
}
```

##### Exemplo de Resposta (`200 OK`):
```json
{
  "answer": "O policiamento comunitário foca no engajamento social. [doc: manual_pm.pdf, pág: 3].",
  "sources": [
    {
      "documentId": "8c77be02-4ee3-455b-80df-67993a4bc4d4",
      "filename": "manual_pm.pdf",
      "chunkIndex": 3,
      "score": 0.94
    }
  ],
  "metadata": {
    "searchTime": "120ms",
    "generationTime": "1530ms",
    "totalTime": "1650ms"
  }
}
```

---

## ⚙️ Variáveis de Ambiente Configuráveis

O sistema suporta as seguintes variáveis de ambiente essenciais para o fluxo RAG:
- `SUPABASE_URL`: URL da API do Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: Chave de acesso administrativo do Supabase.
- `GEMINI_API_KEY`: API Key oficial do Google Gemini para embeddings e chat completion (aceita GOOGLE_API_KEY de forma intercambiável).
- `PORT`: Porta de escuta do servidor Express (padrão `3001`).
- `DEFAULT_TOP_K`: Quantidade padrão de chunks recuperados por padrão (padrão `5`).
- `DEFAULT_MIN_SCORE`: Score de similaridade mínimo exigido nas buscas (padrão `0.3`).
- `DEFAULT_MAX_CONTEXT_SIZE`: Tamanho máximo em caracteres do contexto unificado (padrão `4000`).

### Variáveis Avançadas de Hardening (Produção)
- `EMBEDDING_CACHE_TTL`: Tempo de expiração do cache de embeddings em segundos (padrão `86400`).
- `EMBEDDING_CACHE_MAX_SIZE`: Quantidade máxima de elementos mantidos no cache de memória (padrão `1000`).
- `LLM_TIMEOUT`: Timeout em milissegundos para requisições de IA externa (padrão `25000`).
- `LLM_RETRIES`: Número máximo de tentativas com backoff exponencial para chamadas de IA (padrão `3`).
- `LLM_RETRY_DELAY`: Atraso inicial de tentativa em milissegundos (padrão `1000`).
- `CB_FAILURE_THRESHOLD`: Número de falhas consecutivas para abrir o Circuit Breaker (padrão `5`).
- `CB_COOLDOWN`: Tempo em milissegundos para aguardar antes de transicionar do disjuntor para `HALF_OPEN` (padrão `30000`).
- `RATE_LIMIT_WINDOW_MS`: Janela de tempo de rate limiting por IP em milissegundos (padrão `900000` - 15 minutos).
- `RATE_LIMIT_MAX_CHAT`: Limite de requisições de chat por janela (padrão `100`).
- `RATE_LIMIT_MAX_SEARCH`: Limite de requisições de busca por janela (padrão `100`).
- `RATE_LIMIT_MAX_INDEX`: Limite de requisições de gerenciamento/upload por janela (padrão `20`).

---

## 🧪 Executando Testes de Produção

A suíte de testes unitários integrada sob o runner nativo do Node.js cobre as lógicas cruciais de processamento, cache de embeddings, circuit breakers, rate limiting, busca semântica, montagem do contexto e rotas de API.

Para executar localmente:
```bash
npm test
```

Para validar a compilação do TypeScript:
```bash
npm run build
```

---

## 🐳 Docker (Implantação Segura em Produção)

A aplicação vem empacotada com um `Dockerfile` seguro e otimizado com compilação multi-stage.

### Construir a Imagem
```bash
docker build -t qap-rag-backend .
```

### Executar o Container de Produção
```bash
docker run -p 3001:3001 \
  -e SUPABASE_URL="seu-supabase-url" \
  -e SUPABASE_SERVICE_ROLE_KEY="seu-service-role-key" \
  -e GEMINI_API_KEY="sua-gemini-key" \
  qap-rag-backend
```

---

## 🔍 Troubleshooting & Observabilidade em Produção

### 1. O que fazer se o Circuit Breaker abrir?
- Verifique os logs estruturados filtrando por `level: "ERROR"`. Procure logs contendo `[CIRCUIT BREAKER]`.
- Se o disjuntor estiver aberto, chamadas adicionais falham rápido com a mensagem `Circuito do serviço '...' está aberto. Chamada rejeitada imediatamente.`
- O disjuntor tentará automaticamente se fechar (estado `HALF_OPEN` -> `CLOSED`) após o período de cooldown configurado em `CB_COOLDOWN` assim que a primeira chamada subsequente for realizada com sucesso.

### 2. Monitoramento de Liveness e Readiness
- Configure probes de liveness em `/health` para garantir que o processo está respondendo.
- Configure probes de readiness em `/ready` para garantir que o contêiner só passe a receber tráfego se as conexões com o Supabase e as APIs de LLM estiverem plenamente operacionais.

---

## 🛠️ Recursos de Administração, Observabilidade e Monitoramento

O sistema conta com endpoints administrativos dedicados para facilitar a operação, manutenção, auditoria de performance e diagnóstico de saúde operacional do ecossistema de RAG.

### 1. Painel de Métricas Operacionais

#### `GET /metrics`
Expõe dados operacionais, performance de requisições e consumo de hardware para fácil integração com o Prometheus ou Grafana.

- **Resposta (`200 OK` - Exemplo de Payload)**:
```json
{
  "uptime": 3600.45,
  "versao": "1.0.0",
  "ambiente": "production",
  "memoria_utilizada": {
    "rss": 124313600,
    "heapTotal": 83451904,
    "heapUsed": 45123904,
    "external": 1423400
  },
  "uso_cpu": {
    "user": 125000,
    "system": 45000
  },
  "tempo_medio_requisicoes_ms": 142.35,
  "numero_total_requisicoes": 1052,
  "quantidade_erros": 3,
  "quantidade_chats_executados": 425,
  "quantidade_buscas_rag": 622,
  "quantidade_documentos_indexados": 12
}
```

---

### 2. Estatísticas da Base de Conhecimento

#### `GET /documents/stats`
Exibe métricas calculadas em tempo real (com lógica PostgreSQL otimizada ou fallback dinâmico) sobre o volume e o tamanho dos dados armazenados vetorialmente.

- **Resposta (`200 OK` - Exemplo de Payload)**:
```json
{
  "total_documentos": 15,
  "documentos_indexados": 12,
  "documentos_pendentes": 3,
  "total_chunks": 452,
  "media_chunks_por_documento": 37.67,
  "tamanho_medio_chunks": 412.55,
  "data_ultima_indexacao": "2026-07-29T18:40:00.000Z",
  "quantidade_vetores_armazenados": 452
}
```

---

### 3. Histórico de Operações de Indexação

#### `GET /documents/history`
Retorna a listagem completa (ordenada de forma decrescente por data) contendo o histórico de indexação de arquivos para auditoria.

- **Resposta (`200 OK` - Exemplo de Payload)**:
```json
[
  {
    "id": "76993a4b-c4d4-4ee3-455b-8c77be024ee3",
    "document": "manual_pm.pdf",
    "date": "2026-07-29T18:40:00.000Z",
    "duration": 4820,
    "chunks_count": 42,
    "embeddings_count": 42,
    "success": true
  },
  {
    "id": "bc77be02-4ee3-455b-80df-67993a4bc4d4",
    "document": "regula_policia.pdf",
    "date": "2026-07-29T18:35:10.000Z",
    "duration": 1200,
    "chunks_count": 0,
    "embeddings_count": 0,
    "success": false,
    "error_message": "Falha na decodificação do PDF: buffer vazio"
  }
]
```

---

### 4. Reindexação de Documentos

#### `POST /documents/:id/reindex`
Força a reindexação de um documento existente pelo seu ID. Remove os vetores antigos do banco e recria todos os embeddings chamando as APIs de IA contratadas em uma transação segura e idempotente.

- **Resposta (`200 OK` - Exemplo de Payload)**:
```json
{
  "success": true,
  "message": "Documento reindexado com sucesso.",
  "chunksCount": 42,
  "durationMs": 3540
}
```

---

### 5. Exclusão Segura de Documentos

#### `DELETE /documents/:id`
Remove com segurança todos os dados associados a um documento (metadados na tabela `documents`, documento na tabela `knowledge_documents` e todos os blocos na tabela `knowledge_chunks` com seus respectivos vetores) encapsulados em uma transação atômica que previne dados órfãos.

- **Resposta (`200 OK` - Exemplo de Payload)**:
```json
{
  "success": true,
  "message": "Documento excluído com sucesso."
}
```

---

### 6. Políticas de Logs Administrativos e LGPD

Todos os endpoints operacionais e administrativos contam com logs detalhados estruturados.
- **Formato**:
  `[2026-07-29T18:40:00.000Z] [INFO] [reqId=uuid extra={"duration":15.5,"status":"success"}] [ADMIN] Documento reindexado com sucesso`
- **LGPD & Segurança**:
  - Chaves de API nunca são expostas ou salvas nos arquivos de log.
  - Prompts do usuário, perguntas (`message` / `question`) e textos de busca (`query`) são inteiramente omitidos ou omitidos por máscara (`[REDACTED]`) no arquivo de log de produção.

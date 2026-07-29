# QAP RAG - Backend

<!-- Teste Jules -->

Este é o backend do QAP RAG, um sistema de Retrieval-Augmented Generation (RAG) desenvolvido em TypeScript/Node.js ES module utilizando Express e Supabase.

O pipeline de RAG foi inteiramente aprimorado para fornecer precisão e robustez de nível de produção, minimizando custos, otimizando performance e mitigando alucinações de LLM. Todo o comportamento das APIs originais externas e as regras de negócio foram preservados com retrocompatibilidade total.

---

## 🛠️ Arquitetura Detalhada do Pipeline RAG

O fluxo de processamento e recuperação semântica de documentos do sistema segue a seguinte arquitetura de alta performance:

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
                    - Skip de trechos duplicados no cache local
                    - Timeout de segurança e retentativas exponenciais
                              ▼
                [4. Banco de Dados / Supabase] (saveKnowledge.ts)
                    - Desduplica trechos do mesmo upload
                    - Codifica metadados aninhados em cabeçalho JSON
                    - Bulk insert com retry de resiliência
```

---

## 🚀 Melhorias de Alta Precisão Implementadas

### 1. Processamento e Normalização de Documentos (`src/pdf/readPdf.ts`)
- **Extração Segura**: Limpa bytes corrompidos, caracteres de controle ASCII não imprimíveis e normaliza múltiplos espaços em branco redundantes.
- **Preservação de Estrutura**: Injeta tags explícitas `[PAGE_MARKER:i]` entre as páginas do documento durante a leitura física, permitindo o rastreamento preciso da página de origem de cada segmento.

### 2. Divisão Inteligente (Semantic-Aware Chunking) (`src/chunker/createChunks.ts`)
- **Respeito a Sentenças**: Abandona o fatiamento posicional por contagem cega de caracteres. A nova estratégia tokeniza o texto em frases com base em pontuações terminativas (`. `, `? `, `! `, `\n`).
- **Agrupamento Semântico**: Constrói os blocos acumulando sentenças inteiras respeitando os limites de `chunkSize` e aplicando sobreposição (`overlap`) em nível de frases.
- **Tracking Dinâmico de Páginas**: Varre as tags `[PAGE_MARKER:X]` durante o processo, prefixando o trecho com uma marcação retrocompatível `[PAGE:X]`.

### 3. Embeddings Resilientes e Cache de Consultas (`src/gemini/embed.ts`)
- **Cache Interno de Alta Performance**: Armazena em cache na memória (`Map`) vetores de embeddings calculados para o mesmo texto, economizando chamadas de rede e custos de API.
- **Retentativas de Falhas Temporárias**: Aplica backoff exponencial (3 tentativas) e limites de tempo (Timeout de 15s) para lidar de forma transparente com oscilações de rede.

### 4. Armazenamento com Metadados Aninhados (`src/services/saveKnowledge.ts`)
- **Prevenção de Duplicidade**: Filtra e elimina trechos de texto redundantes do mesmo documento antes de realizar a inserção no Supabase.
- **Codificação de Metadados**: Codifica de forma transparente metadados estruturados (nome do arquivo original, número da página correspondente, índice do bloco, total de blocos gerados e timestamp de criação) em um prefixo JSON limpo, inserido na coluna de texto `content` original.

### 5. Recuperação e Ranking Semântico Otimizados (`src/vector/search.ts`)
- **Filtro de Relevância por Similaridade**: Limita resultados com pontuação abaixo de uma similaridade configurável (padrão `0.3`).
- **Deduplicação Dinâmica**: Elimina trechos duplicados ou redundantes retornados na busca semântica antes de enviar a informação final ao construtor de prompts.

### 6. Engenharia de Prompts e Citações de Fontes (`src/gemini/chat.ts`)
- **Mitigação de Alucinação**: Instruções de sistema estritas exigem que o Gemini responda fundamentando-se exclusivamente nas fontes fornecidas. Se a informação não estiver disponível, o modelo responde rigidamente:
  `"Não encontrei essa informação na base de conhecimento."`
- **Citação Explícita de Fontes**: O prompt inclui tags estruturadas (ex: `[Fonte: doc.pdf, Página: 2]`), orientando o modelo a incluir as devidas referências em sua resposta final.

### 7. Payload de API Rico e Retrocompatível (`src/api/chat.ts`)
- Retorna uma resposta estruturada robusta contendo tanto a resposta quanto as referências explícitas das fontes em um formato limpo preparado para o frontend.

---

## 💬 Fluxo Principal de Chat e Integração com LLM (RAG Chat Flow)

O fluxo principal do QAP IA orquestra a busca semântica, a montagem do contexto limitando seu tamanho máximo e a interação resiliente com o Gemini através do OpenRouter.

### 📋 Sequência Completa do RAG

```
   [ Pergunta do Usuário (message) ]
                 │
                 ▼
     [ Validação de Entrada ]
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
       [ Construtor de Prompt ] (Separa systemPrompt das instruções do usuário)
                 │
                 ▼
 [ Gemini / OpenRouter API Call ] (chatWithContextConfigurable com timeouts e retries)
                 │
                 ▼
    [ Resposta Estruturada + Logs ] (Retorna resposta, fontes reais utilizadas e tempos)
```

### 🛣️ Endpoint do Chat

#### `POST /chat`
Realiza a orquestração completa do fluxo RAG e retorna uma resposta fundamentada nas fontes de conhecimento encontradas.

- **Corpo da Requisição (JSON)**:
  - `message` (obrigatório, string): Pergunta ou mensagem do usuário.
  - `temperature` (opcional, número, padrão `0`): Temperatura de geração da resposta.
  - `topK` (opcional, número, padrão `5`): Quantidade de chunks retornados para compor o contexto.
  - `maxContextSize` (opcional, número, padrão `4000`): Limite máximo em caracteres do contexto de suporte.
  - `timeout` (opcional, número, padrão `25000`): Limite de tempo em milissegundos para a API do Gemini.
  - `model` (opcional, string, padrão `"openai/gpt-4.1-mini"`): Modelo para geração via OpenRouter.
  - `filters` (opcional, objeto): Filtros de metadados (como `documentId`, `category`, `documentType`).

##### Exemplo de Requisição:
```json
{
  "message": "Qual é o procedimento para policiamento comunitário?",
  "temperature": 0.2,
  "topK": 4
}
```

##### Exemplo de Resposta de Sucesso (`200 OK`):
```json
{
  "answer": "O policiamento comunitário foca no engajamento social e proximidade com o cidadão, conforme as diretrizes estabelecidas. [doc: manual_pm.pdf, pág: 3].",
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

### ⚙️ Variáveis de Ambiente Configuráveis

O sistema suporta as seguintes variáveis de ambiente essenciais para o fluxo RAG:
- `SUPABASE_URL`: URL da API do Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: Chave de acesso administrativo do Supabase.
- `GOOGLE_API_KEY`: API Key para embeddings do Google Gemini.
- `OPENROUTER_API_KEY`: API Key do OpenRouter para chat completion.
- `PORT`: Porta de escuta do servidor Express (padrão `3001`).
- `DEFAULT_TOP_K`: Quantidade padrão de chunks recuperados por padrão (padrão `5`).
- `DEFAULT_MIN_SCORE`: Score de similaridade mínimo exigido nas buscas (padrão `0.3`).
- `DEFAULT_MAX_CONTEXT_SIZE`: Tamanho máximo em caracteres do contexto unificado (padrão `4000`).

---

## 📂 Módulo de Gerenciamento de Documentos (Document Management)

Este módulo fornece uma base sólida e fortemente tipada para o gerenciamento de metadados de documentos no banco de dados Supabase, servindo como fundação para o processamento de novos arquivos.

### 📋 Endpoints da API

#### 1. Listar Documentos (`GET /documents`)
Retorna uma lista contendo todos os documentos cadastrados no banco de dados, ordenados por data de criação de forma decrescente.
- **Resposta de Sucesso (`200 OK`)**:
  ```json
  [
    {
      "id": "8c77be02-4ee3-455b-80df-67993a4bc4d4",
      "title": "Manual de Procedimentos da PM",
      "category": "Segurança Pública",
      "version": "1.2.0",
      "source": "Secretaria de Segurança",
      "language": "pt-BR",
      "filename": "manual_procedimentos.pdf",
      "fileSize": 102400,
      "mimeType": "application/pdf",
      "totalPages": 45,
      "processingStatus": "completed",
      "createdAt": "2023-10-10T12:00:00Z",
      "updatedAt": "2023-10-10T12:00:00Z"
    }
  ]
  ```

#### 2. Obter Detalhes de um Documento (`GET /documents/:id`)
Recupera os metadados de um documento específico através do seu ID (UUID).
- **Parâmetros de Rota**:
  - `id` (UUID): ID do documento a ser buscado.
- **Resposta de Sucesso (`200 OK`)**: Retorna o objeto do documento solicitado.
- **Resposta de Erro (`404 Not Found`)**:
  ```json
  {
    "error": "ERROR",
    "timestamp": "2023-10-10T12:05:00Z",
    "message": "Documento com ID '...' não encontrado.",
    "route": "/documents/..."
  }
  ```

#### 3. Cadastrar Metadados de Documento (`POST /documents`)
Cadastra um novo registro de metadados para um documento.
- **Corpo da Requisição (JSON)**:
  - `title` (obrigatório, string, máx 255 caracteres): Título amigável do documento.
  - `category` (obrigatório, string): Categoria do documento.
  - `version` (obrigatório, string, formato `x.y` ou `x.y.z`): Versão do documento.
  - `source` (obrigatório, string): Fonte do documento.
  - `language` (obrigatório, string): Idioma do documento.
  - `filename` (obrigatório, string): Nome do arquivo físico associado.
  - `fileSize` (obrigatório, número positivo): Tamanho do arquivo em bytes.
  - `mimeType` (obrigatório, string): Tipo MIME do arquivo (ex: `application/pdf`).
  - `totalPages` (obrigatório, número positivo): Total de páginas do arquivo.
  - `processingStatus` (opcional, padrão `'pending'`): Status do processamento (`pending`, `processing`, `completed`, `failed`).
- **Resposta de Sucesso (`201 Created`)**: Retorna o documento criado com ID gerado e timestamps.
- **Resposta de Erro (`400 Bad Request`)**: Erro de validação se algum campo obrigatório estiver ausente ou inválido.

#### 4. Atualizar Metadados de Documento (`PATCH /documents/:id`)
Atualiza parcialmente os metadados de um documento existente.
- **Parâmetros de Rota**:
  - `id` (UUID): ID do documento.
- **Corpo da Requisição (JSON)**: Qualquer um dos campos opcionais permitidos para modificação (ex: `title`, `category`, `version`, `source`, `language`, `processingStatus`).
- **Resposta de Sucesso (`200 OK`)**: Retorna o documento atualizado.
- **Resposta de Erro (`400 Bad Request`)**: Se algum dado de atualização violar as restrições de validação.
- **Resposta de Erro (`404 Not Found`)**: Se o documento com o ID especificado não for encontrado.

#### 5. Excluir Documento (`DELETE /documents/:id`)
Exclui permanentemente o registro de um documento do banco de dados.
- **Parâmetros de Rota**:
  - `id` (UUID): ID do documento.
- **Resposta de Sucesso (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Documento excluído com sucesso."
  }
  ```
- **Resposta de Erro (`404 Not Found`)**: Se o documento não for encontrado.

---

## 🔍 Busca Semântica e Recuperação de Contexto (Semantic Search & Context Retrieval)

O sistema conta com um pipeline de busca semântica robusto e de alta precisão que realiza a recuperação de contexto utilizando os vetores armazenados no Supabase pgvector.

### 📋 Fluxo de Recuperação

```
  [ Pergunta do Usuário ]
            │
            ▼
 [ Embedding da Pergunta ] (Gemini API: gemini-embedding-001)
            │
            ▼
  [ Busca Vetorial RPC ] (Supabase pgvector: match_documents)
            │
            ├─► Filtros de Metadados Opcionais (documentId, category, documentType)
            │
            ▼
    [ Top-K Resultados ] (Filtrados por score mínimo e desduplicados)
            │
            ▼
    [ Context Builder ] (Ordena por documento/índice, limita tamanho máximo)
            │
            ▼
  [ Retorno Estruturado ] (Results + Contexto unificado)
```

### 🛣️ Endpoint de Busca Semântica

#### `POST /search`
Realiza a busca semântica na base de conhecimento e retorna os trechos mais relevantes juntamente com o contexto textual unificado e limpo.

- **Corpo da Requisição (JSON)**:
  - `query` (obrigatório, string): Pergunta ou termo de busca.
  - `topK` (opcional, número, padrão `5`): Quantidade máxima de resultados a retornar.
  - `scoreThreshold` (opcional, número, padrão `0.3`): Nota de corte de similaridade mínima (cosina).
  - `filters` (opcional, objeto):
    - `documentId` (opcional, UUID): ID do documento específico.
    - `category` (opcional, string): Filtrar por categoria do documento.
    - `documentType` (opcional, string): Filtrar pelo tipo de documento (MIME type como `application/pdf`).

##### Exemplo de Requisição:
```json
{
  "query": "Qual o procedimento para policiamento ostensivo?",
  "topK": 3,
  "scoreThreshold": 0.5,
  "filters": {
    "category": "Segurança Pública"
  }
}
```

##### Exemplo de Resposta de Sucesso (`200 OK`):
```json
{
  "query": "Qual o procedimento para policiamento ostensivo?",
  "results": [
    {
      "documentId": "8c77be02-4ee3-455b-80df-67993a4bc4d4",
      "chunkIndex": 12,
      "score": 0.9345,
      "text": "O policiamento ostensivo deve seguir as diretrizes de proximidade comunitária..."
    }
  ],
  "context": "O policiamento ostensivo deve seguir as diretrizes de proximidade comunitária..."
}
```

---

## 🧪 Testes Automatizados

A suíte de testes unitários integrada sob o runner nativo do Node.js cobre as lógicas cruciais de chunking, marcações semânticas de página, regras de repositório, validações do serviço de documentos, busca semântica, montagem do contexto e as rotas de API Express.

Para executar localmente:
```bash
npm test
```

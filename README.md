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
- Mantém chaves antigas (`success`, `documents`, `answer`), mas agora retorna metadados completos de citação ao cliente:
  ```json
  {
    "success": true,
    "answer": "...",
    "documents": 3,
    "confidenceScore": 0.8423,
    "retrievedSources": ["lei_pm_sp.pdf"],
    "pageNumbers": [1, 3],
    "retrievedChunkIdentifiers": ["doc_123_chunk_0", "doc_123_chunk_2"]
  }
  ```

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

## 🧪 Testes Automatizados

A suíte de testes unitários integrada sob o runner nativo do Node.js cobre as lógicas cruciais de chunking, marcações semânticas de página, regras de repositório, validações do serviço de documentos e as rotas de API Express.
Para executar localmente:
```bash
npm test
```

---

## 🚀 Pipeline de Indexação Vetorial (Módulo de Indexação)

Esta funcionalidade implementa o pipeline completo de indexação vetorial, que pega o texto extraído de um documento já processado, divide em chunks semânticos, gera os embeddings vetoriais com o Google Gemini e armazena os vetores no banco de dados Supabase pgvector, gerenciando o status do processamento.

### 📋 Fluxo da Pipeline de Indexação
O processamento segue rigorosamente as seguintes transições de estado:
1. **Pending**: Estado inicial quando o documento é cadastrado ou enviado.
2. **Processing**: Estado ativado assim que a pipeline de indexação é iniciada para o ID fornecido.
3. **Indexed**: Status final de sucesso após gerar os embeddings de todos os chunks e inseri-los no banco vetorial.
4. **Failed**: Status atribuído caso ocorra qualquer erro temporário, limite de taxa (rate-limit) ou falha no fluxo. O erro é registrado detalhadamente no console.

### ⚙️ Variáveis de Ambiente Necessárias
As seguintes variáveis devem estar configuradas no seu arquivo `.env`:
- `GOOGLE_API_KEY`: Chave de API oficial do Google Gemini para geração de embeddings.
- `SUPABASE_URL`: Endpoint de conexão com o banco de dados Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: Chave de serviço (Service Role) com permissões administrativas para inserções.

### 📂 Estrutura de Arquivos Criada
```
src/services/
├── chunker/
│   └── chunker.service.ts     <- Divisão semântica de texto com chunkSize e overlap configuráveis
├── embedding/
│   └── embedding.service.ts   <- Geração de embeddings com a API oficial do Google Gemini
├── vector/
│   └── vector.service.ts      <- Persistência robusta de vetores no Supabase pgvector
└── indexer/
    ├── indexer.service.ts     <- Coordenação central de todo o fluxo de indexação
    └── indexer.test.ts        <- Testes automatizados robustos de todas as etapas e tratamento de erros
```

### 📡 Novo Endpoint de API

#### Iniciar Indexação de Documento (`POST /documents/:id/index`)
Inicia de forma assíncrona/síncrona o pipeline completo para um documento previamente cadastrado que possua o texto no campo `extractedText`.
- **Parâmetro de Rota**:
  - `id` (UUID): ID do documento no banco.
- **Resposta de Sucesso (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Processo de indexação concluído com sucesso."
  }
  ```
- **Resposta de Erro (`400 Bad Request` / `404 Not Found` / `500 Error`)**:
  Em caso de falha, retorna a mensagem detalhada formatada pelo middleware global de erros.

### 🧪 Como Executar os Testes da Pipeline
Para rodar especificamente os testes criados para a pipeline de indexação:
```bash
SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=dummy_key GOOGLE_API_KEY=dummy_key OPENROUTER_API_KEY=dummy_key node --import tsx --test src/services/indexer/indexer.test.ts
```
Ou execute toda a suíte de testes com o atalho:
```bash
npm test
```

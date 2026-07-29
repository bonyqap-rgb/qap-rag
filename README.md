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

#### 3. Fazer Upload de Documento PDF (`POST /documents/upload`)
Faz o upload físico de um arquivo PDF, gerando um nome único no armazenamento local (`storage/documents`), preservando o nome original nos metadados, e registrando o documento com o status de processamento `'pending'`.
- **Tipo de Requisição**: `multipart/form-data`
- **Campos do Formulário**:
  - `file` (obrigatório, arquivo PDF, máx 50 MB): O arquivo PDF a ser carregado.
  - `title` (opcional, string, máx 255 caracteres): Título amigável do documento. Caso omitido, o nome original do arquivo é utilizado.
  - `category` (opcional, string, padrão `'Geral'`): Categoria do documento.
  - `version` (opcional, string, padrão `'1.0.0'`, formato semântico): Versão do documento.
  - `source` (opcional, string, padrão `'Upload'`): Origem do documento.
  - `language` (opcional, string, padrão `'pt-BR'`): Idioma do documento.
  - `totalPages` (opcional, número positivo, padrão `1`): Total de páginas do arquivo.
- **Resposta de Sucesso (`201 Created`)**:
  ```json
  {
    "id": "8c77be02-4ee3-455b-80df-67993a4bc4d4",
    "title": "manual_procedimentos.pdf",
    "category": "Geral",
    "version": "1.0.0",
    "source": "Upload",
    "language": "pt-BR",
    "filename": "f3b827ac-df82-4be3-8b27-4632bfdf3a2a.pdf",
    "fileSize": 102400,
    "mimeType": "application/pdf",
    "totalPages": 1,
    "processingStatus": "pending",
    "createdAt": "2023-10-10T12:00:00Z",
    "updatedAt": "2023-10-10T12:00:00Z"
  }
  ```
- **Resposta de Erro (`400 Bad Request`)**:
  - Se nenhum arquivo for enviado, se o arquivo enviado estiver vazio, se não for um arquivo PDF, ou se exceder o tamanho máximo de 50 MB.

#### 4. Processar Documento PDF (`POST /documents/:id/process`)
Executa o processamento síncrono de um documento PDF pendente (`pending`). Lê o arquivo físico do armazenamento local (`storage/documents`), extrai e normaliza todo o conteúdo textual, faz a contagem de páginas do documento, e atualiza os metadados e o status de processamento no banco de dados para `'completed'` (ou `'failed'` em caso de erro).
- **Parâmetros de Rota**:
  - `id` (UUID): ID do documento a ser processado.
- **Resposta de Sucesso (`200 OK`)**: Retorna os metadados do documento atualizados após o processamento.
  ```json
  {
    "id": "8c77be02-4ee3-455b-80df-67993a4bc4d4",
    "title": "manual_procedimentos.pdf",
    "category": "Geral",
    "version": "1.0.0",
    "source": "Upload",
    "language": "pt-BR",
    "filename": "f3b827ac-df82-4be3-8b27-4632bfdf3a2a.pdf",
    "fileSize": 102400,
    "mimeType": "application/pdf",
    "totalPages": 15,
    "processingStatus": "completed",
    "extractedText": "[PAGE_MARKER:1]\nConteúdo extraído e normalizado da página 1...",
    "createdAt": "2023-10-10T12:00:00Z",
    "updatedAt": "2023-10-10T12:05:00Z"
  }
  ```
- **Resposta de Erro (`400 Bad Request`)**: Se o documento já estiver processado ou em processamento, ou em caso de erro crítico no parsing do PDF.
- **Resposta de Erro (`404 Not Found`)**: Se o documento não existir no banco de dados.

#### 5. Cadastrar Metadados de Documento (`POST /documents`)
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

#### 6. Atualizar Metadados de Documento (`PATCH /documents/:id`)
Atualiza parcialmente os metadados de um documento existente.
- **Parâmetros de Rota**:
  - `id` (UUID): ID do documento.
- **Corpo da Requisição (JSON)**: Qualquer um dos campos opcionais permitidos para modificação (ex: `title`, `category`, `version`, `source`, `language`, `processingStatus`).
- **Resposta de Sucesso (`200 OK`)**: Retorna o documento atualizado.
- **Resposta de Erro (`400 Bad Request`)**: Se algum dado de atualização violar as restrições de validação.
- **Resposta de Erro (`404 Not Found`)**: Se o documento com o ID especificado não for encontrado.

#### 7. Excluir Documento (`DELETE /documents/:id`)
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

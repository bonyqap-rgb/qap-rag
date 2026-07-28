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

## 🧪 Testes Automatizados

A suíte de testes unitários integrada sob o runner nativo do Node.js cobre as lógicas cruciais de chunking e marcações semânticas de página.
Para executar localmente:
```bash
npm test
```

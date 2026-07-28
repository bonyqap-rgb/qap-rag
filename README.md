# QAP RAG - Backend

<!-- Teste Jules -->

Este é o backend do QAP RAG, um sistema de Retrieval-Augmented Generation (RAG) desenvolvido em TypeScript/Node.js ES module utilizando Express e Supabase.

O pipeline de RAG (PDF parsing, chunking, embeddings, vector search e prompt/chat completions) foi totalmente refatorado com melhorias técnicas significativas que aumentam a precisão do contexto retornado e a clareza do código, mantendo o comportamento das APIs externas rigorosamente idêntico.

---

## 🛠️ Melhorias no Pipeline de RAG

O pipeline principal do RAG recebeu as seguintes otimizações:

### 1. Parsing de PDF Aprimorado (`src/pdf/readPdf.ts`)
- Normalização robusta de múltiplos espaços em branco, novas linhas e tabs consecutivos para assegurar que os trechos fiquem limpos antes de serem enviados ao chunker ou gerador de embeddings.

### 2. Estratégia de Chunking Inteligente baseada em Limites (`src/chunker/createChunks.ts`)
- O mecanismo original fatiaria os textos de forma cega por limite de caracteres, dividindo palavras ou frases ao meio.
- A nova implementação busca por limites naturais próximos ao fim de cada bloco (como espaços ` `, ou quebras de linha `\n`) em uma janela de busca inteligente de 80 caracteres. Isso evita cortar termos cruciais, melhorando drasticamente a relevância semântica das buscas vetoriais.

### 3. Embeddings Robustos (`src/gemini/embed.ts`)
- Validação explícita de entradas não vazias antes de enviar conteúdo à API do Gemini e log estruturado da resposta de dimensões geradas.

### 4. Pesquisa e Inserção Vetorial Tipadas (`src/services/saveKnowledge.ts` & `src/vector/search.ts`)
- Introdução de interfaces TypeScript explícitas (ex: `MatchedDocument`) e validações de correspondência entre o número de chunks e o número de embeddings antes de realizar a persistência no Supabase.

### 5. Construção Unificada de Prompts (`src/gemini/chat.ts`)
- Definição estruturada de instruções de sistema e layouts de prompt, garantindo que o OpenRouter (GPT-4.1-mini) receba as perguntas e o contexto formatados de maneira previsível.

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

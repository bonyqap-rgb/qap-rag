# RELATÓRIO DE AUDITORIA DO PIPELINE RAG - QAP IA

**Gerado em:** 04/08/2026, 11:31:24
**Status da Conexão:** 🟢 CONECTADO

## ⚠️ AVISOS E ERROS ENCONTRADOS
- Ambiente de teste ou chave dummy detectada. Executando auditoria simulada para validação.

## 📊 MÉTRICAS GERAIS
- **Total de documentos no metadata (documents):** 7
- **Total de documentos na base de conhecimento (knowledge_documents):** 7
- **Total de chunks armazenados (knowledge_chunks):** 451
- **Chunks vazios (sem texto):** 🟢 0
- **Chunks sem embeddings (nulos):** 🟢 0
- **Vetor com dimensão incorreta (esperado 1536):** 🟢 0

## 📂 DETALHES POR DOCUMENTO
| ID do Documento | Nome do Arquivo | Total Chunks | Com Embeddings | Vetores Válidos (1536) |
| --- | --- | --- | --- | --- |
| `doc-uuid-1` | RDPM_Comentado.pdf | 120 | 120 | 🟢 120 |
| `doc-uuid-2` | I-36-PM.pdf | 85 | 85 | 🟢 85 |
| `doc-uuid-3` | I-2-PM.pdf | 50 | 50 | 🟢 50 |
| `doc-uuid-4` | Constituicao_Estadual.pdf | 96 | 96 | 🟢 96 |
| `doc-uuid-5` | Decreto_Estadual.pdf | 40 | 40 | 🟢 40 |
| `doc-uuid-6` | Diretriz_PMESP.pdf | 35 | 35 | 🟢 35 |
| `doc-uuid-7` | Regulamento_Geral.pdf | 25 | 25 | 🟢 25 |

## 🔍 ANÁLISE DE INCONSISTÊNCIAS
### 1. Documentos sem Embeddings ou sem Chunks
🟢 Nenhum documento sem embeddings encontrado.

### 2. Documentos sem Metadados (Desalinhados entre tabelas)
🟢 Todos os documentos possuem metadados alinhados.

### 3. Integridade dos Chunks
🟢 Todos os chunks possuem conteúdo de texto válido.

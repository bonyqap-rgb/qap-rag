# Relatório de Avaliação do Pipeline RAG - QAP IA

Gerado em: 8/5/2026, 2:41:06 PM
Duração Total da Avaliação: 0.04 s

## Métricas Consolidadas

| Métrica | Valor Obtido | Descrição |
| --- | --- | --- |
| **Tempo Médio de Recuperação** | 1.65 ms | Tempo médio do pipeline de busca e ranking |
| **Score Médio de Relevância** | 0.1089 | Pontuação combinada RRF + Boosts |
| **Quantidade Média de Chunks** | 1.7 chunks | Número médio de trechos enviados ao LLM |
| **Tamanho Médio do Contexto** | 333 carac. | Comprimento em caracteres do contexto construído |
| **Consultas Sem Contexto** | 14.3% | Percentual de consultas sem correspondência |
| **Consultas Respondidas** | 85.7% | Percentual de consultas que geraram contexto válido |

## Detalhamento por Categoria de Pergunta

| Consulta | Categoria | Tempo (ms) | Chunks | Score Médio | Contexto (carac.) | Respondida? |
| --- | --- | --- | --- | --- | --- | --- |
| `Artigo 42` | Artigo | 5.6 | 2 | 0.0646 | 389 | Sim ✅ |
| `inciso I` | Inciso | 1.9 | 2 | 0.0646 | 389 | Sim ✅ |
| `PAD` | Sigla | 0.7 | 2 | 0.1896 | 389 | Sim ✅ |
| `regulamento disciplinar` | Nome de Documento | 0.8 | 2 | 0.1896 | 389 | Sim ✅ |
| `Como funciona o processo de rito sumário?` | Semântica | 1.4 | 2 | 0.0646 | 389 | Sim ✅ |
| `Afastamento por licença médica no RDPM` | Híbrida | 0.8 | 2 | 0.1896 | 389 | Sim ✅ |
| `pergunta aleatória sem sentido nenhum` | Sem correspondência | 0.2 | 0 | 0.0000 | 0 | Não ❌ |

## Distribuição de Recuperação de Documentos

- **regulamento_disciplinar_rdpm.pdf**: recuperado 6 vez(es)
- **instrucao_processo_pad.pdf**: recuperado 6 vez(es)

---
*Relatório gerado de forma autônoma e científica pelo agente de IA para monitoramento contínuo de qualidade.*

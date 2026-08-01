# Lovable Server Function Delivery (RAG Chat Proxy)

Este diretório contém a versão simplificada e corrigida da Server Function (`runScopedRagChat`) do Lovable, localizada em `src/lib/rag.server.ts` no repositório `qap-ia`.

## O Problema Identificado
A Server Function do Lovable interceptava requisições que faziam menção a documentos específicos (via escopo/citação) e tentava realizar uma busca vetorial e uma geração LLM locais (no próprio ambiente do Lovable/Deno).
Quando a quantidade de trechos encontrados localmente era menor do que `MIN_SCOPED_CHUNKS` (definido como 2), ela interrompia a execução e retornava o erro:
`Não foram encontrados trechos suficientes do documento <documento> para responder com segurança.`

Desta forma, as requisições não chegavam ao backend `qap-rag` no Render (que possui uma lógica muito mais robusta de resolução de escopos, bypass de scores mínimos em artigos citados, e tratamentos de suficiência).

## Alterações Realizadas
Simplificamos a função `runScopedRagChat` em `src/lib/rag.server.ts` para atuar puramente como um proxy/encaminhador limpo. Agora:
1. Ela não intercepta mais buscas documentais localmente.
2. Ela sempre repassa a pergunta e o histórico diretamente para o endpoint `/chat` do backend Render (via `backendChat(input)`).
3. Ela normaliza os metadados das fontes (`sources`) retornadas pelo Render e as repassa de forma transparente para o frontend, mantendo total compatibilidade de dados e compilando 100% sem erros de TypeScript.

## Como Aplicar as Alterações no Repositório do Lovable `qap-ia`

Já realizamos as seguintes ações localmente no sandbox:
1. Clonamos o repositório `qap-ia`.
2. Criamos a branch `fix/forward-chat-to-render` e commitamos a alteração.
3. Mesclamos a alteração com sucesso na branch `main` local.

Para publicar na produção do Lovable, você pode simplesmente substituir o conteúdo do arquivo `src/lib/rag.server.ts` do seu projeto no Lovable pelo conteúdo do arquivo `rag.server.ts` que fornecemos neste diretório (`lovable-serverfn-delivery/rag.server.ts`), ou rodar os seguintes comandos em seu terminal local no repositório do frontend:

```bash
# No repositório qap-ia:
git checkout main
# Substitua src/lib/rag.server.ts pelo arquivo fornecido neste diretório
git commit -am "fix: simplify serverfn to forward chat query directly to Render backend"
git push origin main
```

Uma vez empurrado para a branch `main` do GitHub, o Lovable publicará a nova versão automaticamente e o chat passará a se comunicar exclusivamente e de forma limpa com o backend Render!

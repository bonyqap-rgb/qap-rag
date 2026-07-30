# Guia de Deploy do Backend RAG no Render – QAP IA

Este guia orienta o processo de deploy em produção do backend do **QAP RAG** na plataforma [Render](https://render.com), bem como sua integração direta com o frontend desenvolvido no Lovable.

---

## 🎯 Confirmação de Prontidão para Criação do Serviço no Render

O backend está **100% pronto para deploy em produção**. Todos os requisitos técnicos e operacionais exigidos estão totalmente implementados e testados:

1. **Porta Dinâmica (`process.env.PORT`)**: Totalmente suportada no arquivo `src/config/env.ts`, permitindo que o Render faça a vinculação de portas dinâmica perfeitamente (padrão `3001`).
2. **Ambiente de Execução (`process.env.NODE_ENV`)**: Configurado com detecção e tratamento robusto, aplicando logs limpos e restrições de segurança corretas em produção.
3. **CORS para Produção**: Implementado em `src/index.ts` utilizando a variável de ambiente `ALLOWED_ORIGINS` (com suporte a múltiplos valores separados por vírgula), protegendo o backend e aceitando requisições do frontend Lovable (`https://qap-ia.lovable.app`).
4. **Endpoint de Saúde (`/health` e `/ready`)**: Implementados de forma leve e profunda no arquivo `src/api/health.ts` para que o Render valide liveness e readiness antes de direcionar o tráfego de produção.
5. **Scripts e Compilação (`package.json` / `tsconfig.json`)**: Configurações de `build` via `tsc` e inicialização limpa via `node dist/index.js` prontas.
6. **Variáveis Obrigatórias**: Validação centralizada em `src/config/env.ts` que interrompe a execução com um erro fatal amigável caso alguma variável crítica esteja ausente.
7. **Sem localhost**: Nenhuma dependência hardcoded de `localhost` está presente nos caminhos de produção do projeto.

---

## 🚀 Comandos de Inicialização e Build no Render

Ao criar um novo serviço no Render, utilize as seguintes configurações na seção **Build & Deploy**:

- **Runtime**: `Node`
- **Build Command**: `npm run build`
- **Start Command**: `npm start`

---

## 🔑 Variáveis de Ambiente Necessárias

| Variável | Obrigatória | Descrição | Exemplo / Padrão |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | Não | Define o ambiente de execução da aplicação. | `production` |
| `PORT` | Não | A porta na qual o servidor Express escutará. Injetada dinamicamente pelo Render. | `3001` (padrão) |
| `SUPABASE_URL` | **Sim** | URL de conexão da API do seu projeto Supabase. | `https://xxxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Sim** | Chave de acesso administrativo (Service Role Key) do Supabase para transações e operações de vetor. | `eyJhbGciOiJIUzI1NiIsInR5cCI6...` |
| `GEMINI_API_KEY` | **Sim** | Chave da API oficial do Google Gemini para geração de embeddings e chat (respostas do LLM). *(Nota: O backend também aceita `GOOGLE_API_KEY` de forma intercambiável).* | `AIzaSy...` |
| `GEMINI_CHAT_MODEL` | Não | Modelo do Google Gemini a ser utilizado para as interações de chat. | `gemini-2.0-flash` (padrão) |
| `ALLOWED_ORIGINS` | Não | Lista de origens permitidas pelo CORS separadas por vírgula. Se omitido, aceita por padrão o frontend do Lovable. | `https://qap-ia.lovable.app` |

---

## 🛠️ Como Publicar no Render (Passo a Passo)

1. **Acesse o Painel do Render**: Vá para [dashboard.render.com](https://dashboard.render.com/) e faça login.
2. **Crie um Novo Web Service**: Clique em **New** > **Web Service**.
3. **Conecte seu Repositório**: Selecione o repositório Git correspondente ao seu backend.
4. **Configure os Detalhes do Serviço**:
   - **Name**: `qap-rag-backend`
   - **Language**: `Node`
   - **Branch**: `main` (ou a branch de produção)
   - **Region**: Selecione uma região próxima aos seus usuários (ex: `Ohio (us-east-2)` ou `Oregon (us-west-2)`).
5. **Configurações de Build**:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
6. **Cadastre as Variáveis de Ambiente**: Clique em **Advanced** > **Add Environment Variable** e insira todas as variáveis listadas acima.
7. **Deploy**: Clique em **Create Web Service**. O Render iniciará automaticamente o download do código, a instalação de dependências, a compilação do TypeScript e a execução da aplicação.

---

## 🔗 Integração com o Frontend (Lovable)

Após o deploy ser concluído, configure a variável de ambiente correspondente no seu frontend no **Lovable**:

```env
VITE_API_URL=https://seu-servico.onrender.com
```

---

## 🧪 Como Testar e Monitorar

### Teste de Health Check (Liveness e Readiness)
Para garantir que todos os serviços externos (Supabase, Gemini e configurações) estejam conectados e operacionais em produção, acesse as URLs de health check em seu navegador ou ferramenta de requisição:

1. **Liveness Probe**:
   - URL: `https://seu-servico.onrender.com/health`
   - Resposta esperada (JSON):
     ```json
     {
       "status": "ok",
       "version": "1.0",
       "database": "connected",
       "gemini": "connected"
     }
     ```

2. **Readiness Probe detalhado**:
   - URL: `https://seu-servico.onrender.com/ready`

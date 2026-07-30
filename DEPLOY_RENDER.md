# Guia de Deploy do Backend RAG no Render – QAP IA

Este guia orienta o processo de deploy em produção do backend do **QAP RAG** na plataforma [Render](https://render.com), bem como sua integração direta com o frontend desenvolvido no Lovable.

---

## 1. Comandos de Inicialização e Build no Render

Ao criar um novo serviço no Render, utilize as seguintes configurações padrões na seção **Build & Deploy**:

- **Runtime**: `Node`
- **Build Command**: `npm run build`
- **Start Command**: `npm start`

Se preferir utilizar Docker, o repositório já dispõe de um `Dockerfile` otimizado para produção. O Render detectará automaticamente e fará o build usando-o sem necessidade de configurações manuais.

---

## 2. Variáveis de Ambiente Necessárias

Cadastre as seguintes variáveis de ambiente nas configurações do seu serviço do Render (seção **Environment**):

| Variável | Obrigatória | Descrição | Exemplo / Padrão |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | Não | Define o ambiente de execução da aplicação. | `production` |
| `PORT` | Não | A porta na qual o servidor Express escutará. Injetada dinamicamente pelo Render. | `3001` (padrão) |
| `SUPABASE_URL` | **Sim** | URL de conexão da API do seu projeto Supabase. | `https://xxxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Sim** | Chave de acesso administrativo (Service Role Key) do Supabase para transações e operações de vetor. | `eyJhbGciOiJIUzI1NiIsInR5cCI6...` |
| `GEMINI_API_KEY` | **Sim** | Chave da API do Google Gemini para geração de embeddings e processamento semântico. *(Nota: O backend também aceita `GOOGLE_API_KEY` de forma intercambiável).* | `AIzaSy...` |
| `OPENROUTER_API_KEY` | **Sim** | Chave da API do OpenRouter para orquestração das respostas de chat (LLM). | `sk-or-v1-...` |
| `ALLOWED_ORIGINS` | Não | Lista de origens permitidas pelo CORS separadas por vírgula. Se omitido, aceita por padrão o frontend do Lovable. | `https://qap-ia.lovable.app` |

---

## 3. Como Publicar no Render (Passo a Passo)

1. **Acesse o Painel do Render**: Vá para [dashboard.render.com](https://dashboard.render.com/) e faça login.
2. **Crie um Novo Web Service**: Clique em **New** > **Web Service**.
3. **Conecte seu Repositório**: Selecione o repositório Git correspondente ao seu backend.
4. **Configure os Detalhes do Serviço**:
   - **Name**: `qap-rag-backend` (ou de sua preferência)
   - **Language**: `Node`
   - **Branch**: `main` (ou a branch de produção)
   - **Region**: Selecione uma região próxima aos seus usuários (ex: `Ohio (us-east-2)` ou `Oregon (us-west-2)`).
5. **Configurações de Build**:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
6. **Cadastre as Variáveis de Ambiente**: Clique em **Advanced** > **Add Environment Variable** e insira todas as variáveis listadas no item 2.
7. **Deploy**: Clique em **Create Web Service**. O Render iniciará automaticamente o download do código, a instalação de dependências, a compilação do TypeScript e a execução da aplicação.

---

## 4. Integração com o Frontend (Lovable)

Após o deploy ser concluído, o Render gerará uma URL pública para o seu serviço, no formato:
`https://seu-servico.onrender.com`

No painel de controle ou variáveis de ambiente do seu frontend no **Lovable**, configure o endpoint utilizando a variável correspondente:

```env
VITE_API_URL=https://seu-servico.onrender.com
```

### Exemplo de Integração Direta:
Se o seu serviço no Render se chamar `qap-rag-backend`, a URL pública e a configuração serão:
```env
VITE_API_URL=https://qap-rag-backend.onrender.com
```

---

## 5. Como Testar e Monitorar

### Teste de Health Check (Liveness e Readiness)
Para garantir que todos os serviços externos (Supabase, Gemini e configurações) estejam conectados e operacionais em produção, acesse as URLs de health check em seu navegador ou ferramenta de requisição (Postman/cURL):

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
   - Resposta esperada: Retorna um JSON de diagnóstico detalhado com status individual de conexão para cada integração crítica da stack.

---

## 6. Como Atualizar Versões do Backend

Toda vez que você realizar um push de novas alterações de código para a branch monitorada pelo Render (ex: `main`), o Render detectará a alteração e iniciará um novo build e deploy automático (**Auto-Deploy**), reduzindo o tempo de inatividade a zero graças ao mecanismo de Rolling Update do Render.

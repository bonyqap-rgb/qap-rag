import { Router, Request, Response } from "express";
import { documentService } from "./documents.js";
import { indexingHistoryService } from "../services/indexing-history.service.js";
import { env } from "../config/env.js";

const router = Router();

/**
 * GET /admin
 * Serves a beautiful, self-contained administrative page for QAP RAG.
 */
router.get("/", (_req: Request, res: Response) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QAP RAG - Painel Administrativo</title>
    <style>
        :root {
            --bg-color: #f4f6f9;
            --card-bg: #ffffff;
            --text-color: #2c3e50;
            --primary-color: #3498db;
            --primary-hover: #2980b9;
            --success-color: #2ecc71;
            --danger-color: #e74c3c;
            --border-color: #e2e8f0;
            --muted-color: #7f8c8d;
        }

        [data-theme="dark"] {
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --text-color: #f1f5f9;
            --primary-color: #38bdf8;
            --primary-hover: #0ea5e9;
            --success-color: #4ade80;
            --danger-color: #f87171;
            --border-color: #334155;
            --muted-color: #94a3b8;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            padding: 0;
            transition: background-color 0.3s, color 0.3s;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 30px 15px;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            border-bottom: 2px solid var(--border-color);
            padding-bottom: 20px;
        }

        h1, h2, h3 {
            margin: 0;
            font-weight: 600;
        }

        .header-actions {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .btn {
            background-color: var(--primary-color);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s, transform 0.1s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .btn:hover {
            background-color: var(--primary-hover);
        }

        .btn:active {
            transform: scale(0.98);
        }

        .btn-success {
            background-color: var(--success-color);
        }

        .btn-success:hover {
            opacity: 0.9;
        }

        .btn-secondary {
            background-color: var(--muted-color);
        }

        .btn-secondary:hover {
            opacity: 0.9;
        }

        .btn:disabled {
            background-color: var(--border-color) !important;
            color: var(--muted-color) !important;
            cursor: not-allowed;
            transform: none !important;
        }

        .theme-toggle {
            background: none;
            border: 1px solid var(--border-color);
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            color: var(--text-color);
            font-size: 14px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            transition: transform 0.2s;
        }

        .stat-card:hover {
            transform: translateY(-2px);
        }

        .stat-label {
            font-size: 14px;
            color: var(--muted-color);
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .stat-value {
            font-size: 28px;
            font-weight: bold;
            color: var(--text-color);
        }

        .main-grid {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 30px;
        }

        @media (max-width: 900px) {
            .main-grid {
                grid-template-columns: 1fr;
            }
        }

        .card {
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 25px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            margin-bottom: 30px;
        }

        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 12px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
        }

        .form-control {
            width: 100%;
            padding: 10px 14px;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background-color: var(--bg-color);
            color: var(--text-color);
            box-sizing: border-box;
            font-size: 15px;
        }

        .form-control:focus {
            outline: none;
            border-color: var(--primary-color);
        }

        .console {
            background-color: #1e1e2e;
            color: #a6adc8;
            font-family: "Courier New", Courier, monospace;
            padding: 15px;
            border-radius: 8px;
            height: 250px;
            overflow-y: auto;
            font-size: 13px;
            line-height: 1.5;
            border: 1px solid #313244;
            margin-top: 15px;
        }

        .console-line {
            margin-bottom: 4px;
        }

        .console-line.info { color: #89b4fa; }
        .console-line.success { color: #a6e3a1; }
        .console-line.error { color: #f38ba8; }
        .console-line.warn { color: #f9e2af; }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }

        th, td {
            padding: 12px 15px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }

        th {
            background-color: var(--bg-color);
            font-weight: 600;
        }

        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
        }

        .badge-success {
            background-color: rgba(46, 204, 113, 0.2);
            color: var(--success-color);
        }

        .badge-error {
            background-color: rgba(231, 76, 60, 0.2);
            color: var(--danger-color);
        }

        .spinner {
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top: 3px solid white;
            width: 16px;
            height: 16px;
            animation: spin 1s linear infinite;
            display: inline-block;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .progress-bar-container {
            background-color: var(--bg-color);
            border-radius: 6px;
            height: 8px;
            width: 100%;
            margin-top: 15px;
            overflow: hidden;
            display: none;
        }

        .progress-bar {
            background-color: var(--success-color);
            height: 100%;
            width: 0%;
            transition: width 0.4s ease;
        }
    </style>
</head>
<body>

<div class="container">
    <header>
        <div>
            <h1>QAP RAG</h1>
            <p style="margin: 5px 0 0; color: var(--muted-color);">Painel de Controle Administrativo</p>
        </div>
        <div class="header-actions">
            <button class="theme-toggle" onclick="toggleTheme()" id="themeBtn">🌙 Escuro</button>
        </div>
    </header>

    <!-- Estatísticas Principais -->
    <div class="stats-grid" id="statsGrid">
        <div class="stat-card">
            <div class="stat-label">Total Documentos</div>
            <div class="stat-value" id="stat-total-docs">-</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Documentos Indexados</div>
            <div class="stat-value" id="stat-indexed-docs" style="color: var(--success-color);">-</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Pendentes</div>
            <div class="stat-value" id="stat-pending-docs" style="color: var(--primary-color);">-</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Total Chunks</div>
            <div class="stat-value" id="stat-total-chunks">-</div>
        </div>
    </div>

    <div class="main-grid">
        <!-- Coluna Esquerda: Ações de Indexação e Console -->
        <div>
            <div class="card">
                <div class="card-header">
                    <h2>Regenerar Embeddings (Reindexação em Massa)</h2>
                </div>
                <p style="color: var(--muted-color); margin-bottom: 20px;">
                    Esta ação irá percorrer todos os documentos concluídos na base de dados, recalcular os chunks, gerar novos embeddings de 1536 dimensões via Voyage/Nomic e atualizar o banco de dados Supabase de forma segura e sequencial.
                </p>

                <div class="form-group">
                    <label for="adminKey">Chave de Administração (SUPABASE_SERVICE_ROLE_KEY)</label>
                    <input type="password" id="adminKey" class="form-control" placeholder="Insira a chave do Supabase Service Role para autorizar" />
                </div>

                <div style="display: flex; gap: 10px; align-items: center; margin-top: 25px;">
                    <button id="reindexBtn" class="btn btn-success" onclick="triggerReindexAll()">
                        ⚡ Regenerar Embeddings
                    </button>
                    <button id="refreshStatsBtn" class="btn btn-secondary" onclick="loadStats()">
                        🔄 Atualizar Painel
                    </button>
                </div>

                <div class="progress-bar-container" id="progressBarContainer">
                    <div class="progress-bar" id="progressBar"></div>
                </div>

                <div class="console" id="console">
                    <div class="console-line info">[SISTEMA] Console administrativo iniciado e pronto para monitoramento.</div>
                </div>
            </div>

            <!-- Tabela de Histórico de Indexação -->
            <div class="card">
                <div class="card-header">
                    <h2>Histórico de Execuções de Indexação</h2>
                </div>
                <div style="overflow-x: auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>Documento</th>
                                <th>Data</th>
                                <th>Duração (ms)</th>
                                <th>Chunks</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="historyTableBody">
                            <tr>
                                <td colspan="5" style="text-align: center; color: var(--muted-color);">Carregando histórico...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Coluna Direita: Informações e Metadados do Sistema -->
        <div>
            <div class="card">
                <div class="card-header">
                    <h3>Métricas Adicionais</h3>
                </div>
                <div style="margin-top: 15px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
                        <span style="color: var(--muted-color);">Tamanho Médio Chunks</span>
                        <strong id="stat-avg-chunk-size">-</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
                        <span style="color: var(--muted-color);">Média Chunks/Doc</span>
                        <strong id="stat-avg-chunks-per-doc">-</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
                        <span style="color: var(--muted-color);">Vetores Salvos</span>
                        <strong id="stat-total-vectors">-</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                        <span style="color: var(--muted-color);">Última Indexação</span>
                        <strong id="stat-last-index-date" style="font-size: 12px;">-</strong>
                    </div>
                </div>
            </div>

            <div class="card">
                <h3>Instruções de Uso</h3>
                <p style="font-size: 14px; line-height: 1.6; color: var(--muted-color);">
                    1. Forneça a chave <strong>SUPABASE_SERVICE_ROLE_KEY</strong> no campo de senha para se autenticar.<br><br>
                    2. Clique em <strong>Regenerar Embeddings</strong>. O processo é síncrono e sequencial para evitar estouro de limite de requisições (rate limits).<br><br>
                    3. Acompanhe os logs em tempo real através do console integrado.<br><br>
                    4. O histórico de indexação registrará a execução com sucesso ou eventuais falhas ocorridas.
                </p>
            </div>
        </div>
    </div>
</div>

<script>
    // Theme Management
    function initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeButton(savedTheme);
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeButton(newTheme);
    }

    function updateThemeButton(theme) {
        const btn = document.getElementById('themeBtn');
        if (theme === 'dark') {
            btn.innerHTML = '☀️ Claro';
        } else {
            btn.innerHTML = '🌙 Escuro';
        }
    }

    // Console Logging helper
    function logToConsole(message, type = 'info') {
        const consoleEl = document.getElementById('console');
        const timestamp = new Date().toLocaleTimeString();
        const line = document.createElement('div');
        line.className = 'console-line ' + type;
        line.innerText = '[' + timestamp + '] ' + message;
        consoleEl.appendChild(line);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    // Load knowledge base statistics
    async function loadStats() {
        try {
            const res = await fetch('/documents/stats');
            if (!res.ok) throw new Error('Erro ao buscar estatísticas');
            const data = await res.json();

            document.getElementById('stat-total-docs').innerText = data.total_documentos ?? 0;
            document.getElementById('stat-indexed-docs').innerText = data.documentos_indexados ?? 0;
            document.getElementById('stat-pending-docs').innerText = data.documentos_pendentes ?? 0;
            document.getElementById('stat-total-chunks').innerText = data.total_chunks ?? 0;

            document.getElementById('stat-avg-chunk-size').innerText = (data.tamanho_medio_chunks ?? 0) + ' caract.';
            document.getElementById('stat-avg-chunks-per-doc').innerText = data.media_chunks_por_documento ?? 0;
            document.getElementById('stat-total-vectors').innerText = data.quantidade_vetores_armazenados ?? 0;

            const lastDate = data.data_ultima_indexacao;
            document.getElementById('stat-last-index-date').innerText = lastDate ? new Date(lastDate).toLocaleString() : 'Sem registros';

            logToConsole('Estatísticas do painel atualizadas com sucesso.', 'success');
        } catch (err) {
            logToConsole('Erro ao atualizar estatísticas: ' + err.message, 'error');
        }
    }

    // Load indexing runs history
    async function loadHistory() {
        try {
            const res = await fetch('/documents/history');
            if (!res.ok) throw new Error('Erro ao buscar histórico');
            const data = await res.json();

            const tbody = document.getElementById('historyTableBody');
            tbody.innerHTML = '';

            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--muted-color);">Nenhum histórico encontrado.</td></tr>';
                return;
            }

            data.forEach(item => {
                const tr = document.createElement('tr');
                const badgeClass = item.success ? 'badge-success' : 'badge-error';
                const statusText = item.success ? 'Sucesso' : 'Erro';

                tr.innerHTML = \`
                    <td><strong>\${item.document || 'Vários'}</strong></td>
                    <td>\${new Date(item.date).toLocaleString()}</td>
                    <td>\${item.duration ? item.duration + ' ms' : '-'}</td>
                    <td>\${item.chunks_count ?? '-'}</td>
                    <td><span class="badge \${badgeClass}">\${statusText}</span></td>
                \`;
                tbody.appendChild(tr);
            });
        } catch (err) {
            logToConsole('Erro ao atualizar histórico de execuções: ' + err.message, 'error');
        }
    }

    // Trigger full RAG mass reindexing
    async function triggerReindexAll() {
        const keyInput = document.getElementById('adminKey');
        const adminKey = keyInput.value.trim();

        if (!adminKey) {
            logToConsole('Erro: Você deve preencher a Chave de Administração para autorizar a reindexação.', 'error');
            alert('Por favor, informe a Chave de Administração!');
            return;
        }

        const reindexBtn = document.getElementById('reindexBtn');
        const originalText = reindexBtn.innerHTML;

        reindexBtn.disabled = true;
        reindexBtn.innerHTML = '<span class="spinner"></span> Processando...';

        const progressBarContainer = document.getElementById('progressBarContainer');
        const progressBar = document.getElementById('progressBar');
        progressBarContainer.style.display = 'block';
        progressBar.style.width = '20%';

        logToConsole('Iniciando requisição de reindexação em massa para o servidor...', 'info');

        try {
            progressBar.style.width = '50%';
            const res = await fetch('/documents/reindex-all', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-key': adminKey
                }
            });

            progressBar.style.width = '80%';

            if (res.status === 401) {
                throw new Error('Chave de Administração incorreta ou não autorizada pelo servidor (401).');
            }

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || 'Erro ' + res.status + ' ao processar reindexação.');
            }

            const result = await res.json();
            progressBar.style.width = '100%';

            logToConsole('Processo de reindexação em massa finalizado com sucesso!', 'success');
            logToConsole('Documentos processados: ' + result.documentsProcessed, 'success');
            logToConsole('Total de chunks gerados: ' + result.chunksProcessed, 'success');
            logToConsole('Tempo de execução: ' + result.durationMs + ' ms', 'success');

            if (result.errors && result.errors.length > 0) {
                logToConsole('Aviso: Ocorreram alguns erros durante a reindexação:', 'warn');
                result.errors.forEach(err => {
                    logToConsole('  - Documento ' + err.documentId + ': ' + err.error, 'error');
                });
            }

            // Reload visual elements
            await loadStats();
            await loadHistory();

        } catch (err) {
            logToConsole('Falha crítica na reindexação: ' + err.message, 'error');
            progressBar.style.backgroundColor = 'var(--danger-color)';
            progressBar.style.width = '100%';
        } finally {
            setTimeout(() => {
                reindexBtn.disabled = false;
                reindexBtn.innerHTML = originalText;
                progressBarContainer.style.display = 'none';
                progressBar.style.width = '0%';
                progressBar.style.backgroundColor = 'var(--success-color)';
            }, 3000);
        }
    }

    // Startup Initialization
    window.addEventListener('DOMContentLoaded', () => {
        initTheme();
        loadStats();
        loadHistory();
    });
</script>

</body>
</html>
`);
});

export default router;

import { env } from "../config/env.js";

interface MemoryMetrics {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
}

interface CpuMetrics {
  user: number;
  system: number;
}

interface ProcessMetrics {
  uptime: number;
  versao: string;
  ambiente: string;
  memoriaUtilizada: MemoryMetrics;
  usoCpu: CpuMetrics | null;
  tempoMedioRequisicoesMs: number;
  numeroTotalRequisicoes: number;
  quantidadeErros: number;
  quantidadeChatsExecutados: number;
  quantidadeBuscasRAG: number;
}

class MetricsService {
  private totalRequests = 0;
  private totalErrors = 0;
  private chatsExecuted = 0;
  private searchesExecuted = 0;
  private totalRequestTime = 0;
  private totalRequestCount = 0;

  public incrementRequests(): void {
    this.totalRequests++;
  }

  public incrementErrors(): void {
    this.totalErrors++;
  }

  public incrementChats(): void {
    this.chatsExecuted++;
  }

  public incrementSearches(): void {
    this.searchesExecuted++;
  }

  public addRequestTime(durationMs: number): void {
    this.totalRequestTime += durationMs;
    this.totalRequestCount++;
  }

  public getMetrics(): ProcessMetrics {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage ? process.cpuUsage() : null;

    return {
      uptime: process.uptime(),
      versao: "1.0.0",
      ambiente: env.NODE_ENV || "development",
      memoriaUtilizada: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
      },
      usoCpu: cpu ? {
        user: cpu.user,
        system: cpu.system,
      } : null,
      tempoMedioRequisicoesMs: this.totalRequestCount > 0 ? parseFloat((this.totalRequestTime / this.totalRequestCount).toFixed(2)) : 0,
      numeroTotalRequisicoes: this.totalRequests,
      quantidadeErros: this.totalErrors,
      quantidadeChatsExecutados: this.chatsExecuted,
      quantidadeBuscasRAG: this.searchesExecuted,
    };
  }

  // Helper method to reset state for clean test isolation
  public reset(): void {
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.chatsExecuted = 0;
    this.searchesExecuted = 0;
    this.totalRequestTime = 0;
    this.totalRequestCount = 0;
  }
}

export const metricsService = new MetricsService();

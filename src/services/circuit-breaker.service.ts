import { env } from "../config/env.js";

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private failureThreshold: number;
  private cooldown: number;
  private name: string;

  constructor(name: string, failureThreshold = env.CB_FAILURE_THRESHOLD, cooldown = env.CB_COOLDOWN) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.cooldown = cooldown;
  }

  getState(): CircuitState {
    this.checkCooldown();
    return this.state;
  }

  private checkCooldown(): void {
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.cooldown) {
        this.state = CircuitState.HALF_OPEN;
        console.warn(`[CIRCUIT BREAKER] Circuit '${this.name}' transitioned from OPEN to HALF_OPEN.`);
      }
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkCooldown();

    if (this.state === CircuitState.OPEN) {
      throw new Error(`Circuito do serviço '${this.name}' está aberto. Chamada rejeitada imediatamente.`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      console.log(`[CIRCUIT BREAKER] Circuit '${this.name}' transitioned from HALF_OPEN to CLOSED (Successful recovery).`);
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      console.error(`[CIRCUIT BREAKER] Circuit '${this.name}' transitioned from CLOSED to OPEN. Failure count: ${this.failureCount}`);
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      console.error(`[CIRCUIT BREAKER] Circuit '${this.name}' transitioned from HALF_OPEN to OPEN due to immediate failure.`);
    }
  }

  // Helper for tests to force/reset state
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

// Instantiate specific circuit breakers for Gemini (Embeddings) and OpenRouter (Chat)
export const geminiCircuitBreaker = new CircuitBreaker("GeminiEmbedding");
export const chatCircuitBreaker = new CircuitBreaker("OpenRouterChat");

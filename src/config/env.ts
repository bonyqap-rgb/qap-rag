import dotenv from "dotenv";

// Fully centralize loading of dotenv here, so we do not have direct dotenv.config() elsewhere
dotenv.config();

interface EnvVariables {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GEMINI_API_KEY: string;
  NODE_ENV: string;
  PORT: number;
  ALLOWED_ORIGINS: string[];
  DEFAULT_TOP_K: number;
  DEFAULT_MIN_SCORE: number;
  DEFAULT_MAX_CONTEXT_SIZE: number;

  // Cache settings
  EMBEDDING_CACHE_TTL: number; // in seconds
  EMBEDDING_CACHE_MAX_SIZE: number;

  // Retry & Timeouts settings
  LLM_TIMEOUT: number; // in milliseconds
  LLM_RETRIES: number;
  LLM_RETRY_DELAY: number; // in milliseconds

  // Circuit Breaker settings
  CB_FAILURE_THRESHOLD: number; // consecutive failures
  CB_COOLDOWN: number; // in milliseconds (time to wait before going HALF_OPEN)

  // Rate Limiter settings
  RATE_LIMIT_WINDOW_MS: number; // time window in ms
  RATE_LIMIT_MAX_CHAT: number; // max requests per window for /chat
  RATE_LIMIT_MAX_SEARCH: number; // max requests per window for /search
  RATE_LIMIT_MAX_INDEX: number; // max requests per window for /documents/index
}

function validateEnv(): EnvVariables {
  // Normalize GOOGLE_API_KEY to GEMINI_API_KEY and vice versa to allow both key names
  if (process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
  } else if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    process.env.GOOGLE_API_KEY = process.env.GEMINI_API_KEY;
  }

  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GEMINI_API_KEY",
  ];

  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    // Standardize startup failure when variables are missing
    console.error(`\n[FATAL STARTUP ERROR] Falta configurar as variáveis de ambiente obrigatórias: ${missing.join(", ")}\n`);
    process.exit(1);
  }

  return {
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY!,
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : ["https://qap-ia.lovable.app"],
    DEFAULT_TOP_K: process.env.DEFAULT_TOP_K ? parseInt(process.env.DEFAULT_TOP_K, 10) : 5,
    DEFAULT_MIN_SCORE: process.env.DEFAULT_MIN_SCORE ? parseFloat(process.env.DEFAULT_MIN_SCORE) : 0.3,
    DEFAULT_MAX_CONTEXT_SIZE: process.env.DEFAULT_MAX_CONTEXT_SIZE ? parseInt(process.env.DEFAULT_MAX_CONTEXT_SIZE, 10) : 4000,

    // Cache defaults: TTL 1 day (86400s), max size 1000
    EMBEDDING_CACHE_TTL: process.env.EMBEDDING_CACHE_TTL ? parseInt(process.env.EMBEDDING_CACHE_TTL, 10) : 86400,
    EMBEDDING_CACHE_MAX_SIZE: process.env.EMBEDDING_CACHE_MAX_SIZE ? parseInt(process.env.EMBEDDING_CACHE_MAX_SIZE, 10) : 1000,

    // Retry & Timeouts defaults
    LLM_TIMEOUT: process.env.LLM_TIMEOUT ? parseInt(process.env.LLM_TIMEOUT, 10) : 25000,
    LLM_RETRIES: process.env.LLM_RETRIES ? parseInt(process.env.LLM_RETRIES, 10) : 3,
    LLM_RETRY_DELAY: process.env.LLM_RETRY_DELAY ? parseInt(process.env.LLM_RETRY_DELAY, 10) : 1000,

    // Circuit Breaker defaults: 5 failures, 30s cooldown
    CB_FAILURE_THRESHOLD: process.env.CB_FAILURE_THRESHOLD ? parseInt(process.env.CB_FAILURE_THRESHOLD, 10) : 5,
    CB_COOLDOWN: process.env.CB_COOLDOWN ? parseInt(process.env.CB_COOLDOWN, 10) : 30000,

    // Rate Limiting defaults: 15 minutes window, 100 reqs for chat/search, 20 for index
    RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) : 15 * 60 * 1000,
    RATE_LIMIT_MAX_CHAT: process.env.RATE_LIMIT_MAX_CHAT ? parseInt(process.env.RATE_LIMIT_MAX_CHAT, 10) : 100,
    RATE_LIMIT_MAX_SEARCH: process.env.RATE_LIMIT_MAX_SEARCH ? parseInt(process.env.RATE_LIMIT_MAX_SEARCH, 10) : 100,
    RATE_LIMIT_MAX_INDEX: process.env.RATE_LIMIT_MAX_INDEX ? parseInt(process.env.RATE_LIMIT_MAX_INDEX, 10) : 20,
  };
}

export const env = validateEnv();

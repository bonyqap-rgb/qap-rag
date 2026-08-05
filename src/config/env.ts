import dotenv from "dotenv";

// Fully centralize loading of dotenv here, so we do not have direct dotenv.config() elsewhere
dotenv.config();

interface EnvVariables {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GROQ_API_KEY: string;
  NODE_ENV: string;
  PORT: number;
  ALLOWED_ORIGINS: string[];
  DEFAULT_CHAT_MODEL: string;
  DEFAULT_TOP_K: number;
  DEFAULT_MIN_SCORE: number;
  DEFAULT_MAX_CONTEXT_SIZE: number;
  DEFAULT_MIN_CHUNKS_PER_DOCUMENT: number;

  // Retrieval Settings (Centralized in PR 5)
  RRF_K: number;
  MAX_RESULTS: number;
  MAX_CONTEXT_CHUNKS: number;
  MIN_VECTOR_SCORE: number;
  MIN_LEXICAL_SCORE: number;
  MAX_CHUNKS_PER_DOCUMENT: number;
  MAX_CONTEXT_SIZE: number;
  DIVERSITY_SCORE_GAP: number;
  MAX_OVERLAP_THRESHOLD: number;

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

  // Embeddings provider keys (optional, dynamic fallback)
  VOYAGE_API_KEY?: string;
  NOMIC_API_KEY?: string;
}

function validateEnv(): EnvVariables {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GROQ_API_KEY",
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

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const groqApiKey = (process.env.GROQ_API_KEY || "").trim();
  const voyageApiKey = process.env.VOYAGE_API_KEY ? process.env.VOYAGE_API_KEY.trim() : undefined;
  const nomicApiKey = process.env.NOMIC_API_KEY ? process.env.NOMIC_API_KEY.trim() : undefined;
  const groqChatModel = process.env.GROQ_CHAT_MODEL ? process.env.GROQ_CHAT_MODEL.trim() : "llama-3.3-70b-versatile";

  return {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
    GROQ_API_KEY: groqApiKey,
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : ["https://qap-ia.lovable.app", "https://hoppscotch.io"],
    DEFAULT_CHAT_MODEL: groqChatModel,
    DEFAULT_TOP_K: process.env.DEFAULT_TOP_K ? parseInt(process.env.DEFAULT_TOP_K, 10) : 5,
    DEFAULT_MIN_SCORE: process.env.DEFAULT_MIN_SCORE ? parseFloat(process.env.DEFAULT_MIN_SCORE) : 0.3,
    DEFAULT_MAX_CONTEXT_SIZE: process.env.DEFAULT_MAX_CONTEXT_SIZE ? parseInt(process.env.DEFAULT_MAX_CONTEXT_SIZE, 10) : 4000,
    DEFAULT_MIN_CHUNKS_PER_DOCUMENT: process.env.MIN_CHUNKS_PER_DOCUMENT ? parseInt(process.env.MIN_CHUNKS_PER_DOCUMENT, 10) : 3,

    // Retrieval Settings (Centralized in PR 5)
    RRF_K: process.env.RRF_K ? parseInt(process.env.RRF_K, 10) : 60,
    MAX_RESULTS: process.env.MAX_RESULTS ? parseInt(process.env.MAX_RESULTS, 10) : (process.env.DEFAULT_TOP_K ? parseInt(process.env.DEFAULT_TOP_K, 10) : 5),
    MAX_CONTEXT_CHUNKS: process.env.MAX_CONTEXT_CHUNKS ? parseInt(process.env.MAX_CONTEXT_CHUNKS, 10) : 10,
    MIN_VECTOR_SCORE: process.env.MIN_VECTOR_SCORE ? parseFloat(process.env.MIN_VECTOR_SCORE) : 0.15,
    MIN_LEXICAL_SCORE: process.env.MIN_LEXICAL_SCORE ? parseFloat(process.env.MIN_LEXICAL_SCORE) : 0.01,
    MAX_CHUNKS_PER_DOCUMENT: process.env.MAX_CHUNKS_PER_DOCUMENT ? parseInt(process.env.MAX_CHUNKS_PER_DOCUMENT, 10) : 4,
    MAX_CONTEXT_SIZE: process.env.MAX_CONTEXT_SIZE ? parseInt(process.env.MAX_CONTEXT_SIZE, 10) : (process.env.DEFAULT_MAX_CONTEXT_SIZE ? parseInt(process.env.DEFAULT_MAX_CONTEXT_SIZE, 10) : 4000),
    DIVERSITY_SCORE_GAP: process.env.DIVERSITY_SCORE_GAP ? parseFloat(process.env.DIVERSITY_SCORE_GAP) : 0.25,
    MAX_OVERLAP_THRESHOLD: process.env.MAX_OVERLAP_THRESHOLD ? parseFloat(process.env.MAX_OVERLAP_THRESHOLD) : 0.7,

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

    // Embeddings API Keys
    VOYAGE_API_KEY: voyageApiKey,
    NOMIC_API_KEY: nomicApiKey,
  };
}

export const env = validateEnv();

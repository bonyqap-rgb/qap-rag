import dotenv from "dotenv";

// Fully centralize loading of dotenv here, so we do not have direct dotenv.config() elsewhere
dotenv.config();

interface EnvVariables {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GOOGLE_API_KEY: string;
  OPENROUTER_API_KEY: string;
  NODE_ENV: string;
  PORT: number;
  DEFAULT_TOP_K: number;
  DEFAULT_MIN_SCORE: number;
  DEFAULT_MAX_CONTEXT_SIZE: number;
}

function validateEnv(): EnvVariables {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOOGLE_API_KEY",
    "OPENROUTER_API_KEY",
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
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY!,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY!,
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
    DEFAULT_TOP_K: process.env.DEFAULT_TOP_K ? parseInt(process.env.DEFAULT_TOP_K, 10) : 5,
    DEFAULT_MIN_SCORE: process.env.DEFAULT_MIN_SCORE ? parseFloat(process.env.DEFAULT_MIN_SCORE) : 0.3,
    DEFAULT_MAX_CONTEXT_SIZE: process.env.DEFAULT_MAX_CONTEXT_SIZE ? parseInt(process.env.DEFAULT_MAX_CONTEXT_SIZE, 10) : 4000,
  };
}

export const env = validateEnv();

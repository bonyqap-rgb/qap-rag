import dotenv from "dotenv";

dotenv.config();

interface EnvVariables {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GOOGLE_API_KEY: string;
  OPENROUTER_API_KEY: string;
  PORT: number;
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
    throw new Error(
      `Falta configurar as variáveis de ambiente obrigatórias: ${missing.join(
        ", "
      )}`
    );
  }

  return {
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY!,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY!,
    PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  };
}

export const env = validateEnv();

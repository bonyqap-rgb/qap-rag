import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// Polyfill WebSocket for Node.js < 22 to prevent @supabase/supabase-js from crashing on startup
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as any).WebSocket = class WebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
      // Noop / throw error if instantiated since we don't use Supabase Realtime/websockets
      throw new Error("Mock WebSocket should not be instantiated in this application.");
    }
  };
}

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export interface LogMetadata {
  requestId?: string;
  method?: string;
  route?: string;
  stack?: string;
  [key: string]: any;
}

class Logger {
  private formatMessage(level: LogLevel, message: string, metadata?: LogMetadata): string {
    const timestamp = new Date().toISOString();
    let metaStr = "";

    if (metadata) {
      const parts: string[] = [];
      if (metadata.requestId) parts.push(`reqId=${metadata.requestId}`);
      if (metadata.method) parts.push(`method=${metadata.method}`);
      if (metadata.route) parts.push(`route=${metadata.route}`);

      const extra = { ...metadata };
      delete extra.requestId;
      delete extra.method;
      delete extra.route;
      delete extra.stack;

      if (Object.keys(extra).length > 0) {
        parts.push(`extra=${JSON.stringify(extra)}`);
      }

      if (parts.length > 0) {
        metaStr = ` [${parts.join(" ")}]`;
      }
    }

    return `[${timestamp}] [${level}]${metaStr} ${message}`;
  }

  info(message: string, metadata?: LogMetadata) {
    console.log(this.formatMessage(LogLevel.INFO, message, metadata));
  }

  warn(message: string, metadata?: LogMetadata) {
    console.warn(this.formatMessage(LogLevel.WARN, message, metadata));
  }

  error(message: string, err?: any, metadata?: LogMetadata) {
    const enrichedMeta: LogMetadata = { ...metadata };
    if (err instanceof Error) {
      enrichedMeta.stack = err.stack;
      if (!enrichedMeta.message) {
        message = `${message}: ${err.message}`;
      }
    } else if (err && typeof err === "object") {
      enrichedMeta.errorDetails = err;
    } else if (err) {
      enrichedMeta.errorDetails = String(err);
    }

    console.error(this.formatMessage(LogLevel.ERROR, message, enrichedMeta));
    if (enrichedMeta.stack) {
      console.error(enrichedMeta.stack);
    }
  }
}

export const logger = new Logger();

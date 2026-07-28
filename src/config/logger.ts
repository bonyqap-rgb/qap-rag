export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

class Logger {
  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  info(message: string, ...args: any[]) {
    console.log(this.formatMessage(LogLevel.INFO, message), ...args);
  }

  warn(message: string, ...args: any[]) {
    console.warn(this.formatMessage(LogLevel.WARN, message), ...args);
  }

  error(message: string, error?: any, ...args: any[]) {
    console.error(this.formatMessage(LogLevel.ERROR, message), ...args);
    if (error) {
      if (error instanceof Error) {
        console.error(error.stack || error.message);
      } else {
        console.error(error);
      }
    }
  }
}

export const logger = new Logger();

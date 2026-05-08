function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function send(level: string, msg: string): void {
  (globalThis as typeof window)._walBridge?.log(level, msg);
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    const full = context ? `${message} ${JSON.stringify(context)}` : message;
    console.debug(full);
    send("debug", full);
  },
  info(message: string, context?: Record<string, unknown>) {
    const full = context ? `${message} ${JSON.stringify(context)}` : message;
    console.info(full);
    send("info", full);
  },
  warn(message: string, context?: Record<string, unknown>) {
    const full = context ? `${message} ${JSON.stringify(context)}` : message;
    console.warn(full);
    send("warn", full);
  },
  errorFrom(message: string, error: unknown, context?: Record<string, unknown>) {
    const ctx = { ...(context ?? {}), error: normalizeError(error) };
    const full = `${message} ${JSON.stringify(ctx)}`;
    console.error(full);
    send("error", full);
  },
};

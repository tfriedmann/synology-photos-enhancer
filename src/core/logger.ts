/**
 * Namespaced, level-filtered logging.
 *
 * The only module allowed to touch `console` (enforced by ESLint). Everything
 * else logs through here, so that:
 *
 * - output is prefixed and traceable to a plugin,
 * - a user can silence us entirely — we are a guest in Synology's page, and a
 *   chatty extension makes their console useless for their own debugging,
 * - the default is `warn`: silent when healthy, loud when broken.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

export interface Logger {
  debug(...args: readonly unknown[]): void;
  info(...args: readonly unknown[]): void;
  warn(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
  /** Derives a sub-logger, e.g. `spe:plugin:google-maps`. */
  child(namespace: string): Logger;
  /** Applies to this logger and every child derived from it, past or future. */
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
}

const ROOT_NAMESPACE = 'spe';

/**
 * @param namespace Appended to the parent namespace with `:`.
 * @param level Initial threshold. Messages below it are dropped.
 */
export function createLogger(namespace: string = ROOT_NAMESPACE, level: LogLevel = 'warn'): Logger {
  /* Boxed so `setLevel` on any logger in the tree reaches every relative:
   * children share the parent's box rather than copying its value. */
  const state = { level };

  function build(ns: string): Logger {
    const prefix = `[${ns}]`;

    const write = (method: 'debug' | 'info' | 'warn' | 'error', args: readonly unknown[]): void => {
      if (LEVEL_RANK[method] < LEVEL_RANK[state.level]) return;
      console[method](prefix, ...args);
    };

    return {
      debug: (...args) => {
        write('debug', args);
      },
      info: (...args) => {
        write('info', args);
      },
      warn: (...args) => {
        write('warn', args);
      },
      error: (...args) => {
        write('error', args);
      },
      child: (child) => build(`${ns}:${child}`),
      setLevel: (next) => {
        state.level = next;
      },
      getLevel: () => state.level,
    };
  }

  return build(namespace);
}

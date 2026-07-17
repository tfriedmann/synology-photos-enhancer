import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger, isLogLevel } from '@/core/logger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isLogLevel', () => {
  it('accepts the known levels', () => {
    expect(isLogLevel('debug')).toBe(true);
    expect(isLogLevel('silent')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isLogLevel('shouty')).toBe(false);
    expect(isLogLevel(undefined)).toBe(false);
    expect(isLogLevel(3)).toBe(false);
  });
});

describe('createLogger', () => {
  it('prefixes with the namespace', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createLogger('spe', 'debug').warn('hello');

    expect(spy).toHaveBeenCalledExactlyOnceWith('[spe]', 'hello');
  });

  it('drops messages below the level', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    createLogger('spe', 'warn').debug('noise');

    expect(spy).not.toHaveBeenCalled();
  });

  it('emits messages at or above the level', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createLogger('spe', 'warn');

    logger.warn('a');
    logger.error('b');

    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it('silent drops everything, including errors', () => {
    /* The user must be able to shut us up completely: their console belongs to
     * their app, not to us. */
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createLogger('spe', 'silent').error('boom');

    expect(spy).not.toHaveBeenCalled();
  });

  it('child() nests the namespace', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    createLogger('spe', 'debug').child('plugins').child('google-maps').info('hi');

    expect(spy).toHaveBeenCalledExactlyOnceWith('[spe:plugins:google-maps]', 'hi');
  });

  it('passes every argument through', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    createLogger('spe', 'debug').info('event', { id: 1 }, 42);

    expect(spy).toHaveBeenCalledExactlyOnceWith('[spe]', 'event', { id: 1 }, 42);
  });

  describe('setLevel', () => {
    it('changes what is emitted', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      const logger = createLogger('spe', 'warn');

      logger.debug('dropped');
      logger.setLevel('debug');
      logger.debug('kept');

      expect(spy).toHaveBeenCalledExactlyOnceWith('[spe]', 'kept');
      expect(logger.getLevel()).toBe('debug');
    });

    it('reaches children created before the change', () => {
      /* The level is shared across the tree, so flipping it in the popup
       * affects every plugin's logger at once — the whole point of the setting. */
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      const root = createLogger('spe', 'warn');
      const child = root.child('plugins');

      root.setLevel('debug');
      child.debug('kept');

      expect(spy).toHaveBeenCalledOnce();
    });

    it('a child can raise the level for the whole tree', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      const root = createLogger('spe', 'debug');
      const child = root.child('plugins');

      child.setLevel('silent');
      root.debug('dropped');

      expect(spy).not.toHaveBeenCalled();
    });
  });
});

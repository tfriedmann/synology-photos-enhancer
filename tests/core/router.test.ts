import { describe, expect, it, vi } from 'vitest';

import { createRouter, isSameRoute, parseRoute } from '@/core/router';

describe('parseRoute', () => {
  /* The one route shape confirmed against a real Synology instance. If this
   * breaks, everything downstream is guessing. */
  it('parses the confirmed folder+item route', () => {
    const route = parseRoute('#/shared_space/folder/1901/item/44246');

    expect(route.space).toBe('shared_space');
    expect(route.view).toBe('folder');
    expect(route.params).toEqual({ folder: 1901, item: 44246 });
    expect(route.itemId).toBe(44246);
    expect(route.segments).toEqual(['shared_space', 'folder', '1901', 'item', '44246']);
  });

  it('parses a bare timeline route', () => {
    const route = parseRoute('#/personal_space/timeline');

    expect(route.space).toBe('personal_space');
    expect(route.view).toBe('timeline');
    expect(route.itemId).toBeUndefined();
    expect(route.params).toEqual({});
  });

  it('accepts a hash with or without the leading #', () => {
    expect(parseRoute('#/personal_space/timeline').raw).toBe('/personal_space/timeline');
    expect(parseRoute('/personal_space/timeline').raw).toBe('/personal_space/timeline');
  });

  it('keeps the raw hash so plugins can parse shapes we did not anticipate', () => {
    expect(parseRoute('#/something/brand/new').raw).toBe('/something/brand/new');
  });

  describe('tolerance', () => {
    /* Synology can change this scheme in any DSM release. Degrading beats
     * throwing: a plugin loses a feature, the page keeps working. */
    it('marks an unrecognised space as unknown rather than failing', () => {
      const route = parseRoute('#/martian_space/timeline');
      expect(route.space).toBe('unknown');
      expect(route.segments).toEqual(['martian_space', 'timeline']);
    });

    it('handles an empty hash', () => {
      const route = parseRoute('');
      expect(route.space).toBe('unknown');
      expect(route.segments).toEqual([]);
      expect(route.itemId).toBeUndefined();
    });

    it('handles a lone #', () => {
      expect(parseRoute('#').segments).toEqual([]);
    });

    it('ignores empty and duplicated separators', () => {
      expect(parseRoute('#//shared_space///folder//1901//').segments).toEqual([
        'shared_space',
        'folder',
        '1901',
      ]);
    });

    it('drops a query string from the segments', () => {
      const route = parseRoute('#/shared_space/folder/1901?sort=date');
      expect(route.segments).toEqual(['shared_space', 'folder', '1901']);
      expect(route.params).toEqual({ folder: 1901 });
    });

    it('ignores non-numeric pair values instead of coercing them', () => {
      /* `folder/abc` is a path, not a parameter. Number('abc') would be NaN and
       * poison every comparison downstream. */
      const route = parseRoute('#/shared_space/folder/abc');
      expect(route.params).toEqual({});
      expect(route.view).toBe('folder');
    });

    it('ignores a trailing name with no value', () => {
      const route = parseRoute('#/shared_space/folder/1901/item');
      expect(route.params).toEqual({ folder: 1901 });
      expect(route.itemId).toBeUndefined();
    });

    it('decodes percent-encoded segments', () => {
      expect(parseRoute('#/shared_space/album/My%20Album').segments[2]).toBe('My Album');
    });

    it('falls back to the raw segment on malformed encoding', () => {
      expect(parseRoute('#/shared_space/album/%E0%A4%A').segments[2]).toBe('%E0%A4%A');
    });
  });
});

describe('isSameRoute', () => {
  it('compares by raw hash', () => {
    expect(isSameRoute(parseRoute('#/a/1'), parseRoute('#/a/1'))).toBe(true);
    expect(isSameRoute(parseRoute('#/a/1'), parseRoute('#/a/2'))).toBe(false);
  });

  it('treats undefined as different', () => {
    expect(isSameRoute(undefined, parseRoute('#/a/1'))).toBe(false);
  });
});

/** A minimal fake of the window surface the router touches. */
function fakeScope(initialHash: string) {
  const listeners = new Map<string, Set<EventListener>>();

  return {
    location: { hash: initialHash },
    addEventListener(type: string, listener: EventListener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) listener(new Event(type));
    },
    navigate(hash: string) {
      this.location.hash = hash;
    },
  };
}

describe('createRouter', () => {
  it('exposes the route it started on', () => {
    const scope = fakeScope('#/personal_space/timeline');
    const router = createRouter({
      onChange: vi.fn(),
      scope: scope as unknown as Window,
    });

    expect(router.current.view).toBe('timeline');
  });

  it('reports hashchange with the previous route', () => {
    const scope = fakeScope('#/personal_space/timeline');
    const onChange = vi.fn();
    createRouter({ onChange, scope: scope as unknown as Window });

    scope.navigate('#/shared_space/folder/1901/item/44246');
    scope.fire('hashchange');

    expect(onChange).toHaveBeenCalledOnce();
    const [next, previous] = onChange.mock.calls[0] as [
      ReturnType<typeof parseRoute>,
      ReturnType<typeof parseRoute>,
    ];
    expect(next.itemId).toBe(44246);
    expect(previous.view).toBe('timeline');
  });

  it('reports popstate too', () => {
    const scope = fakeScope('#/a');
    const onChange = vi.fn();
    createRouter({ onChange, scope: scope as unknown as Window });

    scope.navigate('#/b');
    scope.fire('popstate');

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('stays silent when the hash did not actually change', () => {
    /* Synology fires plenty of redundant events; re-emitting on each would make
     * every plugin re-render for nothing. */
    const scope = fakeScope('#/a');
    const onChange = vi.fn();
    createRouter({ onChange, scope: scope as unknown as Window });

    scope.fire('hashchange');
    scope.fire('popstate');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('refresh() picks up a change that fired no event', () => {
    /* This is the pushState path: the MAIN world bridge tells us, since
     * pushState fires nothing on its own. */
    const scope = fakeScope('#/a');
    const onChange = vi.fn();
    const router = createRouter({ onChange, scope: scope as unknown as Window });

    scope.navigate('#/b');
    router.refresh();

    expect(onChange).toHaveBeenCalledOnce();
    expect(router.current.raw).toBe('/b');
  });

  it('current tracks the latest route', () => {
    const scope = fakeScope('#/a');
    const router = createRouter({ onChange: vi.fn(), scope: scope as unknown as Window });

    scope.navigate('#/shared_space/folder/7/item/9');
    scope.fire('hashchange');

    expect(router.current.itemId).toBe(9);
  });
});

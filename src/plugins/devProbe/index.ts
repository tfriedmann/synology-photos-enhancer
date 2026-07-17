import { definePlugin } from '@/core/plugin';

/**
 * Logs every core event. No UI, no business behaviour.
 *
 * It exists for two reasons:
 *
 * 1. **It proves the chain end to end.** MAIN world patch → `postMessage` →
 *    bridge → EventBus → plugin. Unit tests cover each link in isolation; only
 *    a real plugin against a real NAS proves they are actually connected. Turn
 *    it on and open a photo: if `photo:changed` appears with GPS, the whole
 *    architecture works.
 * 2. **It is the reference plugin.** It is the shortest complete example of the
 *    contract — `definePlugin`, `ctx.log`, and `{ signal }` on every listener,
 *    which is why it needs no `teardown()`.
 *
 * Disabled by default: it is a debugging tool, and it is loud.
 */
export default definePlugin({
  id: 'dev-probe',
  name: 'Developer probe',
  description: 'Logs core events to the console. For development and bug reports.',
  enabledByDefault: false,

  setup({ bus, log, router, photos, signal }) {
    log.info('Probe active. Set logLevel to "debug" to see every event.');
    log.debug('Initial route', router.current);
    if (photos.current) log.debug('Photo already open', photos.current.item.id);

    /* `{ signal }` on every listener is the whole cleanup story: when the
     * registry aborts this plugin's controller, all four unsubscribe at once. */
    bus.on(
      'photo:changed',
      ({ item, space, gps }) => {
        log.info('photo:changed', {
          id: item.id,
          filename: item.filename,
          space,
          gps: gps ? `${String(gps.latitude)}, ${String(gps.longitude)}` : 'none',
          cacheKey: item.additional?.thumbnail?.cache_key ?? 'none',
        });
      },
      { signal },
    );

    bus.on(
      'route:changed',
      ({ route }) => {
        log.debug('route:changed', {
          raw: route.raw,
          space: route.space,
          view: route.view,
          itemId: route.itemId,
        });
      },
      { signal },
    );

    bus.on(
      'api:response',
      ({ url, method, status }) => {
        /* Bodies can be large and contain filenames; the URL is enough to see
         * that traffic is flowing, and stays safe to paste into a bug report. */
        log.debug('api:response', method, status, url);
      },
      { signal },
    );

    bus.on(
      'dom:mutation',
      ({ mutations }) => {
        log.debug(`dom:mutation (${String(mutations.length)} records)`);
      },
      { signal },
    );
  },
});

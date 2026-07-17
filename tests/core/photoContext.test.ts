import { describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '@/core/eventBus';
import { createLogger } from '@/core/logger';
import { createPhotoContext } from '@/core/photoContext';
import type { AppEventMap } from '@/types/events';

import {
  errorResponse,
  listingResponse,
  otherItemWithGps,
  PERSONAL_ITEM_URL,
  singleItemWithGps,
  singleItemWithoutGps,
  TEAM_ITEM_URL,
  UNIDENTIFIED_WEBAPI_URL,
} from '../fixtures/synology';

function setup(): {
  bus: EventBus<AppEventMap>;
  onPhoto: ReturnType<typeof vi.fn>;
  respond: (url: string, body: unknown) => void;
  photos: ReturnType<typeof createPhotoContext>;
} {
  const bus = createEventBus<AppEventMap>();
  const photos = createPhotoContext({ bus, logger: createLogger('test', 'silent') });
  const onPhoto = vi.fn();
  bus.on('photo:changed', onPhoto);

  return {
    bus,
    onPhoto,
    photos,
    respond: (url, body) => {
      bus.emit('api:response', { url, method: 'GET', status: 200, body });
    },
  };
}

describe('createPhotoContext', () => {
  it('emits photo:changed with the item, space and GPS', () => {
    const { respond, onPhoto } = setup();

    respond(TEAM_ITEM_URL, singleItemWithGps);

    expect(onPhoto).toHaveBeenCalledOnce();
    const [payload] = onPhoto.mock.calls[0] as [AppEventMap['photo:changed']];
    expect(payload.item.id).toBe(44246);
    expect(payload.space).toBe('team');
    expect(payload.gps).toEqual({ latitude: 48.85837, longitude: 2.294481 });
  });

  it('reports the personal space for SYNO.Foto.Browse.Item', () => {
    const { respond, onPhoto } = setup();

    respond(PERSONAL_ITEM_URL, singleItemWithGps);

    const [payload] = onPhoto.mock.calls[0] as [AppEventMap['photo:changed']];
    expect(payload.space).toBe('personal');
  });

  it('exposes the current photo for plugins that start late', () => {
    const { respond, photos } = setup();

    expect(photos.current).toBeUndefined();
    respond(TEAM_ITEM_URL, singleItemWithGps);
    expect(photos.current?.item.id).toBe(44246);
    expect(photos.current?.space).toBe('team');
  });

  it('emits again when the user moves to another photo', () => {
    const { respond, onPhoto } = setup();

    respond(TEAM_ITEM_URL, singleItemWithGps);
    respond(TEAM_ITEM_URL, otherItemWithGps);

    expect(onPhoto).toHaveBeenCalledTimes(2);
    const [payload] = onPhoto.mock.calls[1] as [AppEventMap['photo:changed']];
    expect(payload.item.id).toBe(44247);
  });

  describe('the single-item rule', () => {
    /* These are the tests that matter most in this file.
     *
     * `Browse.Item` serves both the grid listing and the open photo, and they
     * are indistinguishable by URL. Reading `list[0]` unconditionally means a
     * background grid refresh silently redefines "current photo" as whatever
     * sorts first — usually with no GPS. That is the root cause of the classic
     * "the GPS keeps getting clobbered" symptom, which is normally papered over
     * downstream with a "never overwrite a good value with null" rule.
     *
     * Ignoring listings outright removes the bad value at the source, so no
     * downstream guard is needed. */

    it('ignores a multi-item listing entirely', () => {
      const { respond, onPhoto, photos } = setup();

      respond(TEAM_ITEM_URL, listingResponse);

      expect(onPhoto).not.toHaveBeenCalled();
      expect(photos.current).toBeUndefined();
    });

    it('a listing arriving afterwards cannot clobber the open photo', () => {
      const { respond, onPhoto, photos } = setup();

      respond(TEAM_ITEM_URL, singleItemWithGps);
      onPhoto.mockClear();

      /* The exact sequence that breaks the naive implementation. */
      respond(TEAM_ITEM_URL, listingResponse);

      expect(onPhoto).not.toHaveBeenCalled();
      expect(photos.current?.item.id).toBe(44246);
      expect(photos.current?.item.additional?.gps).toEqual({
        latitude: 48.85837,
        longitude: 2.294481,
      });
    });

    it('a GPS-less response for the same photo does not clear a known GPS', () => {
      const { respond, onPhoto, photos } = setup();

      respond(TEAM_ITEM_URL, singleItemWithGps);
      onPhoto.mockClear();

      respond(TEAM_ITEM_URL, singleItemWithoutGps);

      expect(onPhoto).not.toHaveBeenCalled();
      expect(photos.current?.item.additional?.gps).toEqual({
        latitude: 48.85837,
        longitude: 2.294481,
      });
    });
  });

  describe('noise suppression', () => {
    it('stays quiet on a repeat of the same photo', () => {
      /* Synology re-requests the open item on all sorts of occasions. Re-emitting
       * would make every plugin re-render for no new information. */
      const { respond, onPhoto } = setup();

      respond(TEAM_ITEM_URL, singleItemWithGps);
      respond(TEAM_ITEM_URL, singleItemWithGps);

      expect(onPhoto).toHaveBeenCalledOnce();
    });

    it('emits when GPS arrives for a photo we already knew without it', () => {
      /* The one case where re-emitting the same id is right: there is genuinely
       * new information, and a map plugin needs it. */
      const { respond, onPhoto } = setup();

      respond(TEAM_ITEM_URL, singleItemWithoutGps);
      expect(onPhoto).toHaveBeenCalledOnce();

      respond(TEAM_ITEM_URL, singleItemWithGps);
      expect(onPhoto).toHaveBeenCalledTimes(2);
      const [payload] = onPhoto.mock.calls[1] as [AppEventMap['photo:changed']];
      expect(payload.gps).toEqual({ latitude: 48.85837, longitude: 2.294481 });
    });

    it('ignores an API call whose method we cannot identify', () => {
      /* A real, observed call: `POST webapi/entry.cgi` with no method in the
       * URL. Even carrying a photo-shaped body, it must be ignored — we cannot
       * tell which library it came from, and guessing is how you get it wrong. */
      const { respond, onPhoto } = setup();

      respond(UNIDENTIFIED_WEBAPI_URL, singleItemWithGps);

      expect(onPhoto).not.toHaveBeenCalled();
    });

    it('ignores an error envelope', () => {
      const { respond, onPhoto } = setup();

      respond(TEAM_ITEM_URL, errorResponse);

      expect(onPhoto).not.toHaveBeenCalled();
    });

    it('survives a garbage body', () => {
      const { respond, onPhoto } = setup();

      expect(() => {
        respond(TEAM_ITEM_URL, '<html>login page</html>');
        respond(TEAM_ITEM_URL, null);
        respond(TEAM_ITEM_URL, undefined);
      }).not.toThrow();
      expect(onPhoto).not.toHaveBeenCalled();
    });
  });

  it('stops listening when its signal aborts', () => {
    const bus = createEventBus<AppEventMap>();
    const controller = new AbortController();
    createPhotoContext({ bus, logger: createLogger('test', 'silent'), signal: controller.signal });
    const onPhoto = vi.fn();
    bus.on('photo:changed', onPhoto);

    controller.abort();
    bus.emit('api:response', {
      url: TEAM_ITEM_URL,
      method: 'GET',
      status: 200,
      body: singleItemWithGps,
    });

    expect(onPhoto).not.toHaveBeenCalled();
  });
});

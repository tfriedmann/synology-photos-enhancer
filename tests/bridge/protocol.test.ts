import { describe, expect, it } from 'vitest';

import {
  BRIDGE_MARKER,
  createApiResponseMessage,
  createHistoryChangedMessage,
  isBridgeMessage,
  readBridgeMessage,
} from '@/bridge/protocol';

const validApiMessage = createApiResponseMessage({
  url: 'https://nas:5001/webapi/entry.cgi?api=SYNO.FotoTeam.Browse.Item',
  method: 'GET',
  status: 200,
  body: { success: true },
});

describe('isBridgeMessage', () => {
  it('accepts our own messages', () => {
    expect(isBridgeMessage(validApiMessage)).toBe(true);
    expect(isBridgeMessage(createHistoryChangedMessage('https://nas:5001/photo/'))).toBe(true);
  });

  it("rejects the page's own postMessage traffic", () => {
    /* Synology, embedded players and analytics all use postMessage. Without the
     * marker we would try to parse their payloads as API responses. */
    expect(isBridgeMessage({ type: 'api:response', url: 'x', method: 'GET', status: 200 })).toBe(
      false,
    );
    expect(isBridgeMessage('webpackHotUpdate')).toBe(false);
    expect(isBridgeMessage(null)).toBe(false);
    expect(isBridgeMessage(undefined)).toBe(false);
    expect(isBridgeMessage(42)).toBe(false);
    expect(isBridgeMessage([])).toBe(false);
  });

  it('rejects a different protocol version', () => {
    /* Two extension versions can briefly coexist across a reload. Dropping the
     * mismatch beats guessing at a payload shape we no longer speak. */
    expect(isBridgeMessage({ ...validApiMessage, v: 999 })).toBe(false);
  });

  it('rejects an unknown message type', () => {
    expect(isBridgeMessage({ __spe__: BRIDGE_MARKER, v: 1, type: 'evil' })).toBe(false);
  });

  it('rejects a well-marked message with a malformed payload', () => {
    expect(isBridgeMessage({ ...validApiMessage, url: 42 })).toBe(false);
    expect(isBridgeMessage({ ...validApiMessage, status: 'ok' })).toBe(false);
    expect(isBridgeMessage({ ...validApiMessage, method: undefined })).toBe(false);
    expect(isBridgeMessage({ __spe__: BRIDGE_MARKER, v: 1, type: 'history:changed' })).toBe(false);
  });

  it('allows any body, including none', () => {
    /* The body crosses a trust boundary and is narrowed later by the Synology
     * guards; the protocol must not pre-judge its shape. */
    expect(isBridgeMessage({ ...validApiMessage, body: undefined })).toBe(true);
    expect(isBridgeMessage({ ...validApiMessage, body: 'raw text' })).toBe(true);
  });
});

/** Minimal stand-in for the `window` that `readBridgeMessage` validates against. */
const scope = { location: { origin: 'https://nas:5001' } } as unknown as Window;

function messageEvent(data: unknown, origin: string, source: unknown): MessageEvent {
  return { data, origin, source } as MessageEvent;
}

describe('readBridgeMessage', () => {
  it('accepts a message from this window at this origin', () => {
    const event = messageEvent(validApiMessage, 'https://nas:5001', scope);
    expect(readBridgeMessage(event, scope)).toEqual(validApiMessage);
  });

  it('rejects a message from another origin', () => {
    const event = messageEvent(validApiMessage, 'https://evil.example', scope);
    expect(readBridgeMessage(event, scope)).toBeNull();
  });

  it('rejects a message from another window', () => {
    /* An iframe at the same origin is still not our bridge. */
    const iframe = { location: { origin: 'https://nas:5001' } } as unknown as Window;
    const event = messageEvent(validApiMessage, 'https://nas:5001', iframe);
    expect(readBridgeMessage(event, scope)).toBeNull();
  });

  it('rejects unmarked data even from the right window and origin', () => {
    const event = messageEvent({ type: 'api:response' }, 'https://nas:5001', scope);
    expect(readBridgeMessage(event, scope)).toBeNull();
  });
});

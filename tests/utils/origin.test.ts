import { describe, expect, it } from 'vitest';

import { originPatternToDisplay, toOriginPattern } from '@/utils/origin';

describe('toOriginPattern', () => {
  /* The shapes below are not hypothetical — they are real Synology deployments.
   * Together they are the proof that no static `host_permissions` could ever
   * cover this, and why the extension registers its scripts at runtime instead. */
  it.each([
    ['a custom HTTPS port', 'https://nas:5001/photo/#/timeline', 'https://nas:5001/*'],
    ['a bare LAN hostname over HTTP', 'http://aynas:5000/photo/', 'http://aynas:5000/*'],
    ['a LAN IP', 'http://192.168.1.42:5000/photo/', 'http://192.168.1.42:5000/*'],
    ['Synology DDNS', 'https://mynas.synology.me/photo/', 'https://mynas.synology.me/*'],
    [
      'QuickConnect with a regional prefix',
      'https://akapraha.cz2.quickconnect.to/photo/',
      'https://akapraha.cz2.quickconnect.to/*',
    ],
    [
      'a reverse proxy on a personal domain',
      'https://photos.example.com/',
      'https://photos.example.com/*',
    ],
    ['an unusual port', 'https://nas.example.com:9530/photo/', 'https://nas.example.com:9530/*'],
  ])('handles %s', (_label, url, expected) => {
    expect(toOriginPattern(url)).toBe(expected);
  });

  it('keeps the port, which is part of the origin', () => {
    /* Synology installs live on non-default ports more often than not, and
     * `nas:5001` is a different origin from `nas:5000`. */
    expect(toOriginPattern('https://nas:5001/x')).toBe('https://nas:5001/*');
    expect(toOriginPattern('https://nas:5000/x')).toBe('https://nas:5000/*');
  });

  it('drops the path, query and hash', () => {
    expect(toOriginPattern('https://nas:5001/photo/deep/path?q=1#/timeline/item/5')).toBe(
      'https://nas:5001/*',
    );
  });

  it('omits the default port, as URL parsing does', () => {
    expect(toOriginPattern('https://photos.example.com:443/')).toBe('https://photos.example.com/*');
  });

  it('rejects schemes that cannot be granted', () => {
    expect(toOriginPattern('chrome://extensions')).toBeUndefined();
    expect(toOriginPattern('file:///C:/photo.html')).toBeUndefined();
    expect(toOriginPattern('about:blank')).toBeUndefined();
    expect(toOriginPattern('chrome-extension://abcdef/popup.html')).toBeUndefined();
  });

  it('rejects malformed input rather than throwing', () => {
    expect(toOriginPattern('')).toBeUndefined();
    expect(toOriginPattern('not a url')).toBeUndefined();
    expect(toOriginPattern('https://')).toBeUndefined();
  });
});

describe('originPatternToDisplay', () => {
  it('strips the trailing wildcard', () => {
    expect(originPatternToDisplay('https://nas:5001/*')).toBe('https://nas:5001');
  });

  it('leaves a pattern without a wildcard alone', () => {
    expect(originPatternToDisplay('https://nas:5001')).toBe('https://nas:5001');
  });
});

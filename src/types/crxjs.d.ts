/**
 * CRXJS resolves these import suffixes to the *built* path of a script, which
 * is what `chrome.scripting.registerContentScripts()` expects.
 *
 * Never hard-code an output filename: it is content-hashed in production. The
 * default export below is the only reliable way to reach the emitted file.
 *
 * - `?iife`   — self-executing bundle. Required for MAIN world scripts.
 * - `?script` — ESM + async loader. Fine for ISOLATED world, keeps HMR.
 */
declare module '*?iife' {
  const src: string;
  export default src;
}

declare module '*?script' {
  const src: string;
  export default src;
}

declare module '*?script&module' {
  const src: string;
  export default src;
}

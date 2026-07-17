/* CRXJS resolves these to the built file paths. Never hard-code the names:
 * they are content-hashed in production.
 *
 * The suffixes are load-bearing, not stylistic:
 *
 * - `?iife` for the MAIN world. `registerContentScripts` cannot take an ES
 *   module, the CRXJS loader calls `chrome.runtime.getURL()` (undefined in the
 *   MAIN world), and that loader is async — far too late to patch XHR at
 *   `document_start`, which is the entire point of the script.
 * - `?script` for the ISOLATED world, which keeps the dev-server loader and HMR. */
import mainWorldScript from './content-main.iife?iife';
import isolatedScript from './content-isolated?script';

/**
 * Service worker: owns permissions and content-script registration.
 *
 * ## Why nothing is declared in the manifest
 *
 * Synology NAS hostnames are arbitrary. Real ones seen in the wild: custom
 * ports (2518, 4443, 5001, 9530), bare LAN hostnames with no TLD, `*.synology.me`,
 * QuickConnect with a rotating regional prefix, and reverse proxies on personal
 * domains. DSM's Login Portal lets an admin change the alias, port and domain
 * per application, so there is no pattern to match on.
 *
 * The alternative — a `content_scripts` entry matching all URLs — would demand
 * "read and change all your data on all websites" at install time, and inject
 * into every page the user ever opens, to serve one host. Registering at
 * runtime for the single origin the user names costs this file, and asks for
 * nothing until the user asks first.
 *
 * ## The rules Chrome imposes
 *
 * - `registerContentScripts` **throws** if `matches` is not already covered by
 *   a granted permission → always register *after* the grant.
 * - `persistAcrossSessions` defaults to `true`, so registrations survive a
 *   restart and re-registering the same id throws → reconcile, never blindly
 *   register.
 * - `permissions.request()` must run inside a user gesture → it lives in the
 *   popup, not here.
 */

const MAIN_SCRIPT_ID = 'spe-main-world';
const ISOLATED_SCRIPT_ID = 'spe-isolated-world';
const SCRIPT_IDS = [MAIN_SCRIPT_ID, ISOLATED_SCRIPT_ID];

/** Messages the popup sends. Kept here so both ends share one definition. */
export type BackgroundRequest =
  { readonly type: 'get-status'; readonly origin: string } | { readonly type: 'sync' };

export interface BackgroundStatus {
  readonly granted: boolean;
  readonly origins: readonly string[];
}

async function grantedOrigins(): Promise<readonly string[]> {
  const permissions = await chrome.permissions.getAll();
  return permissions.origins ?? [];
}

function buildScripts(matches: readonly string[]): chrome.scripting.RegisteredContentScript[] {
  const common = {
    matches: [...matches],
    runAt: 'document_start' as const,
    /* Synology Photos is not framed, and injecting into every iframe would mean
     * patching XHR in ad frames and embeds for nothing. */
    allFrames: false,
    persistAcrossSessions: true,
  };

  return [
    {
      ...common,
      id: MAIN_SCRIPT_ID,
      js: [mainWorldScript],
      /* The page's own XMLHttpRequest lives here and nowhere else. */
      world: 'MAIN',
    },
    {
      ...common,
      id: ISOLATED_SCRIPT_ID,
      js: [isolatedScript],
      /* Needs chrome.storage; must not share globals with the page. */
      world: 'ISOLATED',
    },
  ];
}

/**
 * Makes the registered scripts match the granted origins, whatever state we
 * start from.
 *
 * Written as reconcile-to-target rather than add/remove deltas: this runs on
 * install, on startup, and on every permission change, and it must be correct
 * when a previous session already registered something.
 */
export async function syncRegistrations(): Promise<void> {
  const origins = await grantedOrigins();

  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
  const existingIds = new Set(existing.map((script) => script.id));

  if (origins.length === 0) {
    if (existingIds.size > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [...existingIds] });
    }
    return;
  }

  const desired = buildScripts(origins);
  const toUpdate = desired.filter((script) => existingIds.has(script.id));
  const toRegister = desired.filter((script) => !existingIds.has(script.id));

  /* Update and register are separate calls: passing an existing id to
   * register() throws, and an unknown id to update() throws too. */
  if (toUpdate.length > 0) await chrome.scripting.updateContentScripts(toUpdate);
  if (toRegister.length > 0) await chrome.scripting.registerContentScripts(toRegister);
}

function safeSync(reason: string): void {
  void syncRegistrations().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`[spe:background] Failed to sync registrations (${reason})`, error);
  });
}

/* Registrations persist across sessions, but the built file paths change on
 * every update — so re-sync on install and update, or the worker would point at
 * files that no longer exist. */
chrome.runtime.onInstalled.addListener(() => {
  safeSync('onInstalled');
});
chrome.runtime.onStartup.addListener(() => {
  safeSync('onStartup');
});

/* The user granting from the popup, or revoking from chrome://extensions. */
chrome.permissions.onAdded.addListener(() => {
  safeSync('permissions.onAdded');
});
chrome.permissions.onRemoved.addListener(() => {
  safeSync('permissions.onRemoved');
});

chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest, _sender, sendResponse: (response: BackgroundStatus) => void) => {
    void (async (): Promise<void> => {
      const origins = await grantedOrigins();
      const granted =
        message.type === 'get-status' ? origins.includes(message.origin) : origins.length > 0;
      sendResponse({ granted, origins });
    })();

    /* Keeps the message channel open for the async sendResponse above. */
    return true;
  },
);

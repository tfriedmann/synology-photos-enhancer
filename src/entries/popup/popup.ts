import { isLogLevel } from '@/core/logger';
import {
  createSettingsStore,
  loadSettings,
  watchChromeSettings,
  type SettingsStore,
} from '@/core/settings';
import { plugins } from '@/plugins';
import { el } from '@/utils/dom';
import { originPatternToDisplay, toOriginPattern } from '@/utils/origin';

/**
 * The extension popup: grant this site, toggle plugins, set the log level.
 *
 * This is where `chrome.permissions.request()` has to live. Chrome only honours
 * it inside a user gesture, so it cannot be moved into the service worker or
 * triggered automatically — a click is not a UX preference here, it is the API
 * contract.
 *
 * It is also the honest place for it: the extension asks for one origin, at the
 * moment the user asks for it, on a page they are looking at.
 */

/**
 * Looks up an element and proves its type at runtime.
 *
 * The constructor argument is what makes this honest: an `as HTMLButtonElement`
 * cast would compile just as well while the markup said `<div>`, and fail much
 * later at `.disabled`. Here a drifting `index.html` fails loudly, at load, with
 * the offending id in the message.
 */
function requireElement<E extends HTMLElement>(id: string, type: new () => E): E {
  const node = document.getElementById(id);
  if (!(node instanceof type)) {
    throw new TypeError(`popup: #${id} is missing or is not a ${type.name}`);
  }
  return node;
}

const originText = requireElement('site-origin', HTMLParagraphElement);
const statusText = requireElement('site-status', HTMLParagraphElement);
const toggleButton = requireElement('toggle-site', HTMLButtonElement);
const reloadHint = requireElement('reload-hint', HTMLParagraphElement);
const pluginList = requireElement('plugin-list', HTMLUListElement);
const logLevelSelect = requireElement('log-level', HTMLSelectElement);

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Why we cannot offer to enable this tab — each needs a different message. */
type SiteProblem = 'no-url' | 'unsupported-scheme';

function renderProblem(problem: SiteProblem): void {
  statusText.className = 'status';
  toggleButton.hidden = true;

  if (problem === 'no-url') {
    /* `activeTab` should make the URL readable the moment the popup opens. If
     * it did not, the tab is one Chrome shields from extensions entirely —
     * chrome://, the Web Store, or a PDF viewer. Telling the user "not a web
     * page" here would be a lie when they are looking at one. */
    originText.textContent = 'Cannot read this tab';
    statusText.textContent =
      'Chrome does not let extensions see this tab. Open your Synology Photos tab and click the icon again.';
    return;
  }

  originText.textContent = 'Not a web page';
  statusText.textContent = 'Open your Synology Photos tab, then click the extension icon.';
}

function renderSite(pattern: string, granted: boolean): void {
  originText.textContent = originPatternToDisplay(pattern);
  toggleButton.hidden = false;

  if (granted) {
    statusText.textContent = 'Enabled on this site.';
    statusText.className = 'status status--on';
    toggleButton.textContent = 'Disable on this site';
    toggleButton.className = 'button button--danger';
  } else {
    statusText.textContent = 'Not enabled here yet.';
    statusText.className = 'status status--off';
    toggleButton.textContent = 'Enable on this site';
    toggleButton.className = 'button';
  }
}

function renderPlugins(settings: SettingsStore): void {
  pluginList.replaceChildren();

  if (plugins.length === 0) {
    pluginList.append(el('li', { className: 'status', text: 'No plugins bundled yet.' }));
    return;
  }

  for (const plugin of plugins) {
    const checkbox = el('input', {
      className: 'plugin__checkbox',
      attrs: { type: 'checkbox', id: `plugin-${plugin.id}` },
    });
    checkbox.checked = settings.isPluginEnabled(plugin.id, plugin.enabledByDefault);

    checkbox.addEventListener('change', () => {
      void settings.setPluginEnabled(plugin.id, checkbox.checked);
      reloadHint.hidden = false;
    });

    const label = el('label', {
      className: 'plugin__text',
      attrs: { for: `plugin-${plugin.id}` },
      children: [
        el('span', { className: 'plugin__name', text: plugin.name }),
        el('span', { className: 'plugin__description', text: plugin.description }),
      ],
    });

    pluginList.append(el('li', { className: 'plugin', children: [checkbox, label] }));
  }
}

async function main(): Promise<void> {
  const settings = createSettingsStore({
    area: chrome.storage.sync,
    initial: await loadSettings(chrome.storage.sync),
    watch: watchChromeSettings,
  });

  renderPlugins(settings);

  logLevelSelect.value = settings.get().logLevel;
  logLevelSelect.addEventListener('change', () => {
    const level = logLevelSelect.value;
    if (isLogLevel(level)) void settings.patch({ logLevel: level });
  });

  const tab = await activeTab();

  /* `activeTab` makes this readable as soon as the popup opens. Without that
   * permission Chrome blanks `tab.url` on every tab, and the popup can never
   * learn which origin to ask for — see manifest.config.ts. */
  if (tab?.url === undefined || tab.url === '') {
    renderProblem('no-url');
    return;
  }

  const pattern = toOriginPattern(tab.url);
  if (pattern === undefined) {
    renderProblem('unsupported-scheme');
    return;
  }

  const isGranted = async (): Promise<boolean> =>
    chrome.permissions.contains({ origins: [pattern] });

  renderSite(pattern, await isGranted());

  toggleButton.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const granted = await isGranted();
      toggleButton.disabled = true;

      try {
        if (granted) {
          await chrome.permissions.remove({ origins: [pattern] });
        } else {
          /* Must be called synchronously enough to still count as a user
           * gesture — hence no awaits between the click and here beyond the
           * permission check. Chrome rejects the prompt otherwise. */
          await chrome.permissions.request({ origins: [pattern] });
        }

        const now = await isGranted();
        renderSite(pattern, now);

        /* The scripts register only after the grant, and content scripts do not
         * retro-inject into an already-loaded page. Saying so is kinder than
         * letting the user wonder why nothing happened. */
        if (now !== granted) reloadHint.hidden = false;
      } finally {
        toggleButton.disabled = false;
      }
    })();
  });
}

void main().catch((error: unknown) => {
  statusText.textContent = 'Something went wrong. See the console.';
  // eslint-disable-next-line no-console
  console.error('[spe:popup]', error);
});

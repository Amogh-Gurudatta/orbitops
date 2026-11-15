// Waiting helpers for the tour's page changes. The next page is lazy-loaded, so its route and targets
// appear some frames after navigate(). waitForElement resolves once a CSS selector matches a rendered
// (laid-out) element, or false after a timeout: a mutation observer reacts to new nodes and a short
// interval catches elements that only become visible. waitUntil polls any condition. Unlike
// requestAnimationFrame, neither stalls in a background tab.
const POLL_MS = 100;

const isRendered = (el: Element): boolean => el.getClientRects().length > 0;

export function findRendered(selector: string): Element | null {
  const el = document.querySelector(selector);
  return el && isRendered(el) ? el : null;
}

export function waitForElement(
  selector: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    if (findRendered(selector)) return resolve(true);

    const observer = new MutationObserver(() => {
      if (findRendered(selector)) settle(true);
    });
    const poll = setInterval(() => {
      if (findRendered(selector)) settle(true);
    }, POLL_MS);
    const timeout = setTimeout(() => settle(false), timeoutMs);
    const onAbort = () => settle(false);

    function settle(found: boolean) {
      observer.disconnect();
      clearInterval(poll);
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      resolve(found);
    }

    observer.observe(document.body, { childList: true, subtree: true });
    signal?.addEventListener('abort', onAbort);
  });
}

/** Polls `condition` until it holds (true) or the timeout passes (false). */
export function waitUntil(
  condition: () => boolean,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    if (condition()) return resolve(true);
    const poll = setInterval(() => {
      if (condition()) settle(true);
    }, POLL_MS);
    const timeout = setTimeout(() => settle(false), timeoutMs);
    const onAbort = () => settle(false);

    function settle(met: boolean) {
      clearInterval(poll);
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      resolve(met);
    }

    signal?.addEventListener('abort', onAbort);
  });
}

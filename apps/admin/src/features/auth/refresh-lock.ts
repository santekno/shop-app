/**
 * The name of the lock every tab of the dashboard takes before it touches
 * the refresh cookie (log in, refresh, log out).
 */
export const SESSION_LOCK_NAME = "goshop:session";

/** The end of this tab's queue, for browsers without the Web Locks API. */
let localQueue: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` while no other call to withSessionLock runs, in this tab or
 * in any other tab of the dashboard, and returns what it returns.
 *
 * Why: every tab of the dashboard shares one `goshop_admin_refresh` cookie
 * (the storefront's `goshop_refresh` is a separate one), and the API rotates
 * it on every refresh. A refresh token that is used a second time looks
 * stolen, and the API then revokes the whole session (Bab 4's reuse
 * detection). Two tabs reloaded together would both send the same cookie:
 * the first rotates it, the second is a reuse, and the user is logged out
 * of every tab. Inside the lock, the second tab's request starts only
 * after the first tab's answer has arrived, and the browser has already
 * stored the rotated cookie from it, so the second request carries the
 * new token: no reuse.
 *
 * The Web Locks API (`navigator.locks`) is that lock: one lock per name,
 * shared by every tab and worker of the same origin, handed to one caller
 * at a time, in order, and released when the task's promise settles, or
 * when its tab closes. Go's sync.Mutex, but across tabs.
 *
 * The task must wait for the whole answer before it returns: that is when
 * the Set-Cookie has been applied. (webRefresh's timeout is longer than
 * the API's for the same reason: a task that gave up early would release
 * the lock while the server may still rotate the cookie.)
 *
 * Fallback: `navigator.locks` exists only in a secure context (https, or
 * http://localhost). Elsewhere (a phone on http://192.168.x.x) the tasks
 * of this tab still run one at a time, in a queue of promises, but two
 * tabs can refresh at the same moment. The worst case is the one above:
 * reuse detection ends the session and the user logs in again. It is never
 * a security problem, only an inconvenience on a development setup.
 */
export const withSessionLock = async <T>(
  task: () => Promise<T>,
): Promise<T> => {
  if ("locks" in navigator) {
    // request() resolves with what the task resolves with. (Its DOM type
    // says Promise<Promise<T>>; `await` unwraps it either way.)
    return await navigator.locks.request(SESSION_LOCK_NAME, task);
  }
  // Each task starts when the previous one has settled, whether it
  // succeeded or failed; a failure is still reported to its own caller.
  const run = localQueue.then(task, task);
  localQueue = run.catch(() => undefined);
  return await run;
};

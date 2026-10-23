// k6 load test of GoShop's checkout (Bab 5, artikel 14; ADR 0006).
//
// Two scenarios run against a stack started with `make up` and seeded with
// `make seed && SEED_LOADTEST_PASSWORD=… make seed-loadtest users=20`:
//
//   plenty  PLENTY_VUS buyers loop for DURATION: add one LOADTEST-PLENTY to
//           the cart, check out (JNE REG), cancel the order. Measures the
//           checkout transaction under load; cancelling keeps every buyer
//           under the five-unpaid-orders cap.
//   scarce  SCARCE_VUS other buyers try SCARCE_ATTEMPTS times each to buy one
//           LOADTEST-SCARCE (10 in stock) and keep what they get. Exactly 10
//           orders may succeed; e2e/k6/verify.sql checks that in SQL.
//
// Every buyer logs in once (POST /v1/auth/login is limited to 20 per IP per
// 15 minutes, so PLENTY_VUS + SCARCE_VUS is at most 20; e2e/k6/run.sh clears
// the counters first). One VU checks out about 1,200 times a minute, so the
// api must run with APP_CHECKOUT_LIMIT_PER_MINUTE=100000 (run.sh refuses
// to start otherwise). Run it with `make loadtest`; see README.md.

import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:8080';
const PASSWORD = __ENV.SEED_LOADTEST_PASSWORD;
const PLENTY_VUS = Number(__ENV.PLENTY_VUS || 12);
const SCARCE_VUS = Number(__ENV.SCARCE_VUS || 8);
const SCARCE_ATTEMPTS = Number(__ENV.SCARCE_ATTEMPTS || 3);
const DURATION = __ENV.DURATION || '30s';
const PRODUCT = 'loadtest-kaos';
const SCARCE_STOCK = 10;

export const options = {
  scenarios: {
    plenty: { executor: 'constant-vus', exec: 'plenty', vus: PLENTY_VUS, duration: DURATION },
    // Starts a little later, while plenty is running, so the scarce
    // checkouts compete with real load.
    scarce: {
      executor: 'per-vu-iterations', exec: 'scarce', vus: SCARCE_VUS, iterations: SCARCE_ATTEMPTS,
      startTime: '5s', maxDuration: '2m',
    },
  },
  thresholds: {
    // Locally, against make up.
    'http_req_duration{name:checkout,scenario:plenty}': ['p(95)<500'],
    'http_req_duration{name:checkout,scenario:scarce}': ['p(95)<500'],
    // Any answer the flow does not expect (a 5xx, a 401, an unknown 4xx).
    unexpected_responses: ['rate<0.01'],
    // Never more scarce orders than units; verify.sql checks "exactly".
    scarce_orders: [`count<=${SCARCE_STOCK}`],
    plenty_orders: ['count>0'],
  },
};

const unexpected = new Rate('unexpected_responses');
const plentyOrders = new Counter('plenty_orders');
const scarceOrders = new Counter('scarce_orders');
const scarceSoldOut = new Counter('scarce_sold_out');

// session is this VU's buyer: each VU has its own JavaScript runtime, so
// this is per VU.
let session = null;

function headers(token, extra) {
  return { headers: Object.assign({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, extra || {}) };
}

function code(res) {
  try {
    return res.json('error.code') || '';
  } catch (_) {
    return '';
  }
}

// expect records whether res is one of the answers the flow allows.
function expect(res, what, allowed) {
  const ok = allowed.some(([status, c]) => res.status === status && (!c || code(res) === c));
  unexpected.add(!ok, { what });
  check(res, { [`${what}: ${allowed.map(([s, c]) => (c ? `${s} ${c}` : s)).join(' or ')}`]: () => ok });
  if (!ok) {
    console.warn(`${what}: unexpected ${res.status} ${res.body}`);
  }
  return ok;
}

// login signs this VU's buyer in and reads its address and the variants.
function login() {
  if (!PASSWORD) {
    fail('set SEED_LOADTEST_PASSWORD to the password make seed-loadtest used');
  }
  const email = `loadtest-${String(exec.vu.idInTest).padStart(4, '0')}@goshop.local`;
  const res = http.post(`${API}/v1/auth/login`, JSON.stringify({ email, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } });
  if (!expect(res, 'login', [[200]])) {
    // A wrong password or a missing buyer is a setup problem: stop the
    // whole test rather than let every iteration log in again (and hit
    // the login rate limit).
    exec.test.abort(`login ${email}: ${res.status}; run make seed-loadtest users=${exec.vu.idInTest} or more with this SEED_LOADTEST_PASSWORD (a rerun sets it on every loadtest-* buyer)`);
  }
  const token = res.json('data.access_token');
  const addresses = http.get(`${API}/v1/me/addresses`, Object.assign(headers(token), { tags: { name: 'addresses' } }));
  expect(addresses, 'addresses', [[200]]);
  const address = (addresses.json('data') || []).find((a) => a.is_default);
  const product = http.get(`${API}/v1/products/${PRODUCT}`, { tags: { name: 'product' } });
  expect(product, 'product', [[200]]);
  const variants = {};
  for (const v of product.json('data.variants') || []) {
    variants[v.sku] = v.id;
  }
  if (!address || !variants['LOADTEST-PLENTY'] || !variants['LOADTEST-SCARCE']) {
    fail(`${email}: no default address or no load-test variants; run make seed-loadtest`);
  }
  session = { email, token, addressId: address.id, variants };
}

function addToCart(variantId, allowed) {
  const res = http.post(`${API}/v1/cart/items`, JSON.stringify({ variant_id: variantId, quantity: 1 }),
    Object.assign(headers(session.token), { tags: { name: 'cart_add' } }));
  expect(res, 'cart add', allowed);
  return res;
}

// checkout places the cart with a fresh Idempotency-Key per attempt, and
// the same key for its retries (a lost answer, a 5xx, the same key still
// in flight), as ADR 0006 asks of clients.
function checkout(allowed) {
  const key = crypto.randomUUID();
  const body = JSON.stringify({ address_id: session.addressId, courier: 'jne', service: 'REG' });
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = http.post(`${API}/v1/checkout`, body,
      Object.assign(headers(session.token, { 'Idempotency-Key': key }), { tags: { name: 'checkout' } }));
    const retry = res.status === 0 || res.status >= 500 || (res.status === 409 && code(res) === 'IDEMPOTENCY_IN_PROGRESS');
    if (!retry) {
      break;
    }
  }
  expect(res, 'checkout', allowed);
  return res;
}

export function plenty() {
  if (!session) {
    login();
  }
  addToCart(session.variants['LOADTEST-PLENTY'], [[200]]);
  const res = checkout([[201]]);
  if (res.status !== 201) {
    return;
  }
  plentyOrders.add(1);
  const cancel = http.post(`${API}/v1/orders/${res.json('data.id')}/cancel`, null,
    Object.assign(headers(session.token), { tags: { name: 'cancel' } }));
  expect(cancel, 'cancel', [[200]]);
}

export function scarce() {
  if (!session) {
    login();
  }
  const variant = session.variants['LOADTEST-SCARCE'];
  const added = addToCart(variant, [[200], [409, 'INSUFFICIENT_STOCK']]);
  if (added.status !== 200) {
    scarceSoldOut.add(1);
    return;
  }
  const res = checkout([[201], [409, 'CHECKOUT_PROBLEMS']]);
  if (res.status === 201) {
    scarceOrders.add(1); // kept unpaid: verify.sql counts it
    return;
  }
  scarceSoldOut.add(1);
  // Leave the cart empty for this buyer's next attempt.
  const removed = http.del(`${API}/v1/cart/items/${variant}`, null,
    Object.assign(headers(session.token), { tags: { name: 'cart_remove' } }));
  expect(removed, 'cart remove', [[200]]);
}

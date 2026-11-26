const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');

async function listen(server, t) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

test('IdTrust login verifies state and stores an authenticated Redis session', async t => {
  process.env.NODE_ENV = 'test';
  process.env.FRONTEND_URL = 'http://127.0.0.1:8080';
  process.env.OAUTH_REDIRECT_URI = process.env.FRONTEND_URL + '/';
  process.env.OAUTH_CLIENT_ID = 'example-client';
  process.env.OAUTH_CLIENT_SECRET = 'example-only';
  process.env.ADMIN_BADGES = 'example-admin';
  process.env.WECOM_BOT_WORKER_ENABLED = 'false';
  delete process.env.HIGRESS_CONSOLE_BASE_URL;

  let exchanged = 0;
  const provider = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const matches = (key, value) => url.searchParams.get(key) === value;
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/oauth2/token' && matches('code', 'temporary-code')
        && matches('grant_type', 'authorization_code')
        && matches('client_id', process.env.OAUTH_CLIENT_ID)
        && matches('client_secret', process.env.OAUTH_CLIENT_SECRET)
        && matches('redirect_uri', process.env.OAUTH_REDIRECT_URI)) {
      exchanged += 1;
      return res.end(JSON.stringify({ access_token: 'example-provider-token' }));
    }
    if (url.pathname === '/oauth2/get_user_info' && matches('access_token', 'example-provider-token')) {
      return res.end(JSON.stringify({ name: 'example-admin', email: 'private@example.invalid' }));
    }
    res.writeHead(400).end('{}');
  });
  process.env.OAUTH_HOST = await listen(provider, t);

  const UsersDetail = require('../src/models/UsersDetail');
  t.mock.method(UsersDetail, 'findOne', query => {
    assert.deepEqual(query, { Badge: { $in: ['example-admin'] } });
    return {
      select: () => ({ lean: async () => ({ Name: 'Test Administrator', DepartmentCode: 'example' }) })
    };
  });
  const redis = require('../src/utils/redis');
  const sessions = new Map();
  t.mock.method(redis, 'storeUserSession', async (key, value) => Boolean(sessions.set(key, value)));
  t.mock.method(redis, 'getUserSession', async key => sessions.get(key));
  const api = await listen(http.createServer(require('../src/app')), t);

  const start = await fetch(api + '/api/login/start?returnTo=%2Fmy-agents', { redirect: 'manual' });
  assert.equal(start.status, 302);
  const cookie = start.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=600/);
  const location = new URL(start.headers.get('location'));
  assert.equal(location.origin, process.env.OAUTH_HOST);
  assert.equal(location.pathname, '/oauth2/authorize');
  assert.equal(location.searchParams.get('response_type'), 'code');
  assert.equal(location.searchParams.get('client_id'), process.env.OAUTH_CLIENT_ID);
  assert.equal(location.searchParams.get('redirect_uri'), process.env.OAUTH_REDIRECT_URI);
  const state = location.searchParams.get('state');
  assert.match(state, /^[a-f0-9]{64}$/);

  function exchange(params, cookieHeader = cookie.split(';')[0]) {
    return fetch(api + '/api/login', {
      method: 'POST',
      headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'temporary-code', ...params })
    });
  }
  assert.equal((await exchange({})).status, 400);
  assert.equal((await exchange({ state: 'incorrect' })).status, 401);
  assert.equal((await exchange({ state }, '')).status, 401);
  assert.equal(exchanged, 0);

  const response = await exchange({ state });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.returnTo, '/my-agents');
  assert.deepEqual(payload.user, { name: 'example-admin' });
  assert.equal(payload.userInfo.IsAdmin, true);
  assert.equal(payload.userInfo.McpEnabled, false);
  assert.equal(payload.userInfo.WecomBotEnabled, false);
  assert.match(payload.authToken, /^[a-f0-9]{64}$/);
  assert.equal(exchanged, 1);
  const authenticatedUser = await require('../src/utils/auth').getUserInfoFromToken('Bearer ' + payload.authToken);
  assert.equal(authenticatedUser.Badge, 'example-admin');
  assert.equal(authenticatedUser.DepartmentCode, 'example');
  assert.equal((await fetch(api + '/api/health')).status, 200);
  assert.equal((await fetch(api + '/api/ready')).status, 503);
  assert.equal((await fetch(api + '/api/apps-new/sync-categories')).status, 404);
  assert.equal((await fetch(api + '/api/apps-new/sync-categories', { method: 'POST' })).status, 401);
});

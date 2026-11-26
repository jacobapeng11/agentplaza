import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import axios from 'axios';

const bootstrap = readFileSync(new URL('../public/startup-preload.js', import.meta.url), 'utf8');
const adapterSource = readFileSync(new URL('../src/utils/startupPreload.ts', import.meta.url), 'utf8');
function setup({ token = 'session', user = '{}', path = '/', sort = 'latest', response = () => new Response('{"data":[]}', { status: 200 }) } = {}) {
  const calls = [];
  const timers = [];
  const window = { location: { origin: 'https://plaza.example', pathname: path } };
  const context = {
    window, location: window.location, URL, Map, Date, Error, AbortController,
    localStorage: { getItem: key => ({ token, user, plaza_sort_preference: sort }[key]) },
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
    fetch: (url, options) => { calls.push({ url, options }); return Promise.resolve().then(response); },
  };
  vm.runInNewContext(bootstrap, context);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(adapterSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
  }).outputText, { ...context, module, exports: module.exports, require: () => axios });
  let fallbackCalls = 0;
  const client = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` }, adapter: async config => {
    fallbackCalls++;
    return { data: { data: ['fallback'] }, status: 200, headers: {}, config };
  } });
  client.interceptors.request.use(config => { module.exports.reuseStartupPreload(config); return config; });
  return { calls, window, client, fallbackCalls: () => fallbackCalls };
}

test('home starts all four reads before the app initializes and honors saved sorting', () => {
  const setupResult = setup({ sort: 'hot' });
  assert.equal(setupResult.calls.length, 4);
  assert.ok(setupResult.calls.some(call => call.url.includes('sortBy=hotScore')));
  assert.ok(setupResult.calls.every(call => call.options.headers.Authorization === 'Bearer session'));
});

test('signed-out visits and other routes do not prefetch', () => {
  assert.equal(setup({ token: null }).calls.length, 0);
  assert.equal(setup({ user: null }).calls.length, 0);
  assert.equal(setup({ path: '/my-agents' }).calls.length, 0);
});

test('Axios consumes the matching query once with JSON transforms and response interceptors intact', async () => {
  const state = setup({ response: () => new Response('{"success":true,"data":[1]}', { status: 200 }) });
  let intercepted = 0;
  state.client.interceptors.response.use(response => { intercepted++; return response; });
  const response = await state.client.get('/categories/all/apps', { params: { limit: 20, sortBy: 'createdAt', page: 1 } });
  assert.deepEqual(response.data.data, [1]);
  assert.equal(state.fallbackCalls(), 0);
  assert.equal(intercepted, 1);
  await state.client.get('/categories/all/apps', { params: { limit: 20, sortBy: 'createdAt', page: 1 } });
  assert.equal(state.fallbackCalls(), 1);
});

test('401 remains an Axios error with parsed body for the existing login interceptor', async () => {
  const state = setup({ response: () => new Response('{"message":"expired"}', { status: 401 }) });
  await assert.rejects(state.client.get('/categories'), error => error.response.status === 401 && error.response.data.message === 'expired');
  assert.equal(state.fallbackCalls(), 0);
});

test('network preload failure falls back to the normal transport and token changes cannot reuse another session', async () => {
  const failed = setup({ response: () => { throw new Error('offline'); } });
  assert.deepEqual((await failed.client.get('/categories')).data.data, ['fallback']);
  const changed = setup();
  await changed.client.get('/categories', { headers: { Authorization: 'Bearer new-session' } });
  assert.equal(changed.fallbackCalls(), 1);
});

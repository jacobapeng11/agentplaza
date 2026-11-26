import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/utils/loginRedirect.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
globalThis.window = { location: new URL('https://plaza.example.com/') };
const { buildLoginUrl, normalizeLoginReturnPath } = await import(
  'data:text/javascript;base64,' + Buffer.from(output).toString('base64')
);

test('clears login and binding parameters and keeps the destination query and fragment', () => {
  assert.equal(
    normalizeLoginReturnPath('/my-agents?tab=favorites&code=example&state=example&qw_token=example#list'),
    '/my-agents?tab=favorites#list'
  );
  assert.equal(
    buildLoginUrl('/category/tools?page=2'),
    '/api/login/start?returnTo=%2Fcategory%2Ftools%3Fpage%3D2'
  );
});

test('accepts only local destinations that do not restart the login flow', () => {
  for (const invalid of ['https://outside.example.com', '//outside.example.com', '/\\outside.example.com', '/login']) {
    assert.equal(normalizeLoginReturnPath(invalid), '/');
  }
});

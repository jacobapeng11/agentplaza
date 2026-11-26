const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const yauzl = require('yauzl');
const { createZipBuffer, parseSkillArchive } = require('../src/services/skillArchiveParser');

const manifest = Buffer.from('---\nname: Example Skill\ndescription: An example for deployment validation\n---\n\n# Example Skill\n');
const reference = Buffer.from('Locally generated test data\n');

test('Skill archive keeps files intact and rejects overlapping Skill roots', async () => {
  const zip = await createZipBuffer([
    { path: 'example/SKILL.md', buffer: manifest },
    { path: 'example/references/sample.txt', buffer: reference }
  ]);
  const parsed = await parseSkillArchive(zip);
  assert.equal(parsed.items[0].name, 'Example Skill');
  assert.deepEqual(parsed.items[0].fileManifest.map(file => file.path), ['references/sample.txt', 'SKILL.md']);
  const normalized = await openZip(parsed.artifacts[0].buffer);
  assert.deepEqual(normalized, new Map([['SKILL.md', manifest], ['references/sample.txt', reference]]));

  const overlapping = await createZipBuffer([
    { path: 'SKILL.md', buffer: manifest },
    { path: 'nested/SKILL.md', buffer: manifest }
  ]);
  await assert.rejects(parseSkillArchive(overlapping), { code: 'OVERLAPPING_SKILL_ROOTS' });
});

function openZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = new Map();
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', entry => {
        zip.openReadStream(entry, async (streamError, stream) => {
          if (streamError) return reject(streamError);
          try {
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          } catch (error) {
            reject(error);
          }
        });
      });
      zip.readEntry();
    });
  });
}

async function waitFor(check, message) {
  const stopAt = Date.now() + 45000;
  while (Date.now() < stopAt) {
    const value = await check();
    if (value) return value;
    await delay(500);
  }
  throw new Error(message);
}

async function seedExampleAssistant() {
  const { MongoClient, ObjectId } = require('mongoose').mongo;
  const fixture = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const db = fixture.db();
    const userId = new ObjectId();
    const teamId = new ObjectId();
    const memberId = new ObjectId();
    await db.collection('users').insertOne({ _id: userId, username: 'example-uploader' });
    await db.collection('team_members').insertOne({
      _id: memberId, teamId, userId, name: 'example-uploader', status: 'active', role: 'owner'
    });
    await db.collection('apps').insertOne({
      name: 'Example Assistant', type: 'simple', version: 'v2', teamId, tmbId: memberId, updateTime: new Date()
    });
  } finally {
    await fixture.close();
  }
}

test('Skill marketplace authorizes, queues, reviews and downloads private ZIPs',
  { skip: process.env.RUN_SKILL_E2E !== 'true' }, async t => {
    const provider = createServer((req, res) => {
      const request = new URL(req.url, 'http://127.0.0.1');
      const code = request.searchParams.get('code');
      const access = request.searchParams.get('access_token');
      res.setHeader('Content-Type', 'application/json');
      if (request.pathname === '/oauth2/token' && ['example-uploader', 'example-reviewer'].includes(code)) {
        return res.end(JSON.stringify({ access_token: code }));
      }
      if (request.pathname === '/oauth2/get_user_info' && ['example-uploader', 'example-reviewer'].includes(access)) {
        return res.end(JSON.stringify({ name: access }));
      }
      res.writeHead(404).end('{}');
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    t.after(() => new Promise(resolve => provider.close(resolve)));

    const { CreateBucketCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const { getSkillStorage } = require('../src/services/skillStorage');
    const { bucket, client } = getSkillStorage();
    await waitFor(async () => {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        return true;
      } catch (error) {
        return error.name === 'BucketAlreadyOwnedByYou';
      }
    }, 'S3 fixture bucket was unavailable');
    await seedExampleAssistant();

    const api = 'http://127.0.0.1:3099';
    const server = spawn(process.execPath, ['src/server.js'], {
      env: {
        ...process.env,
        PORT: '3099',
        FRONTEND_URL: api,
        OAUTH_HOST: 'http://127.0.0.1:' + provider.address().port,
        OAUTH_CLIENT_ID: 'example-client',
        OAUTH_CLIENT_SECRET: 'example-only',
        OAUTH_REDIRECT_URI: api + '/',
        ADMIN_BADGES: 'example-reviewer'
      },
      stdio: 'inherit'
    });
    t.after(async () => {
      if (server.exitCode === null) {
        server.kill();
        await once(server, 'exit');
      }
    });
    await waitFor(async () => {
      const health = await fetch(api + '/api/ready').catch(() => null);
      return health?.ok;
    }, 'Backend fixture was unavailable');

    async function login(badge, expectedAdmin) {
      const start = await fetch(api + '/api/login/start', { redirect: 'manual' });
      assert.equal(start.status, 302);
      const state = new URL(start.headers.get('location')).searchParams.get('state');
      const exchange = await fetch(api + '/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: start.headers.get('set-cookie').split(';')[0]
        },
        body: JSON.stringify({ code: badge, state })
      });
      assert.equal(exchange.status, 200);
      const payload = await exchange.json();
      assert.equal(payload.userInfo.SkillEnabled, true);
      assert.equal(payload.userInfo.IsAdmin, expectedAdmin);
      return payload.authToken;
    }

    function request(path, token, options = {}) {
      const { headers, ...rest } = options;
      return fetch(api + '/api/skills' + path, {
        ...rest,
        headers: { ...headers, ...(token ? { Authorization: 'Bearer ' + token } : {}) }
      });
    }
    function json(method, data) {
      return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    }
    async function result(response, expectedStatus = 200) {
      assert.equal(response.status, expectedStatus);
      const payload = await response.json();
      return payload.data;
    }

    assert.equal((await request('')).status, 401);
    const user = await login('example-uploader', false);
    const admin = await login('example-reviewer', true);
    assert.equal((await fetch(api + '/api/categories')).status, 200);
    const sessionProtectedRoutes = [
      '/api/categories/all/apps', '/api/apps-new/by-category', '/api/apps-new/by-category-mixed',
      '/api/apps-new/hot-recommend', '/api/apps-new/my-created-mixed', '/api/apps-new/my-collected-mixed'
    ];
    for (const path of sessionProtectedRoutes) {
      assert.equal((await fetch(api + path)).status, 401);
      assert.equal((await fetch(api + path, { headers: { Authorization: 'Bearer ' + 'a'.repeat(64) } })).status, 401);
    }
    const apps = await fetch(api + '/api/categories/all/apps', { headers: { Authorization: 'Bearer ' + user } });
    assert.equal(apps.status, 200);
    const { data: visibleApps } = await apps.json();
    assert.equal(visibleApps.find(app => app.name === 'Example Assistant')?.canAccess, true);
    assert.equal((await request('/admin', user)).status, 403);
    assert.equal((await request('/import/git', admin, json('POST', {}))).status, 404);

    const form = new FormData();
    const zip = await createZipBuffer([
      { path: 'SKILL.md', buffer: manifest },
      { path: 'references/sample.txt', buffer: reference }
    ]);
    form.append('file', new Blob([zip], { type: 'application/zip' }), 'example.zip');
    const queued = await result(await request('/import/upload', user, { method: 'POST', body: form }));
    assert.equal(queued.status, 'queued');
    const jobPath = '/import/jobs/' + queued.jobId;
    assert.equal((await request(jobPath, admin)).status, 404);
    const ready = await waitFor(async () => {
      const job = await result(await request(jobPath, user));
      assert.notEqual(job.status, 'failed', JSON.stringify(job.error));
      return job.status === 'ready' ? job : null;
    }, 'Dedicated parser did not finish the upload');
    assert.equal(ready.parseItems.length, 1);
    assert.equal(ready.parseItems[0].name, 'Example Skill');
    const submitted = await result(await request(jobPath + '/submit', user, json('POST', {
      selections: [{ itemKey: ready.parseItems[0].itemKey }]
    })));
    assert.equal(submitted.stage, 'awaiting_review');
    assert.equal((await result(await request('', user))).items.length, 0);

    const reviewPath = '/admin/submissions/' + encodeURIComponent(submitted.results[0].reviewId);
    const review = await result(await request(reviewPath, admin));
    assert.equal(review.archiveName, 'Example Skill.zip');
    assert.equal((await request(reviewPath + '/download', user)).status, 403);
    const before = await request(reviewPath + '/download', admin);
    assert.equal(before.status, 200);
    const reviewedZip = Buffer.from(await before.arrayBuffer());
    assert.deepEqual(reviewedZip, zip);

    const approved = await result(await request(reviewPath + '/review', admin, json('PUT', {
      decision: 'approve', category: 'general', official: false
    })));
    assert.equal(approved.status, 'approved');
    const detailPath = '/' + approved.skillId;
    assert.equal((await result(await request('?search=example', user))).items.length, 1);
    const detail = await result(await request(detailPath, user));
    assert.equal(detail.latestVersion.package, undefined);
    assert.equal(detail.source.type, 'zip');
    assert.equal((await request(detailPath + '/download')).status, 401);
    const published = await request(detailPath + '/download', user);
    assert.equal(published.status, 200);
    assert.equal(published.headers.get('content-type'), 'application/zip');
    assert.equal(published.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await published.arrayBuffer()), reviewedZip);

    const objects = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'skills/artifacts/' }));
    assert.equal(objects.Contents.length, 1);
    const directObject = process.env.SKILL_OSS_ENDPOINT + '/' + bucket + '/' + objects.Contents[0].Key;
    const anonymous = await fetch(directObject);
    assert.equal(anonymous.status, 403);
    await anonymous.arrayBuffer();
  });

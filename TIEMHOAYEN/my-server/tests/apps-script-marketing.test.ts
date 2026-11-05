import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { appsScriptMarketingReady, sendAppsScriptMarketingEmail } from '../services/apps-script-marketing.service.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.APPS_SCRIPT_MARKETING_URL;
  delete process.env.APPS_SCRIPT_MARKETING_SECRET;
});

test('Apps Script marketing rejects missing or unsafe configuration', async () => {
  assert.equal(appsScriptMarketingReady(), false);
  await assert.rejects(sendAppsScriptMarketingEmail({ to: 'a@example.com', subject: 'A', body: 'B', requestId: 'a'.repeat(64) }), /CONFIGURATION_INVALID/);
  process.env.APPS_SCRIPT_MARKETING_URL = 'http://example.com/exec';
  process.env.APPS_SCRIPT_MARKETING_SECRET = 'x'.repeat(32);
  assert.equal(appsScriptMarketingReady(), false);
});

test('Apps Script marketing signs the exact payload and accepts SENT', async () => {
  const secret = 'marketing-secret-that-is-longer-than-32-characters';
  process.env.APPS_SCRIPT_MARKETING_URL = 'https://script.google.com/macros/s/deployment-test/exec';
  process.env.APPS_SCRIPT_MARKETING_SECRET = secret;
  let envelope: any;
  globalThis.fetch = (async (_url: any, options: any) => {
    envelope = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, code: 'SENT' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const requestId = 'b'.repeat(64);
  const result = await sendAppsScriptMarketingEmail({ to: 'customer@example.com', subject: 'Ưu đãi', body: 'Xin chào bạn', requestId });
  const payload = JSON.parse(envelope.payload);
  assert.equal(payload.type, 'marketing');
  assert.equal(payload.to, 'customer@example.com');
  assert.equal(payload.requestId, requestId);
  assert.equal(envelope.signature, createHmac('sha256', secret).update(envelope.payload).digest('hex'));
  assert.equal(result, `apps-script:${requestId}:SENT`);
});

test('Apps Script marketing only follows Google ContentService redirects', async () => {
  process.env.APPS_SCRIPT_MARKETING_URL = 'https://script.google.com/macros/s/deployment-test/exec';
  process.env.APPS_SCRIPT_MARKETING_SECRET = 'x'.repeat(32);
  globalThis.fetch = (async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/result' } })) as typeof fetch;
  await assert.rejects(sendAppsScriptMarketingEmail({ to: 'a@example.com', subject: 'A', body: 'B', requestId: 'c'.repeat(64) }), /REDIRECT_INVALID/);
});

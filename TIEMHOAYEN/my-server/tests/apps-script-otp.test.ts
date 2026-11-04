import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sendAppsScriptOtp } from '../services/apps-script-otp.service.js';

test('signed Apps Script delivery rejects tampering, replay and expired requests', async () => {
  const secret = 'test-only-secret-value-at-least-32-characters';
  const sent: unknown[] = [], cache = new Map();
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) },
    Utilities: { Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature: (p: string, s: string) => [...createHmac('sha256', s).update(p).digest()] },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k), put: (k: string, v: string) => cache.set(k, v) }) },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: (data: unknown) => sent.push(data) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (value: string) => ({ setMimeType: () => value }) },
  });
  vm.runInContext(readFileSync('scripts/apps-script-otp/Code.gs', 'utf8'), context);
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.APPS_SCRIPT_OTP_URL, oldSecret = process.env.APPS_SCRIPT_OTP_SECRET;
  process.env.APPS_SCRIPT_OTP_URL = 'https://script.google.com/macros/s/test/exec';
  process.env.APPS_SCRIPT_OTP_SECRET = secret;
  let body = '';
  const invoke = (contents: string) => context.doPost({ postData: { contents } });
  try {
    globalThis.fetch = async (_input, init) => {
      body = String(init?.body);
      return new Response(invoke(body), { status: 200 });
    };
    await sendAppsScriptOtp('shop@example.com', '123456');
    assert.equal(sent.length, 1);
    assert.equal(JSON.parse(invoke(body)).ok, false);
    assert.equal(JSON.parse(invoke(body.replace('123456', '654321'))).ok, false);
    const expired = JSON.stringify({ to: 'shop@example.com', code: '123456', timestamp: Date.now() - 61000, requestId: '12345678-1234-1234-1234-123456789012' });
    assert.equal(JSON.parse(invoke(JSON.stringify({ payload: expired, signature: createHmac('sha256', secret).update(expired).digest('hex') }))).ok, false);
    globalThis.fetch = async () => new Response('<html>Sign in</html>', { status: 200 });
    await assert.rejects(sendAppsScriptOtp('shop@example.com', '123456'));
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://example.com/' } });
    await assert.rejects(sendAppsScriptOtp('shop@example.com', '123456'), /REDIRECT_INVALID/);
    assert.equal(sent.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.APPS_SCRIPT_OTP_URL; else process.env.APPS_SCRIPT_OTP_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.APPS_SCRIPT_OTP_SECRET; else process.env.APPS_SCRIPT_OTP_SECRET = oldSecret;
  }
});

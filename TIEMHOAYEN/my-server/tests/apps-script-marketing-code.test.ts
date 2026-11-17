import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('marketing Apps Script verifies signatures, rejects replay tampering and sends once', () => {
  const secret = 'test-only-marketing-secret-at-least-32-characters';
  const sent: any[] = [], cache = new Map<string, string>();
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) },
    Utilities: { Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature: (payload: string, key: string) => [...createHmac('sha256', key).update(payload).digest()] },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (key: string) => cache.get(key), put: (key: string, value: string) => cache.set(key, value) }) },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: (data: any) => sent.push(data) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (value: string) => ({ setMimeType: () => value }) },
  });
  vm.runInContext(readFileSync('scripts/apps-script-marketing/Code.gs', 'utf8'), context);
  const payload = JSON.stringify({ type: 'marketing', to: 'customer@example.com', subject: 'Ưu đãi', body: 'Mã voucher riêng', timestamp: Date.now(), requestId: 'a'.repeat(64) });
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const invoke = (body: string) => JSON.parse(context.doPost({ postData: { contents: body } }));
  assert.deepEqual(invoke(JSON.stringify({ payload, signature })), { ok: true, code: 'SENT' });
  assert.equal(sent.length, 1);
  assert.deepEqual(invoke(JSON.stringify({ payload, signature })), { ok: true, code: 'ALREADY_SENT' });
  assert.equal(sent.length, 1);
  assert.equal(invoke(JSON.stringify({ payload: payload.replace('Mã voucher riêng', 'Mã khác'), signature })).ok, false);
  const expired = JSON.stringify({ type: 'marketing', to: 'customer@example.com', subject: 'Ưu đãi', body: 'Mã voucher riêng', timestamp: Date.now() - 60000, requestId: 'b'.repeat(64) });
  assert.equal(invoke(JSON.stringify({ payload: expired, signature: createHmac('sha256', secret).update(expired).digest('hex') })).ok, false);
});

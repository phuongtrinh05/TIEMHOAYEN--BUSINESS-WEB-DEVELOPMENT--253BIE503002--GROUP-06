import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('switching customers revokes only the old session and persists matching new identity', () => {
  class Storage {
    [key: string]: any;
    getItem(key: string) { return this[key] ?? null; }
    setItem(key: string, value: string) { this[key] = value; }
    removeItem(key: string) { delete this[key]; }
  }
  const localStorage = new Storage(), sessionStorage = new Storage();
  const revoked: string[] = [];
  const api = {
    apiBaseUrl: () => 'https://example.test/api',
    currentOrderAccountKey: () => JSON.parse(localStorage.getItem('khachHang') || 'null')?.KHACH_HANG_ID || '',
    orderAccessSession: () => JSON.parse(sessionStorage.getItem('orderLookupAccess') || 'null'),
    setTransientGuestLookupSession() {},
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('../my-client/src/app/services/session-auth.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: () => api, localStorage, sessionStorage, Event: class {},
    window: { dispatchEvent() {} }, fetch: (_url: string, options: any) => { revoked.push(options.headers['x-order-access']); return Promise.resolve({}); },
  });
  const oldToken = 'oa_' + 'a'.repeat(64), newToken = 'oa_' + 'b'.repeat(64);
  localStorage.setItem('token', oldToken);
  localStorage.setItem('khachHang', JSON.stringify({ KHACH_HANG_ID: 'KH_OLD' }));
  sessionStorage.setItem('orderLookupAccess', JSON.stringify({ accessToken: oldToken, customerId: 'KH_OLD' }));
  sessionStorage.setItem('checkoutOrderAccess:old', 'private-old-order');
  const result = { customer: { KHACH_HANG_ID: 'KH_NEW' }, token: newToken, orderAccess: {
    accessToken: newToken, authType: 'member', customerId: 'KH_NEW', expiresAt: new Date(Date.now() + 3600000).toISOString(),
  } };
  exports.startMemberSession(result);
  assert.deepEqual(revoked, [oldToken]);
  assert.equal(api.currentOrderAccountKey(), 'KH_NEW');
  assert.equal(exports.memberAccessToken(), newToken);
  assert.equal(api.orderAccessSession().accountKey, 'KH_NEW');
  assert.equal(sessionStorage.getItem('checkoutOrderAccess:old'), null);
  assert.throws(() => exports.startMemberSession({ ...result, customer: { KHACH_HANG_ID: 'WRONG' } }));
  assert.equal(api.currentOrderAccountKey(), 'KH_NEW');
  exports.endSession();
  assert.equal(localStorage.getItem('token'), null);
  assert.equal(api.orderAccessSession(), null);
});

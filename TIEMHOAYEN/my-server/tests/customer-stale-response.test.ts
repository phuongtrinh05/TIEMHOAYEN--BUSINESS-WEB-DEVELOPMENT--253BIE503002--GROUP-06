import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('late 401 from old account never signs out the new account; current 401 still signs out', () => {
  let currentToken = 'oa_' + 'a'.repeat(64), ended = 0;
  class HttpErrorResponse { status = 401; }
  const exports: any = {};
  const localStorage = { getItem: (key: string) => key === 'khachHang' ? JSON.stringify({ KHACH_HANG_ID: 'KH_NEW' }) : null };
  const sessionStorage = { getItem: () => null, removeItem() {} };
  vm.runInNewContext(ts.transpileModule(readFileSync('../my-client/src/app/services/api-config.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, localStorage, sessionStorage,
    require: (id: string) => id === '@angular/common/http' ? { HttpErrorResponse }
      : id === 'rxjs' ? { tap: (observer: any) => observer }
      : { memberAccessToken: () => currentToken, endSession: () => ended++ },
  });
  const request = () => ({ url: 'https://tiem-hoa-yen-api.onrender.com/api/customers/KH_NEW',
    headers: { get: (_key: string): string | null => null },
    clone(options: any) { const token = options.setHeaders?.['x-order-access']; return { ...this, headers: { get: (key: string) => key === 'x-order-access' ? token : null } }; },
  });
  const oldObserver = exports.apiEndpointInterceptor(request(), () => ({ pipe: (observer: any) => observer }));
  currentToken = 'oa_' + 'b'.repeat(64);
  oldObserver.error(new HttpErrorResponse());
  assert.equal(ended, 0);
  const currentObserver = exports.apiEndpointInterceptor(request(), () => ({ pipe: (observer: any) => observer }));
  currentObserver.error(new HttpErrorResponse());
  assert.equal(ended, 1);
  let cartToken = '';
  exports.apiEndpointInterceptor({ ...request(), url: 'https://tiem-hoa-yen-api.onrender.com/api/cart/add' }, (target: any) => {
    cartToken = target.headers.get('x-order-access'); return { pipe: (observer: any) => observer };
  });
  assert.equal(cartToken, currentToken);
});

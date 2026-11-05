import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';

export type PasswordRule = { key: string; label: string };

/** Fallback khi chưa tải được quy tắc từ máy chủ (trùng với quy tắc server kiểm tra). */
export const DEFAULT_PASSWORD_RULES: PasswordRule[] = [
  { key: 'length', label: 'Từ 8 đến 72 ký tự' },
  { key: 'lower', label: 'Có chữ thường (a-z)' },
  { key: 'upper', label: 'Có chữ hoa (A-Z)' },
  { key: 'digit', label: 'Có chữ số (0-9)' },
  { key: 'special', label: 'Có ký tự đặc biệt (!@#$…)' },
];

/** Kiểm tra một quy tắc mật khẩu ở phía trình duyệt để hiển thị checklist trực tiếp. */
export function passwordRuleMet(key: string, password: string): boolean {
  const value = password || '';
  switch (key) {
    case 'length': return value.length >= 8 && value.length <= 72;
    case 'lower': return /[a-z]/.test(value);
    case 'upper': return /[A-Z]/.test(value);
    case 'digit': return /\d/.test(value);
    case 'special': return /[^A-Za-z0-9\s]/.test(value);
    default: return true;
  }
}

export function passwordMeetsAllRules(password: string, rules: PasswordRule[] = DEFAULT_PASSWORD_RULES): boolean {
  return rules.every(rule => passwordRuleMet(rule.key, password));
}

@Injectable({
  providedIn: 'root'
})
export class RegisterService {

  private apiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/customers';
  private rulesUrl = 'https://tiem-hoa-yen-api.onrender.com/api/auth/password-rules';

  constructor(private http: HttpClient) {}

  register(data: any): Observable<any> {
    return this.http.post(
      this.apiUrl,
      data
    );
  }

  /** Lấy nhãn quy tắc mật khẩu từ server; lỗi mạng thì dùng bộ quy tắc mặc định. */
  passwordRules(): Observable<PasswordRule[]> {
    return this.http.get<{ rules?: PasswordRule[] }>(this.rulesUrl).pipe(
      map(res => {
        const rules = (res?.rules || []).filter(rule => rule && typeof rule.key === 'string' && typeof rule.label === 'string');
        return rules.length ? rules : DEFAULT_PASSWORD_RULES;
      }),
      catchError(() => of(DEFAULT_PASSWORD_RULES))
    );
  }
}

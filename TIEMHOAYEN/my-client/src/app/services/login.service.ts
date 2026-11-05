import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LoginService {

  private baseUrl = 'https://tiem-hoa-yen-api.onrender.com/api/customers';

  constructor(
    private http: HttpClient
  ) {}

  login(data: { SDT: string; MAT_KHAU: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/login`, data);
  }

  /**
   * Gửi mã OTP.
   * - Đăng ký: { EMAIL | SDT, purpose: 'DANG_KY' }
   * - Khôi phục mật khẩu: { SDT } hoặc { EMAIL } (server luôn trả thông báo chung)
   */
  sendOtp(data: { SDT?: string; EMAIL?: string; purpose?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/send-otp`, data);
  }

  verifyOtp(data: { challengeId: string; OTP: string; purpose?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/verify-otp`, data);
  }
}

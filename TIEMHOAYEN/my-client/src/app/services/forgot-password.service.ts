import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ForgotPasswordService {

  private apiUrl =
    'https://tiem-hoa-yen-api.onrender.com/api/customers/forgot-password';

  constructor(private http: HttpClient) {}

  /** Đặt mật khẩu mới bằng resetToken nhận được sau khi xác minh OTP. */
  changePassword(data: { resetToken: string; NEW_PASSWORD: string }): Observable<any> {
    return this.http.put(
      this.apiUrl,
      data
    );
  }
}

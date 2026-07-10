import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LoginService {

  private apiUrl =
    'https://tiem-hoa-yen-api.onrender.com/api/customers/login';

  constructor(
    private http: HttpClient
  ) {}

  login(data: any): Observable<any> {
    return this.http.post(
      this.apiUrl,
      data
    );
  }
  sendOtp(data:any){
  return this.http.post(
    'https://tiem-hoa-yen-api.onrender.com/api/customers/send-otp',
    data
  );
}

verifyOtp(data:any){
  return this.http.post(
    'https://tiem-hoa-yen-api.onrender.com/api/customers/verify-otp',
    data
  );
}
}
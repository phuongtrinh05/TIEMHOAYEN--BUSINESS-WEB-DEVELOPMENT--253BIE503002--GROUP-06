import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

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
    ).pipe(tap((response: any) => {
      sessionStorage.removeItem('orderLookupAccess');
      sessionStorage.removeItem('tiemHoaYenActiveSalesChat');
      sessionStorage.removeItem('pendingSalesLookup');
      if (response.orderAccess) sessionStorage.setItem('orderLookupAccess', JSON.stringify({ ...response.orderAccess, accountKey: response.customer.KHACH_HANG_ID }));
    }));
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

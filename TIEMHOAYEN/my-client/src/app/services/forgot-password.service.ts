import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ForgotPasswordService {

  private apiUrl =
    'http://localhost:3000/api/customers/forgot-password';

  constructor(private http: HttpClient) {}

  changePassword(data: any): Observable<any> {
    return this.http.put(
      this.apiUrl,
      data
    );
  }
}
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ChatService {

  private apiUrl = 'http://localhost:3000/api/chats';

  constructor(private http: HttpClient) {}

  sendMessage(data: {
    chatInput: string;
    customerId: string | null;
    pageContext: string;
    productId: string | null;
    orderId: string | null;
  }): Observable<any> {
    return this.http.post(this.apiUrl, data);
  }
}
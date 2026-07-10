import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Topic {
  CHU_DE_ID: string;
  TEN_CHU_DE: string;
  MO_TA: string;
}

@Injectable({
  providedIn: 'root'
})
export class TopicService {
  private apiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/categories';

  constructor(private http: HttpClient) {}

  getAll(): Observable<Topic[]> {
    return this.http.get<Topic[]>(this.apiUrl);
  }
}
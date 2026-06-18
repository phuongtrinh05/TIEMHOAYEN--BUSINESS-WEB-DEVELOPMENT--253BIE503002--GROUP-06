import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Collection {
  BO_SUU_TAP_ID: string;
  TEN_BO_SUU_TAP: string;
  MO_TA: string;
}

@Injectable({ providedIn: 'root' })
export class CollectionService {
  private apiUrl = 'http://localhost:3000/api/collections';

  constructor(private http: HttpClient) {}

  getAll(): Observable<Collection[]> {
    return this.http.get<Collection[]>(this.apiUrl);
  }
}

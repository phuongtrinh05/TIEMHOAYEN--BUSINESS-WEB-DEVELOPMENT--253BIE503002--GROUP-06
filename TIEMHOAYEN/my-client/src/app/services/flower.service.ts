import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Flower {
  HOA_TUOI_ID: string;
  TEN_HOA_TUOI: string;
}

@Injectable({
  providedIn: 'root'
})
export class FlowerService {
  private apiUrl = 'http://localhost:3000/api/flowers';

  constructor(private http: HttpClient) {}

  getAll(): Observable<Flower[]> {
    return this.http.get<Flower[]>(this.apiUrl);
  }
}
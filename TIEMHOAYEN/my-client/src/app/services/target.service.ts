import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Target {
  DOI_TUONG_ID: string;
  TEN_DOI_TUONG: string;
}

@Injectable({
  providedIn: 'root'
})
export class TargetService {
  private apiUrl = 'http://localhost:3000/api/targets';

  constructor(private http: HttpClient) {}

  getAll(): Observable<Target[]> {
    return this.http.get<Target[]>(this.apiUrl);
  }
}
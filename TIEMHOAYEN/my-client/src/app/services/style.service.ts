import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Style {
  KIEU_DANG: string;
}

@Injectable({
  providedIn: 'root'
})
export class StyleService {
  private apiUrl = 'http://localhost:3000/api/styles';

  constructor(private http: HttpClient) {}

  getAll(): Observable<Style[]> {
    return this.http.get<Style[]>(this.apiUrl);
  }
}
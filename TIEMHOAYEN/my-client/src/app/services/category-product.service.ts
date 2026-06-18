import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CategoryTopic {
  CHU_DE_ID: string;
  TEN_CHU_DE: string;
}

export interface CategoryProduct {
  SAN_PHAM_ID: string;
  CHU_DE_ID: string;
  TEN_CHU_DE: string;
  TEN_SAN_PHAM: string;
  MO_TA: string;
  GIA: number;
  GIA_KHUYEN_MAI: number | null;
  TRANG_THAI: string;
  KIEU_DANG: string;
  SO_LUONG: number;
  DA_BAN: number;
  HINH_ANH: string | null;
}

export interface ProductsByTopicResponse {
  topic: CategoryTopic;
  products: CategoryProduct[];
}

@Injectable({
  providedIn: 'root'
})
export class CategoryProductService {
  private apiUrl = 'http://localhost:3000/api/category-products';

  constructor(private http: HttpClient) {}

  getProductsByTopic(id: string): Observable<ProductsByTopicResponse> {
    return this.http.get<ProductsByTopicResponse>(`${this.apiUrl}/topic/${id}`);
  }
}
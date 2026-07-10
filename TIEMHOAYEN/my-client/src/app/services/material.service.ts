import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SuggestedMaterial {
  NGUYEN_VAT_LIEU_ID: string;
  TEN_NGUYEN_VAT_LIEU: string;
  DON_VI_TINH: string;
  SO_LUONG_TON: number;
  GIA_NHAP: number | string;
  GIA_BAN: number | string;
  MO_TA: string;
}

export interface SuggestedMaterialResponse {
  total: number;
  materials: SuggestedMaterial[];
}

@Injectable({ providedIn: 'root' })
export class MaterialService {
  private apiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/materials';

  constructor(private http: HttpClient) {}

  getAllMaterials(): Observable<SuggestedMaterial[]> {
    return this.http.get<SuggestedMaterial[]>(this.apiUrl);
  }

  getSuggestedMaterials(): Observable<SuggestedMaterialResponse> {
    return this.http.get<SuggestedMaterialResponse>(`${this.apiUrl}/suggested`);
  }
}
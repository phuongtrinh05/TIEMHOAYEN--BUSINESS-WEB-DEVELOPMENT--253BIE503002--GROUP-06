import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PublicCampaign {
  CHIEN_DICH_ID: string;
  TEN_CHIEN_DICH: string;
  MO_TA?: string | null;
  NGAY_BAT_DAU?: string | null;
  NGAY_KET_THUC?: string | null;
  TRANG_THAI?: string | null;
}

@Injectable({ providedIn: 'root' })
export class CampaignService {
  private readonly apiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/campaigns';

  constructor(private http: HttpClient) {}

  getPublicCampaigns(): Observable<PublicCampaign[]> {
    return this.http.get<PublicCampaign[]>(this.apiUrl);
  }
}

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

export interface ProductDetailData {
  SAN_PHAM_ID: string;
  CHU_DE_ID: string;
  TEN_CHU_DE: string;
  TEN_SAN_PHAM: string;
  MO_TA: string;
  GIA: number | string;
  GIA_KHUYEN_MAI: number | string | null;
  TRANG_THAI: string;
  KIEU_DANG: string;
  SO_LUONG: number;
  DA_BAN: number;
  HINH_ANH: string | null;
}

export interface ProductDetailImage {
  HINH_ANH_ID: string;
  SAN_PHAM_ID: string;
  URL: string;
  LA_ANH_CHINH: boolean | number;
}

export interface ProductReviewStats {
  reviewCount: number;
  averageRating: number;
}

export interface ProductReviewData {
  reviewId: string;
  orderId: string;
  productId: string;
  customerId: string | null;
  customerName: string;
  avatar: string | null;
  rating: number;
  content: string;
  createdAt: string;
  images: string[];
  shopReply: string | null;
  shopReplyDate: string | null;
  shopReplyStaffId?: string | null;
}

export interface ProductDetailResponse {
  product: ProductDetailData;
  images: ProductDetailImage[];
  reviewStats: ProductReviewStats;
  reviews: ProductReviewData[];
}

@Injectable({
  providedIn: 'root'
})
export class ProductDetailService {
  private apiUrl = 'http://localhost:3000/api/products';
  private productCache = new Map<string, Observable<ProductDetailResponse>>();
  private allProducts$?: Observable<ProductDetailData[]>;

  constructor(private http: HttpClient) {}

  getProductById(id: string): Observable<ProductDetailResponse> {
    const cached = this.productCache.get(id);

    if (cached) {
      return cached;
    }

    const request$ = this.http.get<ProductDetailResponse>(`${this.apiUrl}/${id}`).pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.productCache.set(id, request$);
    return request$;
  }

  getAllProducts(): Observable<ProductDetailData[]> {
    if (!this.allProducts$) {
      this.allProducts$ = this.http.get<ProductDetailData[]>(this.apiUrl).pipe(
        shareReplay({ bufferSize: 1, refCount: false })
      );
    }

    return this.allProducts$;
  }

  clearCache(): void {
    this.productCache.clear();
    this.allProducts$ = undefined;
  }
}

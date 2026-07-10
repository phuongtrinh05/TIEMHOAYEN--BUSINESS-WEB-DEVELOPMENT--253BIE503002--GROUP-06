import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { shareReplay, tap } from 'rxjs/operators';

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
  private apiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/products';
  private productCache = new Map<string, Observable<ProductDetailResponse>>();
  private allProducts$?: Observable<ProductDetailData[]>;
  private readonly storagePrefix = 'tiemHoaYen:product-detail:';
  private readonly cacheTtlMs = 10 * 60 * 1000;

  constructor(private http: HttpClient) {}

  getProductById(id: string): Observable<ProductDetailResponse> {
    const cached = this.productCache.get(id);

    if (cached) {
      return cached;
    }

    const stored = this.readStoredResponse<ProductDetailResponse>(id);
    if (stored !== null) {
      const stored$ = of(stored).pipe(shareReplay({ bufferSize: 1, refCount: false }));
      this.productCache.set(id, stored$);
      return stored$;
    }

    const request$ = this.http.get<ProductDetailResponse>(`${this.apiUrl}/${id}`).pipe(
      tap((response) => this.storeResponse(id, response)),
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

    if (typeof localStorage !== 'undefined') {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(this.storagePrefix))
        .forEach((key) => localStorage.removeItem(key));
    }
  }

  private readStoredResponse<T>(key: string): T | null {
    if (typeof localStorage === 'undefined') return null;

    try {
      const storageKey = this.storagePrefix + key;
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;

      const entry = JSON.parse(raw) as { expiresAt?: number; value?: T };
      if (!entry.expiresAt || entry.expiresAt <= Date.now() || entry.value === undefined) {
        localStorage.removeItem(storageKey);
        return null;
      }

      return entry.value;
    } catch {
      return null;
    }
  }

  private storeResponse<T>(key: string, value: T): void {
    if (typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(
        this.storagePrefix + key,
        JSON.stringify({ expiresAt: Date.now() + this.cacheTtlMs, value })
      );
    } catch {
      // Cache failures must never block the product page.
    }
  }
}

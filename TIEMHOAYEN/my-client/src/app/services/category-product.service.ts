import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

export interface CategoryTopic {
  CHU_DE_ID: string;
  TEN_CHU_DE: string;
}

export interface CategoryFlower {
  HOA_TUOI_ID: string;
  TEN_HOA_TUOI: string;
}

export interface CategoryProduct {
  SAN_PHAM_ID: string;
  CHU_DE_ID: string;
  TEN_CHU_DE: string;

  HOA_TUOI_ID?: string;
  TEN_HOA_TUOI?: string;
  TEN_HOA_TUOI_LIST?: string | null;

  DOI_TUONG_ID?: string;
  TEN_DOI_TUONG?: string;
  TEN_DOI_TUONG_LIST?: string | null;

  MAU_SAC_ID?: string;
  TEN_MAU_SAC?: string;
  TEN_MAU_SAC_LIST?: string | null;

  BO_SUU_TAP_ID?: string;
  TEN_BO_SUU_TAP?: string;

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

export interface ProductsByFlowerResponse {
  flower: CategoryFlower;
  products: CategoryProduct[];
}

export interface CategoryTarget {
  DOI_TUONG_ID: string;
  TEN_DOI_TUONG: string;
}

export interface ProductsByStyleResponse {
  style: {
    KIEU_DANG: string;
  };
  products: CategoryProduct[];
}
export interface ProductsByTargetResponse {
  target: CategoryTarget;
  products: CategoryProduct[];
}
export interface CategoryColor {
  MAU_SAC_ID: string;
  TEN_MAU_SAC: string;
}

export interface ProductsByColorResponse {
  color: CategoryColor;
  products: CategoryProduct[];
}
export interface CategoryCollection {
  BO_SUU_TAP_ID: string;
  TEN_BO_SUU_TAP: string;
  MO_TA: string | null;
}

export interface ProductsByCollectionResponse {
  collection: CategoryCollection;
  products: CategoryProduct[];
}

export interface SaleProductsResponse {
  total: number;
  products: CategoryProduct[];
}

export interface BestSellerProductsResponse {
  total: number;
  products: CategoryProduct[];
}

export interface AllCategoryProductsResponse {
  total: number;
  products: CategoryProduct[];
}


@Injectable({
  providedIn: 'root'
})
export class CategoryProductService {
  private apiUrl = 'http://localhost:3000/api/category-products';
  private responseCache = new Map<string, Observable<unknown>>();

  constructor(private http: HttpClient) {}

  getAllProducts(): Observable<AllCategoryProductsResponse> {
    return this.cachedGet<AllCategoryProductsResponse>('all-products', this.apiUrl);
  }

  getProductsByTopic(id: string): Observable<ProductsByTopicResponse> {
    return this.cachedGet<ProductsByTopicResponse>(
      `topic:${id}`,
      `${this.apiUrl}/topic/${id}`
    );
  }

  getProductsByFlower(id: string): Observable<ProductsByFlowerResponse> {
    return this.cachedGet<ProductsByFlowerResponse>(
      `flower:${id}`,
      `${this.apiUrl}/flower/${id}`
    );
  }

  getProductsByStyle(style: string): Observable<ProductsByStyleResponse> {
    return this.cachedGet<ProductsByStyleResponse>(
      `style:${style}`,
      `${this.apiUrl}/style/${encodeURIComponent(style)}`
    );
  }
  getProductsByTarget(id: string): Observable<ProductsByTargetResponse> {
    return this.cachedGet<ProductsByTargetResponse>(
      `target:${id}`,
      `${this.apiUrl}/target/${id}`
    );
  }
  getProductsByColor(id: string): Observable<ProductsByColorResponse> {
    return this.cachedGet<ProductsByColorResponse>(
      `color:${id}`,
      `${this.apiUrl}/color/${id}`
    );
  }
  getProductsByCollection(id: string): Observable<ProductsByCollectionResponse> {
    return this.cachedGet<ProductsByCollectionResponse>(
      `collection:${id}`,
      `${this.apiUrl}/collection/${id}`
    );
  }
  getSaleProducts(): Observable<SaleProductsResponse> {
    return this.cachedGet<SaleProductsResponse>('sale', `${this.apiUrl}/sale`);
  }
  getBestSellerProducts(): Observable<BestSellerProductsResponse> {
    return this.cachedGet<BestSellerProductsResponse>(
      'best-seller',
      `${this.apiUrl}/best-seller`
    );
  }

  clearCache(): void {
    this.responseCache.clear();
  }

  private cachedGet<T>(key: string, url: string): Observable<T> {
    const cached = this.responseCache.get(key) as Observable<T> | undefined;

    if (cached) {
      return cached;
    }

    const request$ = this.http.get<T>(url).pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.responseCache.set(key, request$);
    return request$;
  }
}

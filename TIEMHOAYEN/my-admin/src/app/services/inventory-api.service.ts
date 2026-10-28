import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { apiBaseUrl } from './api-config';

/* =====================================================================
 * KIỂU DỮ LIỆU KHO — khớp backend my-server/services/inventory/*
 * ===================================================================== */

export interface InventoryMeta {
  config: { holdMinutes: number; sameDayCutoff: string; productLowStockMax: number };
  materialTypes: string[];
  importTypes: string[];
  exportTypes: string[];
  poStatuses: string[];
  supplierStatuses: string[];
  bomStatuses: string[];
}

export interface InvMaterial {
  code: string;
  name: string;
  image: string;
  unit: string;
  description: string;
  group: 'DE_HU' | 'IT_HU';
  type: string;
  importPrice: number;
  sellPrice: number;
  averageCost: number;
  threshold: number;
  maxLevel: number;
  shelfDays: number | null;
  substitutionGroup: string;
  purchaseUnit: string;
  conversionRate: number;
  active: boolean;
  statusLabel: string;
  onHand: number;
  reserved: number;
  damaged: number;
  available: number;
  stockStatus: 'ok' | 'low' | 'out';
  status: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface InvMaterialDetail {
  material: InvMaterial;
  sources: Array<{ sourceId: string; receivedAt: string; supplierId: string | null; unitCost: number; accepted: number; remaining: number; damaged: number; reserved: number; usable: number }>;
  reservations: any[];
  movements: any[];
  suppliers: any[];
  usedInBoms: number;
}

export interface InvSupplier {
  NHA_CUNG_CAP_ID: string;
  TEN_NHA_CUNG_CAP: string;
  NGUOI_DAI_DIEN?: string;
  SDT?: string;
  EMAIL?: string;
  DIA_CHI?: string;
  MA_SO_THUE?: string;
  TRANG_THAI: string;
  LOGO?: string;
  DIEU_KHOAN_THANH_TOAN?: string;
  GIO_CHOT_DON?: string;
  SO_NGAY_GIAO_MAC_DINH?: number;
  GHI_CHU?: string;
  SO_NVL_CUNG_CAP?: number;
  DANG_HOAT_DONG?: boolean;
  NGAY_CAP_NHAT?: string;
  NGUOI_CAP_NHAT?: string;
}

export interface InvSupplierMaterial {
  _id: string;
  NHA_CUNG_CAP_ID: string;
  NGUYEN_VAT_LIEU_ID: string;
  TEN_NGUYEN_VAT_LIEU?: string;
  TEN_NHA_CUNG_CAP?: string;
  DON_VI_TINH?: string;
  MA_HANG_NCC?: string | null;
  DON_VI_MUA: string;
  HE_SO_QUY_DOI: number;
  DON_GIA: number;
  SL_DAT_TOI_THIEU: number;
  SO_NGAY_GIAO: number;
  GIO_CHOT_DON: string | null;
  UU_TIEN: number;
  MUC_TIN_CAY: string;
  NGAY_XAC_MINH: string;
  TRANG_THAI: string;
  GHI_CHU?: string | null;
}

export interface InvDocDetail {
  NGUYEN_VAT_LIEU_ID: string;
  TEN_NGUYEN_VAT_LIEU?: string;
  DON_VI_TINH?: string;
  NHOM_NVL?: string;
  // PN
  SL_DU_KIEN?: number | null;
  SL_THUC_NHAN?: number;
  SL_DAT?: number;
  SL_KHONG_DAT?: number;
  SO_LUONG_NHAP?: number;
  DON_GIA_NHAP?: number;
  NCC_CHI_TINH_SL_DAT?: boolean;
  THANH_TIEN?: number;
  DON_GIA_VON?: number;
  // PX
  SL_THEO_BOM?: number | null;
  SO_LUONG_XUAT?: number;
  PHAN_BO?: Array<{ PHIEU_NHAP_ID: string; SO_LUONG: number; DON_GIA_VON: number }>;
  THANH_TIEN_VON?: number;
  SL_GIU_DA_KET_THUC?: number;
  GHI_CHU?: string | null;
}

export interface InvDocument {
  PHIEU_NHAP_ID?: string;
  PHIEU_XUAT_ID?: string;
  LOAI_NHAP?: string;
  LOAI_XUAT?: string;
  TRANG_THAI: string;
  NHA_CUNG_CAP_ID?: string | null;
  TEN_NHA_CUNG_CAP?: string;
  PO_ID?: string | null;
  DON_HANG_ID?: string | null;
  SAN_PHAM_ID?: string | null;
  SO_BO?: number | null;
  THOI_DIEM_NHAN?: string;
  NGAY_NHAP?: string;
  NGAY_XUAT?: string;
  TONG_TIEN?: number;
  TONG_GIA_VON?: number;
  GHI_CHU?: string | null;
  NGUOI_LAP?: string;
  TEN_NGUOI_LAP?: string;
  NGUOI_XAC_NHAN?: string;
  TEN_NGUOI_XAC_NHAN?: string;
  NGAY_XAC_NHAN?: string;
  DU_LIEU_CU?: boolean;
  DU_LIEU_MAU?: boolean;
  details: InvDocDetail[];
}

export interface InvPurchaseOrder {
  PO_ID: string;
  NHA_CUNG_CAP_ID: string;
  NGAY_DAT: string;
  NGAY_GIO_DU_KIEN_GIAO: string | null;
  TRANG_THAI: string;
  CHI_TIET: Array<{ NGUYEN_VAT_LIEU_ID: string; DON_VI_TINH: string; SL_DAT: number; DON_GIA_DU_KIEN: number; SL_DA_NHAN: number; SL_DAT_DA_NHAN: number }>;
  TONG_TIEN_DU_KIEN: number;
  GHI_CHU?: string | null;
}

export interface InvBomLine {
  NGUYEN_VAT_LIEU_ID: string;
  DINH_LUONG: number;
  DON_VI_TINH: string;
  VAI_TRO: string;
  DS_THAY_THE: string[];
  GHI_CHU: string;
}

export interface InvBom {
  BOM_ID: string;
  SAN_PHAM_ID: string;
  PHIEN_BAN: number;
  TRANG_THAI: string;
  CHO_THAY_THE_NVL: boolean;
  HIEU_LUC_TU?: string | null;
  HIEU_LUC_DEN?: string | null;
  CAN_RA_SOAT?: boolean;
  GHI_CHU?: string;
  lines: InvBomLine[];
  cost?: { items: Array<{ materialId: string; name: string; quantity: number; unit: string; unitCost: number; amount: number }>; total: number };
}

export interface InvBomProduct {
  SAN_PHAM_ID: string;
  TEN_SAN_PHAM: string;
  KIEU_DANG: string;
  GIA: number;
  GIA_KHUYEN_MAI?: number;
  TRANG_THAI: string;
  activeBomId: string | null;
  activeVersion: number | null;
  needsReview: boolean;
  draftCount: number;
  lineCount: number;
  finishedAvailable: number;
  buildable: number;
  sellable: number;
  bottleneck: { materialId: string; name: string } | null;
}

export interface InvAlerts {
  summary: Record<string, number>;
  materialAlerts: Array<{ materialId: string; name: string; unit: string; status: string; label: string; available: number; threshold: number; maxLevel: number; suggestedOrder: number }>;
  forecastShortages: Array<{ orderId: string; materialId: string; name: string; unit: string; neededAt: string; required: number; missing: number; available: number; incoming: number }>;
  ordersWithoutSchedule: string[];
  productAlerts: Array<{ productId: string; name: string; sellable: number; status: string; label: string; bottleneck: { name: string } | null; noBom: boolean }>;
  qualityChecks: Array<{ materialId: string; name: string; sourceId: string; receivedAt: string; ageDays: number; shelfDays: number; quantity: number; reserved: number }>;
}

/** Lấy thông điệp lỗi tiếng Việt từ backend (kèm chi tiết thiếu hàng / lỗi BOM nếu có). */
export function inventoryErrorMessage(error: unknown): string {
  const e = error as HttpErrorResponse;
  const body = e?.error;
  if (e?.status === 0) return `Không kết nối được backend ${apiBaseUrl()}. Kiểm tra server (npm start trong my-server) đã chạy chưa.`;
  if (e?.status === 404 && (!body || typeof body !== 'object' || !body.message)) {
    return `Backend ${apiBaseUrl()} chưa có API kho mới (404). Chạy my-server bản mới ở máy (npm start) rồi bấm "Dùng backend local" ở góc phải thanh tab.`;
  }
  if (!body) return 'Không kết nối được máy chủ.';
  const parts = [body.message || e.message];
  const details = body.details;
  if (Array.isArray(details)) parts.push(...details.map((d: unknown) => `• ${d}`));
  if (details?.shortages) {
    parts.push(...details.shortages.map((s: any) => `• ${s.name}: cần ${s.required}, khả dụng ${s.available}${s.reason ? ` — ${s.reason}` : ''}`));
  }
  return parts.filter(Boolean).join('\n');
}

@Injectable({ providedIn: 'root' })
export class InventoryApiService {
  private readonly base = `${apiBaseUrl()}/admin`;

  constructor(private readonly http: HttpClient) {}

  private params(query: Record<string, unknown> = {}): HttpParams {
    let params = new HttpParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    });
    return params;
  }

  meta(): Observable<InventoryMeta> {
    return this.http.get<InventoryMeta>(`${this.base}/inventory/meta`);
  }

  /* NVL */
  materials(query: Record<string, unknown> = {}): Observable<{ total: number; materials: InvMaterial[]; types: string[] }> {
    return this.http.get<any>(`${this.base}/materials`, { params: this.params(query) });
  }
  materialDetail(id: string): Observable<InvMaterialDetail> {
    return this.http.get<InvMaterialDetail>(`${this.base}/materials/${encodeURIComponent(id)}`);
  }
  createMaterial(body: Partial<InvMaterial>): Observable<{ material: InvMaterial }> {
    return this.http.post<any>(`${this.base}/materials`, body);
  }
  updateMaterial(id: string, body: Partial<InvMaterial>): Observable<{ material: InvMaterial }> {
    return this.http.put<any>(`${this.base}/materials/${encodeURIComponent(id)}`, body);
  }
  deleteMaterial(id: string): Observable<{ hidden?: boolean; deleted?: boolean; message?: string }> {
    return this.http.delete<any>(`${this.base}/materials/${encodeURIComponent(id)}`);
  }
  markDamaged(id: string, body: { quantity: number; sourceId?: string; note?: string }): Observable<unknown> {
    return this.http.post(`${this.base}/materials/${encodeURIComponent(id)}/mark-damaged`, body);
  }
  uploadMaterialImage(file: File): Observable<string> {
    const form = new FormData();
    form.append('image', file);
    return this.http.post<any>(`${this.base}/materials/upload-image`, form).pipe(map((r) => r.url || r.imageUrl || ''));
  }

  /* NCC */
  suppliers(query: Record<string, unknown> = {}): Observable<{ total: number; suppliers: InvSupplier[]; statuses: string[] }> {
    return this.http.get<any>(`${this.base}/suppliers`, { params: this.params(query) });
  }
  createSupplier(body: Record<string, unknown>): Observable<{ supplier: InvSupplier }> {
    return this.http.post<any>(`${this.base}/suppliers`, body);
  }
  updateSupplier(id: string, body: Record<string, unknown>): Observable<{ supplier: InvSupplier }> {
    return this.http.put<any>(`${this.base}/suppliers/${encodeURIComponent(id)}`, body);
  }
  deleteSupplier(id: string): Observable<{ deactivated?: boolean; deleted?: boolean; message?: string }> {
    return this.http.delete<any>(`${this.base}/suppliers/${encodeURIComponent(id)}`);
  }
  supplierMaterials(query: Record<string, unknown> = {}): Observable<{ total: number; items: InvSupplierMaterial[] }> {
    return this.http.get<any>(`${this.base}/supplier-materials`, { params: this.params(query) });
  }
  saveSupplierMaterial(body: Record<string, unknown>, id?: string): Observable<InvSupplierMaterial> {
    return id
      ? this.http.put<InvSupplierMaterial>(`${this.base}/supplier-materials/${encodeURIComponent(id)}`, body)
      : this.http.post<InvSupplierMaterial>(`${this.base}/supplier-materials`, body);
  }
  deleteSupplierMaterial(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/supplier-materials/${encodeURIComponent(id)}`);
  }

  /* PO */
  purchaseOrders(query: Record<string, unknown> = {}): Observable<{ total: number; purchaseOrders: InvPurchaseOrder[]; statuses: string[] }> {
    return this.http.get<any>(`${this.base}/purchase-orders`, { params: this.params(query) });
  }
  createPurchaseOrder(body: Record<string, unknown>): Observable<InvPurchaseOrder> {
    return this.http.post<InvPurchaseOrder>(`${this.base}/purchase-orders`, body);
  }
  updatePurchaseOrder(id: string, body: Record<string, unknown>): Observable<InvPurchaseOrder> {
    return this.http.put<InvPurchaseOrder>(`${this.base}/purchase-orders/${encodeURIComponent(id)}`, body);
  }
  changePurchaseOrderStatus(id: string, status: string, note?: string): Observable<InvPurchaseOrder> {
    return this.http.post<InvPurchaseOrder>(`${this.base}/purchase-orders/${encodeURIComponent(id)}/status`, { status, note });
  }

  /* PN / PX */
  documents(kind: 'imports' | 'exports', query: Record<string, unknown> = {}): Observable<{ total: number; items: InvDocument[] }> {
    return this.http.get<any>(`${this.base}/${kind}`, { params: this.params(query) });
  }
  saveDocument(kind: 'imports' | 'exports', body: Record<string, unknown>, id?: string): Observable<InvDocument> {
    return id
      ? this.http.put<InvDocument>(`${this.base}/${kind}/${encodeURIComponent(id)}`, body)
      : this.http.post<InvDocument>(`${this.base}/${kind}`, body);
  }
  postDocument(kind: 'imports' | 'exports', id: string): Observable<InvDocument & { alreadyPosted?: boolean }> {
    return this.http.post<any>(`${this.base}/${kind}/${encodeURIComponent(id)}/post`, {});
  }
  cancelDocument(kind: 'imports' | 'exports', id: string, reason?: string): Observable<unknown> {
    return this.http.post(`${this.base}/${kind}/${encodeURIComponent(id)}/cancel`, { reason });
  }
  deleteDocument(kind: 'imports' | 'exports', id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/${kind}/${encodeURIComponent(id)}`);
  }
  suggestExport(query: { type: string; orderId?: string; productId?: string; bundles?: number }): Observable<Array<{ materialId: string; name: string; unit: string; bomQty: number; quantity: number; available: number }>> {
    return this.http.get<any>(`${this.base}/exports/suggest`, { params: this.params(query) });
  }

  /* BOM */
  bomProducts(search = ''): Observable<{ total: number; items: InvBomProduct[] }> {
    return this.http.get<any>(`${this.base}/boms/products`, { params: this.params({ search }) });
  }
  productBoms(productId: string): Observable<{ boms: InvBom[]; legacyRecipe: InvBomLine[] }> {
    return this.http.get<any>(`${this.base}/boms/products/${encodeURIComponent(productId)}`);
  }
  createBom(productId: string, body: Record<string, unknown>): Observable<InvBom> {
    return this.http.post<InvBom>(`${this.base}/boms/products/${encodeURIComponent(productId)}`, body);
  }
  updateBom(bomId: string, body: Record<string, unknown>): Observable<InvBom> {
    return this.http.put<InvBom>(`${this.base}/boms/${encodeURIComponent(bomId)}`, body);
  }
  activateBom(bomId: string): Observable<InvBom> {
    return this.http.post<InvBom>(`${this.base}/boms/${encodeURIComponent(bomId)}/activate`, {});
  }
  retireBom(bomId: string): Observable<unknown> {
    return this.http.post(`${this.base}/boms/${encodeURIComponent(bomId)}/retire`, {});
  }

  /* Sổ kho / cảnh báo / giữ tồn */
  alerts(): Observable<InvAlerts> {
    return this.http.get<InvAlerts>(`${this.base}/inventory/alerts`);
  }
  movements(query: Record<string, unknown> = {}): Observable<{ total: number; items: any[] }> {
    return this.http.get<any>(`${this.base}/inventory/movements`, { params: this.params(query) });
  }
  reservations(query: Record<string, unknown> = {}): Observable<{ total: number; items: any[] }> {
    return this.http.get<any>(`${this.base}/inventory/reservations`, { params: this.params(query) });
  }
  releaseReservations(body: { orderId?: string; paymentSessionId?: string; reservationIds?: string[]; reason?: string }): Observable<{ released: number }> {
    return this.http.post<any>(`${this.base}/inventory/reservations/release`, body);
  }
  demands(query: Record<string, unknown> = {}): Observable<{ total: number; items: any[] }> {
    return this.http.get<any>(`${this.base}/inventory/demands`, { params: this.params(query) });
  }
  setPrepTime(orderId: string, neededAt: string): Observable<unknown> {
    return this.http.patch(`${this.base}/inventory/orders/${encodeURIComponent(orderId)}/prep-start`, { neededAt });
  }
  reserveDemand(orderId: string): Observable<unknown> {
    return this.http.post(`${this.base}/inventory/orders/${encodeURIComponent(orderId)}/reserve`, {});
  }
  finishedGoods(): Observable<{ total: number; items: any[] }> {
    return this.http.get<any>(`${this.base}/inventory/finished-goods`);
  }
  disposeFinished(productId: string, quantity: number, note: string): Observable<unknown> {
    return this.http.post(`${this.base}/inventory/finished-goods/${encodeURIComponent(productId)}/dispose`, { quantity, note });
  }
  reconcile(fix = false): Observable<{ ok: boolean; checkedMaterials: number; diffs: any[] }> {
    return this.http.post<any>(`${this.base}/inventory/reconcile`, { fix });
  }
}

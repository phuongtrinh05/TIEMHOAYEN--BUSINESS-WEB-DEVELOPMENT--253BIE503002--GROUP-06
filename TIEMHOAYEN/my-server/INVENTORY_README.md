# Kho S1–S2: NVL · NCC · BOM · PO · Phiếu nhập/xuất · Giữ tồn

Bản này hiện thực hóa **Stage S1 (Master data) + S2 (Inventory core)** theo:
`Các giai đoạn code.docx`, `TiemHoaYen_Final_Business_Data_StagePlan.pdf` (§04–§08) và `Tồn kho.docx` (D01, D02).

## 1. Quy tắc đã code

| Quy tắc | Ở đâu |
|---|---|
| `Khả dụng = Tồn thực − Đang giữ − Không đạt`. Không bao giờ âm. | `services/inventory/ledger.ts` |
| Popup NVL **không** sửa tồn. Tồn chỉ đổi qua PN/PX/đánh dấu không đạt. | `master-data.service.ts` |
| PN/PX: **Nháp → Đã ghi nhận** đúng 1 lần. Gọi lại không cộng/trừ thêm. Phiếu đã ghi nhận không sửa/xóa. | `stock.service.ts` `postImport` / `postExport` |
| PN: `Đạt + Không đạt = Thực nhận`. Chỉ SL đạt vào tồn. Shop trả cả phần lỗi thì giá vốn = tổng tiền / SL đạt. | `mapImportDetailInput` |
| Hoa/lá (nhóm `DE_HU`) xuất **FIFO** theo nguồn phiếu nhập. Giá vốn lưu theo từng nguồn. Phụ kiện (`IT_HU`) dùng giá vốn bình quân. | `allocateFifo` |
| Xuất cho đơn: kết thúc toàn bộ phần đơn đang giữ (n), trừ tồn thực x. x < n thì nhả phần dư. **Mỗi đơn chỉ 1 phiếu xuất** (có cả unique index). | `postExport` |
| Cắm bó sẵn: xuất NVL theo BOM, tồn **thành phẩm** tăng. Bán bó này không trừ NVL lần 2. | `TON_THANH_PHAM` trên `SAN_PHAM` |
| Giữ tồn: giữ tạm QR (`TAM_CHO_QR`, tự nhả khi hết hạn) và giữ chính thức (`CHINH_THUC`). Đủ hết hoặc không giữ gì. Dùng transaction nên 2 khách không giữ trùng. | `reserveProducts`, `sweepExpiredReservations` |
| Đơn giao ngày khác: ghi **nhu cầu dự kiến**, không giữ hoa. Admin nhập T. Đến lịch thì giữ chính thức. | `recordOrderDemand`, `setOrderPrepTime`, `reserveOrderDemand` |
| BOM có phiên bản. Mỗi sản phẩm 1 BOM "Hiệu lực". Kiểm tra: ≥1 NVL Chính, không trùng NVL, đơn vị khớp, NVL thay thế cùng nhóm. | `bom.service.ts` |
| PO chỉ là **dự báo**: không tăng tồn. Chỉ PO "Đang giao" được tính hàng đang về trước T. | `availability.service.ts` |
| Cảnh báo 3 tầng (NVL / bó hoa website / đơn tương lai theo T) và nhắc kiểm tra hoa quá số ngày bảo quản. | `getInventoryAlerts` |
| Sổ biến động `BIEN_DONG_KHO` ghi mọi thay đổi. Có đối soát bộ đếm ↔ sổ. | `ledger.ts`, `reconcileInventory` |
| NVL/NCC đã có giao dịch chỉ ẩn / "Ngừng hợp tác", không xóa cứng. | `deleteOrHideMaterial`, `deleteOrDeactivateSupplier` |

Cấu hình dùng chung nằm ở `services/inventory/constants.ts` → `INVENTORY_CONFIG`. Có thể override bằng `.env`:
`INVENTORY_HOLD_MINUTES` (mặc định 15), `INVENTORY_SAME_DAY_CUTOFF` (mặc định 14:00), `INVENTORY_PRODUCT_LOW_STOCK` (mặc định 3).

## 2. Dữ liệu (MongoDB)

**Trường mới trên collection cũ** (không xóa cột nào):

- **`NGUYEN_VAT_LIEU`**: `NHOM_NVL` (DE_HU/IT_HU), `LOAI_NVL`, `NGUONG_CANH_BAO`, `NGUONG_TOI_DA`, `SO_NGAY_BAO_QUAN`, `NHOM_THAY_THE`, `DON_VI_MUA`, `HE_SO_QUY_DOI`, `TRANG_THAI`, `TON_THUC`, `TON_DANG_GIU`, `TON_KHONG_DAT`, `GIA_VON_BQ`.
  - `SO_LUONG_TON` luôn bằng `TON_THUC` để code cũ vẫn chạy.
- **`NHA_CUNG_CAP`**: `GIO_CHOT_DON`, `SO_NGAY_GIAO_MAC_DINH`, `DIEU_KHOAN_THANH_TOAN`, `LOGO`, `GHI_CHU`.
- **`PHIEU_NHAP_NVL`**: `LOAI_NHAP`, `TRANG_THAI`, `THOI_DIEM_NHAN`, `PO_ID`, `NGUOI_LAP`, `NGUOI_XAC_NHAN`, `NGAY_XAC_NHAN`.
- **`CHI_TIET_PHIEU_NHAP_NVL`**: `SL_DU_KIEN`, `SL_THUC_NHAN`, `SL_DAT`, `SL_KHONG_DAT`, `DON_GIA_VON`, `NCC_CHI_TINH_SL_DAT`.
  - Thêm bộ đếm nguồn FIFO: `LA_NGUON_NHAP`, `SL_CON_LAI`, `SL_HONG`, `SL_DANG_GIU`, `SL_DA_XUAT`, `SL_DA_HUY`.
- **`PHIEU_XUAT_NVL`**: `LOAI_XUAT`, `TRANG_THAI`, `DON_HANG_ID`, `SAN_PHAM_ID`, `SO_BO`, `TONG_GIA_VON`, `NGUOI_XAC_NHAN`.
- **`CHI_TIET_PHIEU_XUAT_NVL`**: `SL_THEO_BOM`, `PHAN_BO[{PHIEU_NHAP_ID, SO_LUONG, DON_GIA_VON}]`, `THANH_TIEN_VON`.
- **`SAN_PHAM`**: `TON_THANH_PHAM`, `TP_DANG_GIU`, `GIA_VON_THANH_PHAM`.
  - **Không** dùng lại `SO_LUONG`, vì website khách đang đọc cột này.

**Collection mới**:

- `NHA_CUNG_CAP_NVL`: nguồn cung — giá, lead time, giờ chốt đơn, SL tối thiểu, độ tin cậy.
- `BOM_SAN_PHAM` + `CHI_TIET_BOM`: BOM có phiên bản. Khi kích hoạt, công thức được đồng bộ ngược về `CONG_THUC_SAN_PHAM`.
- `DON_DAT_MUA_NCC`: PO.
- `GIU_TON`: giữ tồn.
- `NHU_CAU_NVL_DU_KIEN`: nhu cầu theo lịch T.
- `BIEN_DONG_KHO`: sổ biến động.
- `BO_DEM_MA`: bộ đếm sinh mã an toàn khi nhiều request cùng lúc.

## 3. API (prefix `/api/admin`, quyền module `materials`; giữ tồn dùng quyền `orders`)

```
GET  /inventory/meta                     GET  /inventory/alerts        POST /inventory/reconcile
GET|POST /materials   GET|PUT|DELETE /materials/:id   POST /materials/:id/mark-damaged
GET|POST /suppliers   PUT|DELETE /suppliers/:id
GET|POST /supplier-materials   PUT|DELETE /supplier-materials/:id
GET|POST /purchase-orders   PUT /purchase-orders/:id   POST /purchase-orders/:id/status
GET|POST /imports   GET|PUT|DELETE /imports/:id   POST /imports/:id/post   POST /imports/:id/cancel
GET|POST /exports   GET /exports/suggest   GET|PUT|DELETE /exports/:id   POST /exports/:id/post|cancel
GET /boms/products   GET|POST /boms/products/:productId   PUT /boms/:id   POST /boms/:id/activate|retire
GET /inventory/movements   GET /inventory/finished-goods   POST /inventory/finished-goods/:id/dispose
GET|POST /inventory/reservations   POST /inventory/reservations/confirm|release|sweep
GET /inventory/demands   GET /inventory/orders/:orderId
POST /inventory/orders/:orderId/demand|reserve|cancel|ship-finished   PATCH /inventory/orders/:orderId/prep-start
```
Public: `GET /api/products/:id/availability?qty=&deliveryAt=` trả `decision: available | need_review` kèm lý do, NVL chốt chặn, dự báo và phương án NCC.

**Cho S3–S4 (checkout, yêu cầu đặt hàng)**: gọi các hàm sau trong `services/inventory/stock.service.ts`, không tự viết lại logic kho:

- `reserveProducts` khi tạo QR
- `confirmReservations` khi thanh toán hợp lệ
- `releaseReservations` / `cancelOrderInventory` khi hủy
- `recordOrderDemand` cho đơn giao ngày khác

## 4. Cách chạy

Thêm `.env` trong `my-server` (KHÔNG commit). Ví dụ có ở `.env.example`.

```bash
cd TIEMHOAYEN/my-server
npm install
# 1) Chạy thử, chỉ báo cáo — NÊN chạy trên DB dev/bản sao trước
npm run inventory:migrate -- --dry-run
# 2) Chuẩn hóa dữ liệu thật: thuộc tính NVL, BOM v1 từ CONG_THUC_SAN_PHAM, phiếu cũ → Đã ghi nhận,
#    tạo 1 phiếu "Tồn đầu kỳ" từ SO_LUONG_TON hiện tại (chạy lại không bị nhân đôi)
npm run inventory:migrate
# 3) Dữ liệu mẫu để nhóm kiểm thử (gắn cờ DU_LIEU_MAU)
npm run inventory:seed-demo
# 4) Xóa dữ liệu mẫu, tính lại tồn từ sổ
npm run inventory:reset-demo
# 5) Đối soát
npm run inventory:reconcile
npm start
```

Dữ liệu mẫu tạo ra:

- 2 NCC phụ kiện/quà tặng (đánh dấu "(mẫu)") và khoảng 200 dòng nguồn cung NCC–NVL.
- 4 PO: đang giao, chờ NCC xác nhận, tulip nhập khẩu 5 ngày, và 1 PO đã giao.
- Phiếu nhập:
  - 100 hồng nhận, 95 đạt, trả đủ tiền → giá vốn 8.421đ
  - giấy và ruy băng
  - 1 phiếu **Nháp** để thử bấm "Ghi nhận"
- Đánh dấu 10 hồng không đạt, rồi xuất hủy 4.
- Hao hụt cúc.
- Cắm sẵn 2 bó SP0204.
- Giữ chính thức cho 1 đơn đang có, kèm 1 phiếu xuất **Nháp** "Làm hoa theo đơn".
- 1 phiên giữ tạm QR (tự nhả sau thời gian giữ).
- Nhu cầu dự kiến của 2 đơn: 1 đơn có T ngày mai (dự báo thiếu hồng), 1 đơn chờ xếp T.

**Admin trỏ backend local** (frontend mặc định gọi Render): mở DevTools Console và chạy

```js
localStorage.setItem('API_BASE_URL','http://localhost:3000/api'); location.reload();
```

Bỏ trỏ local: `localStorage.removeItem('API_BASE_URL')`.

**Kiểm thử tự động**: gồm 17 ca, có các ca trong mục §08 của Stage plan. Cần MongoDB replica set (Atlas, hoặc `mongod --replSet`). Test tự tạo và xóa DB riêng.

```bash
TEST_MONGO_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0" npm run test:inventory
```

## 5. Còn cần nhóm chốt

- **Thời gian giữ QR**: Stage plan ghi 15 phút, `Tồn kho.docx` ghi 5 phút. Code đang để 15 phút, đổi bằng `INVENTORY_HOLD_MINUTES`.
- **Ngưỡng cảnh báo** lấy theo bảng D01.7 (giả định). Cần kiểm kê đầu kỳ trước khi bật cảnh báo, vì tồn mẫu 100 làm hoa hồng báo "Sắp hết" ngay.
- **Đơn vị trong công thức cũ**: một số công thức ghi khác đơn vị NVL (ví dụ baby: kg ↔ cành). BOM v1 của các sản phẩm này được gắn cờ **"Cần rà soát"**; lọc ở tab BOM để sửa.
- **Bảo mật** (ngoài phạm vi đợt này):
  - Quyền Admin đang dựa vào header `x-admin-role`, client có thể tự gửi.
  - `GET /api/employees` đang trả cả `MAT_KHAU` (hash).

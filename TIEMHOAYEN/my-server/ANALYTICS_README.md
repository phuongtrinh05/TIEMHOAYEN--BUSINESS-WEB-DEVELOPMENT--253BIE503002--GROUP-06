# Dashboard · Báo cáo · Thông báo Admin (AD02–AD07, AD09, AD60)

Phụ trách: Thế Vinh, Giai đoạn code 1. Trang Admin **Tổng quan** (`/dashboard`) gom mọi phần trên **một trang**, dùng **một bộ lọc thời gian chung**.

## 1. Chạy lần đầu

```bash
cd my-server
npm run analytics:migrate -- --dry-run   # xem số đơn sẽ được ghi ngày hoàn thành / ngày hủy ước tính
npm run analytics:migrate                # ghi NGAY_HOAN_THANH, NGAY_HUY (gắn cờ *_UOC_TINH), tạo index, quét thông báo
npm run analytics:check                  # in KPI 30 ngày + kết quả đối chiếu
npm run test:analytics                   # cần TEST_MONGO_URI trỏ Mongo replica set local
```

Biến môi trường (tùy chọn, có giá trị mặc định):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DASHBOARD_DELIVERY_RED_MINUTES` | 30 | Mốc màu đỏ của lịch giao |
| `DASHBOARD_DELIVERY_ORANGE_MINUTES` | 60 | Mốc màu cam của lịch giao |
| `DASHBOARD_DELIVERY_WINDOW_MINUTES` | 120 | Cửa sổ "giao trong 2h tới" |
| `DASHBOARD_PENDING_MINUTES` | 30 | Mốc "Chờ xử lý quá lâu" |

## 2. API (mount tại `/api/admin`)

| Method | Path | Quyền | Mục |
|---|---|---|---|
| GET | `/dashboard/overview?preset=&from=&to=&deliveryMode=&bestSort=` | dashboard.view | AD02–AD07 |
| GET | `/dashboard/best-products?sort=quantity\|revenue` | dashboard.view | AD07 |
| GET | `/dashboard/deliveries?mode=window\|today` | dashboard.view | AD05 |
| GET | `/dashboard/dictionary` | dashboard.view | D05/D07 |
| GET | `/reports/analytics?preset=&groupBy=day\|week\|month\|quarter\|year` | dashboard.view | AD04, AD60 |
| GET | `/reports/reconciliation` | dashboard.view | Đối chiếu đơn–tiền–kho |
| GET | `/notifications?group=&unread=` | lọc theo quyền từng module | AD09 |
| POST | `/notifications/:id/read`, `/notifications/read-all` | theo `x-admin-id` | AD09 |

Giá trị `preset`: `today`, `yesterday`, `7d`, `30d`, `thisMonth`, `lastMonth`, `thisQuarter`, `thisYear`, `custom` (đi kèm `from`/`to` dạng yyyy-mm-dd). **Kỳ so sánh** (`compare`): mặc định `previous` = kỳ liền trước cùng độ dài; `lastYear` = cùng kỳ năm trước (cùng ngày/tháng, năm − 1; 29/02 → 28/02). Trang Admin chỉ cho chọn **Từ ngày – Đến ngày** (gửi `preset=custom`), mặc định 30 ngày gần nhất. Ngày tính theo giờ VN (UTC+7).

## 3. D05: Từ điển KPI

| Mã | KPI | Công thức | Mốc ngày |
|---|---|---|---|
| K01 | Doanh thu thuần | Σ(TONG_TIEN − PHI_VAN_CHUYEN) của đơn **Hoàn thành** | NGAY_HOAN_THANH |
| K06 | Tiền đã thu | Σ SO_TIEN của giao dịch thành công; trùng MA_GIAO_DICH chỉ tính 1 lần | NGAY_THANH_TOAN |
| K05 | Tiền cọc đang giữ | Tiền đã thu của đơn chưa hoàn thành và chưa hủy/hoàn | Lúc xem (snapshot) |
| K02 | Đơn mới | Số đơn tạo trong kỳ | NGAY_TAO |
| K03 | Đơn hoàn thành | Số đơn Hoàn thành | NGAY_HOAN_THANH |
| K04 | Giá trị đơn TB | K01 / K03 | NGAY_HOAN_THANH |
| K12 | Tỷ lệ hủy | Đơn hủy / đơn tạo trong kỳ | NGAY_TAO (cohort) |
| K13 | Tỷ lệ yêu cầu trả/hoàn | Số đơn có yêu cầu / đơn tạo trong kỳ | NGAY_TAO (cohort) |
| K09 | Khách hàng mới | Số khách đăng ký trong kỳ | NGAY_DANG_KY |
| K10 | Sản phẩm đã bán | Σ SO_LUONG của đơn Hoàn thành | NGAY_HOAN_THANH |
| K14 | Lợi nhuận gộp | Doanh thu hàng − giá vốn | NGAY_HOAN_THANH |

Ví dụ: đơn 1.000.000đ đã cọc 300.000đ nhưng chưa giao thì K05 = 300.000đ, K06 tăng 300.000đ, còn K01 = 0.

**Giá vốn (AD60):**
- Ưu tiên giá vốn **thực tế** lấy từ phiếu xuất "Làm hoa theo đơn".
- Nếu chưa có phiếu xuất, dùng **định mức BOM** × giá vốn hiện hành.
- Thiếu BOM hoặc thiếu giá thì ghi **"Chưa đủ dữ liệu"**, không tính là 0. Trang báo cáo hiển thị % độ phủ dữ liệu giá vốn.

## 4. D06: Báo cáo và xuất file

- **Tab báo cáo:** theo thời gian, theo sản phẩm, theo chủ đề/kiểu dáng, theo phương thức thanh toán, lý do hủy, lợi nhuận gộp.
- **Xuất Excel:** 11 sheet (KPI, các tab báo cáo, đơn cần chú ý, lịch giao, đối chiếu).
- **Xuất CSV:** bảng của tab đang mở, có UTF-8 BOM.
- **PDF:** dùng hộp thoại In của trình duyệt, chọn "Lưu dưới dạng PDF" (khổ A4 ngang, đã ẩn sidebar). Cách này giữ đúng font tiếng Việt.

## 5. D07: Thông báo Admin

- **Nơi lưu:** collection `THONG_BAO_ADMIN` (một bản ghi cho mỗi sự kiện, khóa `KHOA_SU_KIEN` unique) và `THONG_BAO_ADMIN_DA_DOC` (trạng thái đã đọc **theo từng nhân viên**).
  - Hai collection này tách khỏi `THONG_BAO` của khách hàng, vì endpoint public đang trả các bản ghi có `KHACH_HANG_ID = null`.
- **Nguồn sự kiện:** bộ quét chạy mỗi 60 giây, có tính idempotent.
  - Sự kiện có trạng thái sẽ tự đóng khi đã xử lý xong.
  - Module khác có thể gọi `emitAdminNotification()`.
- **Nhóm thông báo:** Đơn hàng / Tồn kho / Khiếu nại / Hệ thống. Ma trận sự kiện đầy đủ xem `GET /dashboard/dictionary`.
- **Khi nhấn vào thông báo:** đánh dấu đã đọc cho nhân viên đó rồi mở đúng trang (chi tiết đơn, yêu cầu Sales, hộp thư hỗ trợ, NVL, `?section=doi-soat`…).

## 6. D08: Ảnh hưởng dữ liệu

| Collection | Thay đổi |
|---|---|
| DON_HANG | Thêm `NGAY_HOAN_THANH`, `NGAY_HUY`, `NGAY_CAP_NHAT`: tự ghi khi đổi trạng thái (admin.ts, review.ts). Thêm cờ `*_UOC_TINH` cho dữ liệu cũ được migrate |
| THONG_BAO_ADMIN, THONG_BAO_ADMIN_DA_DOC | Mới |
| BO_DEM_MA | Thêm khóa `sync:admin-notifications` (mốc thời gian lần quét) |

## 7. Tốc độ tải trang Tổng quan

| Lớp | Cách làm |
|---|---|
| Server – bộ dữ liệu | `getDataset()` cache trong bộ nhớ (`services/analytics/cache.ts`). Request đồng thời dùng chung 1 lần đọc. Dữ liệu ≤ 30 giây trả ngay; 30 giây – 5 phút trả bản đang có rồi làm mới ngầm. |
| Server – khối nặng | Giá vốn, cảnh báo kho, đối chiếu cache 60 giây. Các truy vấn trong mỗi khối chạy song song thay vì tuần tự. |
| Server – thông báo | Danh sách thông báo không chờ bộ quét. Bộ quét chạy ngay khi khởi động rồi mỗi 60 giây, ghi bằng 1 lệnh `bulkWrite` và làm nóng cache cho Dashboard. |
| Server – làm mới | Đổi trạng thái đơn (admin) và hoàn thành qua đánh giá sẽ xóa cache. Nút Tải lại gửi `fresh=1` để đọc thẳng DB. |
| Admin | Tổng quan, Báo cáo, Đối chiếu tải song song; khối nào xong hiện khối đó. Quay lại trang hiện ngay số liệu lần trước rồi cập nhật ngầm. Góc phải hiện "Số liệu lúc hh:mm". |

Đo trên dữ liệu mẫu (154 đơn), giả lập độ trễ DB 120 ms/lượt:

| Tình huống | Trước | Sau |
|---|---|---|
| Hiện KPI | ~1,5 s | ~0,01 s (cache nóng) |
| Đủ mọi khối | ~2,2 s (có lúc 6,3 s khi bộ quét chạy) | ~0,26 s |
| Bấm Tải lại (đọc thẳng DB) | – | ~0,9 s |

Biến môi trường: `DASHBOARD_CACHE_SECONDS` (30), `DASHBOARD_CACHE_MAX_STALE_SECONDS` (300), `DASHBOARD_HEAVY_CACHE_SECONDS` (60), `DASHBOARD_HEAVY_MAX_STALE_SECONDS` (600).

## 8. Việc nhóm cần chốt

1. Chưa có dữ liệu shipper nên lịch giao chưa hiển thị người giao.
2. Lý do hủy là văn bản tự do (đang gom theo chuỗi đã chuẩn hóa). Nên đổi sang danh mục cố định.
3. Đơn cũ không có ngày hoàn thành thật thì doanh thu tính theo ngày ước tính. Dashboard có hiện cảnh báo cho trường hợp này.
4. Đơn khách tạo mới / thanh toán từ trang khách chưa xóa cache trực tiếp → Dashboard thấy sau tối đa ~30 giây (hoặc bấm Tải lại).

# Luồng thiết kế 3D → giỏ hàng → đặt hàng

## Quy tắc đã triển khai

- Danh sách 3D lấy từ NVL đang sử dụng và bật `DUNG_CHO_3D`. Không lấy sản phẩm mua kèm làm nguyên liệu.
- Một NVL có nhiều màu trên 3D. Mặc định theo mô hình hiện có (hồng: đỏ/hồng; tulip: hồng/trắng); Admin chọn nhiều màu cho phép. Thiết kế lưu phân bổ từng màu, báo giá và đơn giữ nguyên phân bổ đó. Ví dụ 3 đỏ + 2 hồng cùng mã NVL tính tổng 5 cành vào tồn chung của mã; chưa có tồn riêng từng màu. Thay phân bổ màu cần duyệt mẫu tương ứng.
- Mọi NVL bật 3D đều chọn được trên giao diện, kể cả khi hết khả dụng; trang 3D không hiện tồn kho hay cảnh báo hết/sắp hết cho khách. Thiết kế thiếu NVL vẫn được đánh dấu cần duyệt ở backend nên đi vào yêu cầu đặt hàng để nhân viên xử lý (đổi NVL, chờ hàng về…).
- Giá tạm tính = tổng định lượng × giá bán NVL hiện tại + phí thiết kế và phí bổ sung của mẫu đã được shop duyệt. Mẫu mới chưa có phí chốt nên cần tư vấn; không tự gán biểu phí đề xuất thành giá chính thức.
- “Đặt mẫu này” lưu thiết kế và chi tiết, thêm dòng giỏ hàng có `THIET_KE_3D_ID`. Lưu/thêm giỏ không giữ hoặc xuất kho.
- **Mọi mẫu 3D đều đi `YEU_CAU_DAT_HANG`**, kể cả mẫu shop đã từng duyệt, bất kể lịch giao: nhân viên phải duyệt vì có thể phát sinh phí (thay hoa, phụ kiện, công cắm…). Checkout không tạo QR, không giữ tồn cho mẫu 3D. Nhân viên tiếp nhận, trao đổi, lưu Phương án cuối; khách thanh toán theo phương án qua cổng, Sales nhập đúng số tiền + mã giao dịch rồi chốt thì hệ thống mới tạo đơn.
- Chỉ phương án cùng đúng NVL, định lượng và bố cục gốc, đã được khách chấp nhận và nhân viên chuyển thành đơn, mới được ghi là "mẫu shop đã từng làm" kèm phí thiết kế/phí bổ sung. Việc này chỉ giúp lần sau báo giá có sẵn phí, **không** cho đặt thẳng. Đổi thành phần không duyệt nhầm mẫu ban đầu. Khách tự lưu một mẫu không có nghĩa shop đã duyệt.
- Giao diện: trang 3D và giỏ hàng luôn ghi "Shop duyệt trước khi thanh toán"; giỏ có mẫu 3D đổi nút thành "Tiếp tục gửi yêu cầu".
- Sau khi Sales chốt: đủ NVL thì giữ theo snapshot thiết kế; chờ hàng về thì ghi nhu cầu Chờ giữ theo snapshot với T = giờ giao − 3 giờ, Kho/Admin chỉnh T và giữ theo luồng kho hiện có. Mua nhiều hoặc giỏ hỗn hợp không được bỏ qua kiểm tra thiếu NVL.
- Đơn lưu ảnh, tên, định lượng và phí đã chốt trong snapshot. Không lấy BOM mới để thay nội dung đơn cũ.

## Chuẩn bị dữ liệu để thử

1. Chạy lại backend, client và admin bằng bản code mới.
2. Admin → Nguyên vật liệu → sửa NVL: bật **Dùng cho thiết kế 3D**, nhập giá bán NVL, chọn mô hình và màu tương ứng. Nếu là phụ liệu chưa có mô hình, vẫn tính vào cấu hình/giá và hiển thị nhãn chưa có mô hình minh họa.
3. NVL hoa tươi cần tồn từ PN đã ghi nhận và còn khả dụng. Không gán thử cờ 3D hàng loạt lên dữ liệu thật.

## Kiểm tra bằng giao diện

1. Chọn 2 cành tại trang 3D → xem giá tạm tính → Đặt mẫu này → giỏ hàng. Kiểm tra kho chưa tăng đang giữ.
2. Tiếp tục đặt mẫu mới: nhận mã yêu cầu, chưa có QR. Nhân viên mở Yêu cầu đặt hàng, tiếp nhận và tạo phương án từ thiết kế đã gửi; kiểm tra ảnh, NVL, lượng và phí.
3. Khách mở yêu cầu bằng tài khoản sở hữu hoặc xác thực số điện thoại; đồng ý phương án. Nhân viên lên đơn, kiểm tra số tiền thanh toán đúng báo giá.
4. Tạo lại đúng thành phần mẫu đã từng làm: vẫn nhận mã yêu cầu (không QR), báo giá có sẵn phí thiết kế. Đổi 2 cành thành 3 cành: báo giá không còn phí chốt sẵn.
5. Sau khi Sales chốt đơn: giao hôm nay thấy đang giữ tăng theo snapshot; giao ngày sau không giữ ngay mà có nhu cầu Chờ giữ chờ xếp lịch T.

## Kiểm thử tự động và giới hạn

`tests/design3d.test.ts` chạy bằng `TEST_MONGO_URI` trỏ replica set riêng; tự tạo/xóa database UUID. Kiểm tra lưu không giữ tồn, duyệt sau đồng ý, snapshot, giao hôm nay/ngày sau, xác nhận lặp, chống sửa giá/tổng tiền, giỏ thành viên, QR hết hạn/thử lại và hai khách tranh NVL cuối.

Phần này nối dữ liệu và nghiệp vụ với trình dựng 3D hiện có. Chưa bổ sung kéo từng hoa, tọa độ dựng lại, undo/redo, video hướng dẫn hoặc mô hình mới cho giấy/giỏ. Ảnh minh họa không thay thế việc shop xác nhận khả năng thực hiện. Đây không phải xác nhận đã hoàn thành toàn bộ KH27.

# Luồng thiết kế 3D → giỏ hàng → đặt hàng

## Quy tắc đã triển khai

- Danh sách 3D lấy từ NVL đang sử dụng và bật `DUNG_CHO_3D`. Không lấy sản phẩm mua kèm làm nguyên liệu.
- Một NVL có nhiều màu trên 3D. Mặc định theo mô hình hiện có (hồng: đỏ/hồng; tulip: hồng/trắng); Admin chọn nhiều màu cho phép. Thiết kế lưu phân bổ từng màu, báo giá và đơn giữ nguyên phân bổ đó. Ví dụ 3 đỏ + 2 hồng cùng mã NVL tính tổng 5 cành vào tồn chung của mã; chưa có tồn riêng từng màu. Thay phân bổ màu cần duyệt mẫu tương ứng.
- NVL hết khả dụng không thêm mới được trên giao diện. Còn hàng nhưng dưới ngưỡng vẫn chọn được, có cảnh báo. Chọn vượt lượng khả dụng chuyển sang shop kiểm tra.
- Giá tạm tính = tổng định lượng × giá bán NVL hiện tại + phí thiết kế và phí bổ sung của mẫu đã được shop duyệt. Mẫu mới chưa có phí chốt nên cần tư vấn; không tự gán biểu phí đề xuất thành giá chính thức.
- “Đặt mẫu này” lưu thiết kế và chi tiết, thêm dòng giỏ hàng có `THIET_KE_3D_ID`. Lưu/thêm giỏ không giữ hoặc xuất kho.
- Mẫu mới/chưa được shop duyệt hoặc có cảnh báo → `YEU_CAU_DAT_HANG`, không tạo QR. Nhân viên tiếp nhận, trao đổi, gửi phương án; khách đồng ý đúng phiên bản rồi mới lên đơn/thanh toán.
- Chỉ phương án cùng đúng NVL, định lượng và bố cục gốc, đã được khách chấp nhận và nhân viên chuyển thành đơn, mới duyệt mẫu gốc cho lần đặt sau. Đổi thành phần không duyệt nhầm mẫu ban đầu. Khách tự lưu một mẫu trước đây không có nghĩa shop đã duyệt.
- Mẫu đã duyệt: backend xác nhận lại giá và khả dụng khi checkout. Giao hôm nay giữ NVL trước QR, xác nhận tiền chuyển giữ chính thức. QR hết hạn/thất bại nhả giữ.
- Đơn có thiết kế giao ngày sau không giữ NVL ngay. Chỉ khi tiền được xác nhận mới ghi nhu cầu theo snapshot; Admin tiếp tục xếp lịch T theo luồng kho hiện có. Mua nhiều hoặc giỏ hỗn hợp không được bỏ qua kiểm tra thiếu NVL.
- Đơn lưu ảnh, tên, định lượng và phí đã chốt trong snapshot. Không lấy BOM mới để thay nội dung đơn cũ.

## Chuẩn bị dữ liệu để thử

1. Chạy lại backend, client và admin bằng bản code mới.
2. Admin → Nguyên vật liệu → sửa NVL: bật **Dùng cho thiết kế 3D**, nhập giá bán NVL, chọn mô hình và màu tương ứng. Nếu là phụ liệu chưa có mô hình, vẫn tính vào cấu hình/giá và hiển thị nhãn chưa có mô hình minh họa.
3. NVL hoa tươi cần tồn từ PN đã ghi nhận và còn khả dụng. Không gán thử cờ 3D hàng loạt lên dữ liệu thật.

## Kiểm tra bằng giao diện

1. Chọn 2 cành tại trang 3D → xem giá tạm tính → Đặt mẫu này → giỏ hàng. Kiểm tra kho chưa tăng đang giữ.
2. Tiếp tục đặt mẫu mới: nhận mã yêu cầu, chưa có QR. Nhân viên mở Yêu cầu đặt hàng, tiếp nhận và tạo phương án từ thiết kế đã gửi; kiểm tra ảnh, NVL, lượng và phí.
3. Khách mở yêu cầu bằng tài khoản sở hữu hoặc xác thực số điện thoại; đồng ý phương án. Nhân viên lên đơn, kiểm tra số tiền thanh toán đúng báo giá.
4. Tạo lại đúng thành phần mẫu đã duyệt: được đi tiếp thanh toán nếu đủ NVL. Đổi 2 cành thành 3 cành: cần shop duyệt lại.
5. Với giao hôm nay, xem đang giữ tăng khi QR được tạo; thử để QR hết hạn. Với giao ngày sau, xem không giữ ngay; xác nhận tiền rồi mới thấy nhu cầu chờ xếp lịch T.

## Kiểm thử tự động và giới hạn

`tests/design3d.test.ts` chạy bằng `TEST_MONGO_URI` trỏ replica set riêng; tự tạo/xóa database UUID. Kiểm tra lưu không giữ tồn, duyệt sau đồng ý, snapshot, giao hôm nay/ngày sau, xác nhận lặp, chống sửa giá/tổng tiền, giỏ thành viên, QR hết hạn/thử lại và hai khách tranh NVL cuối.

Phần này nối dữ liệu và nghiệp vụ với trình dựng 3D hiện có. Chưa bổ sung kéo từng hoa, tọa độ dựng lại, undo/redo, video hướng dẫn hoặc mô hình mới cho giấy/giỏ. Ảnh minh họa không thay thế việc shop xác nhận khả năng thực hiện. Đây không phải xác nhận đã hoàn thành toàn bộ KH27.

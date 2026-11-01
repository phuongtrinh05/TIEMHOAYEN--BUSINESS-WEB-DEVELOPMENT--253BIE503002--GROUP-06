# Vòng quay may mắn — hướng dẫn chạy và kiểm thử

## Mở chức năng

- Khách hàng: http://localhost:4200/lucky-wheel
- Admin: http://localhost:4300/promotions/lucky-wheel (trong Khuyến mãi).
- Chạy lại backend sau khi lấy code mới. Admin cần đăng xuất rồi đăng nhập lại để nhận phiên quản trị được xác thực phía server.
- Chưa tự bật chương trình trên dữ liệu thật. Admin tạo chương trình nháp, chọn NVL cho giải quà tặng, kiểm tra tỷ lệ 7 ô tổng 100%, lịch và hạn mức rồi lưu trạng thái Đang diễn ra / Đã lên lịch.
- Ô Không trúng luôn bật và có tỷ lệ. Hạn mức trống: không giới hạn; 0: không phát giải. Ngày/tháng tính theo giờ Việt Nam.

## Luồng khách hàng

1. Đăng nhập thành viên. Đơn có giá trị sản phẩm sau giảm trực tiếp, trước voucher, không gồm ship đạt ngưỡng (mặc định 200.000đ).
2. Chỉ khi thanh toán/cọc đã được backend xác nhận mới cấp một lượt cho đơn. Đăng ký/đăng nhập không tự cấp lượt. Nhiều lần xác nhận không cấp trùng.
3. Quay tại trang Vòng quay. Backend chọn giải, kiểm tra hạn mức trong transaction và lưu kết quả. Gửi lại cùng lượt trả kết quả đã lưu.
4. Giải vào kho thưởng ở trạng thái Chờ kích hoạt. Đơn gốc Hoàn thành mới kích hoạt, mặc định hạn 30 ngày từ thời điểm hoàn thành.
5. Đơn mới tạo sau khi kích hoạt, đạt 150.000đ tiền sản phẩm, có thể chọn thưởng trong phần Ưu đãi vòng quay ở thanh toán. Không ghép voucher khác; tối đa một thưởng cho đơn.
6. Thưởng được giữ cùng phiên thanh toán. Thanh toán thành công chuyển Đã dùng; thất bại/hết hạn nhả; đơn dùng thưởng bị hủy khôi phục thưởng còn hạn với hạn cũ.

## Quà tặng và kho

- Quà gắn NVL thật và định lượng trong cấu hình giải, được thêm thành dòng riêng giá 0 với BOM snapshot.
- Đơn giao ngay giữ quà theo nguồn kho; đơn tương lai đi theo nhu cầu và giữ theo lịch như các dòng NVL khác.
- Giữ quà được gắn mã thưởng để thu hồi không nhả nhầm nguyên liệu khác.
- Hủy đơn gốc thu hồi quyền lợi chưa dùng. Quà đã xuất/giao không tự cộng lại tồn: đánh dấu cần đối soát cho Admin.
- Giá vốn quà đã giao lấy từ chi tiết PX đã ghi nhận; trường giá vốn dự kiến trong cấu hình không thay thế giá vốn kho thực tế.

## Hoàn thành đơn từ Atlas

Giữ nguyên trigger của nhóm: đang test 1 phút, dự kiến thực tế 4 tiếng; module này không sửa thời gian trigger.
Backend theo dõi change stream và lưu resume token, đồng thời đối soát định kỳ 30 giây. Việc đổi trạng thái trực tiếp trong Atlas vẫn được nhận khi backend chạy.
Nên để trigger ghi NGAY_HOAN_THANH cùng lúc đổi trạng thái. Nếu không có dấu thời gian và không phục hồi được sự kiện Atlas cũ, hệ thống chỉ biết thời điểm lần đầu quan sát Hoàn thành; không suy ra chính xác thời điểm hoàn thành khi backend đã ngừng quá lâu.

## Cấu hình và thống kê

- Tạm dừng chặn cấp/quay; hạn lượt chưa dùng được cộng thời gian tạm dừng. Kết thúc ngừng cấp mới nhưng lượt cũ còn hạn vẫn dùng được.
- Lượt lưu phiên bản, cơ cấu và điều kiện tại lúc cấp; sửa cấu hình không đổi quyền lợi đã cấp. Kết quả lưu trọng số thực tế sau khi loại giải hết hạn mức.
- Thống kê tính từ ngày bắt đầu sớm nhất của các chương trình đã công bố đến hiện tại; đơn thành viên đã thanh toán, loại đơn hủy. Tỷ lệ quay = kết quả / lượt cấp; sử dụng voucher = đã dùng / đã kích hoạt, không gồm quà.
- Mua lại = khách có thưởng kích hoạt và có đơn trả tiền mới trong 30 ngày sau lần kích hoạt đầu / khách đã kích hoạt thưởng. Đây là tỷ lệ quan sát, có cả khách chưa đủ 30 ngày.
- Chi phí = ưu đãi đã dùng + giá vốn quà đã giao. Giá trị đơn trung bình và tỷ lệ chi phí dùng tổng tiền đơn, không phải báo cáo thực thu kế toán.
- Lỗi kỹ thuật = yêu cầu quay lỗi server / tổng yêu cầu quay của thành viên; lỗi điều kiện 4xx không tính lỗi kỹ thuật.
- Lịch sử quay lọc khách/đơn/giải/ngày; thưởng và nhật ký phân trang. Thu hồi thủ công cần lý do; thưởng đang giữ/đã dùng cần đối soát đơn trước.

## Kiểm thử tự động

Chỉ dùng MongoDB replica set kiểm thử riêng với TEST_MONGO_URI, không chạy trên database thật. Test tạo database riêng và xóa sau chạy.

```powershell
$env:TEST_MONGO_URI='mongodb://127.0.0.1:27184/?replicaSet=yenAudit'
node node_modules/tsx/dist/cli.mjs --test tests/lucky-wheel.test.ts
```

Các ca chính: thành viên/khách vãng lai, ngưỡng trước voucher, cọc đủ, đồng thời quay, giải cuối cùng, phiên bản thể lệ, tạm dừng/kết thúc, hoàn thành/kích hoạt/hết hạn, tranh chấp dùng thưởng, rollback, hủy/khôi phục, quà giữ riêng, quyền API và chống sửa giá khi checkout.

## Các bảng mới

VQ_CHUONG_TRINH, VQ_LUOT_QUAY, VQ_KET_QUA, VQ_PHAN_THUONG, VQ_HAN_MUC, VQ_NHAT_KY, VQ_THONG_BAO, VQ_YEU_CAU_QUAY, VQ_DONG_BO_META; PHIEN_DANG_NHAP_ADMIN lưu hash phiên quản trị có hạn và TTL. DON_HANG / chi tiết / GIU_TON bổ sung liên kết thưởng, giá trị sản phẩm chốt và snapshot quà.

## Giao diện sau thanh toán

Đơn thành viên đủ điều kiện có lượt sẽ tự mở vòng quay ngay trên checkout, không tự quay. Khách đóng bằng Để sau hoặc dấu X; banner Quay ngay còn ở checkout để mở lại. Ghi nhớ Để sau theo đơn trong phiên trình duyệt để tải lại không tự bật tiếp. Đóng popup kết quả thanh toán không điều hướng về trang chủ; chỉ các nút Xem đơn/Tiếp tục mua sắm mới điều hướng theo lựa chọn.

Mã thưởng dạng YEN-xxxxxxxxxxxx có thể nhập tại ô Voucher hoặc chọn trong Ưu đãi vòng quay. Backend kiểm tra mã thuộc đúng thành viên, đối soát trạng thái đơn gốc rồi báo rõ chờ kích hoạt/đã dùng/đang giữ/hết hạn/thu hồi. Chỉ thưởng còn hiệu lực và đơn mới đủ điều kiện mới được áp dụng. Nút tải lại ở Ưu đãi vòng quay cập nhật sau khi đơn gốc vừa hoàn thành.

Popup checkout có lượt được gộp: tiêu đề xác nhận thanh toán + mã đơn, vòng quay và hai nút Xem đơn hàng / Tiếp tục mua sắm. Kết quả quay hiển thị ngay trong popup này, không có lớp kết quả thứ hai. Chọn đi tiếp hoặc đóng trước khi quay giữ nguyên lượt; đóng sau khi đã gửi yêu cầu quay không hủy kết quả đã lưu ở backend. Đơn không có lượt vẫn hiện popup thanh toán thông thường.

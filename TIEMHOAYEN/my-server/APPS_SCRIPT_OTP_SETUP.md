# Gửi OTP bằng Gmail của shop qua Apps Script

1. Đăng nhập script.google.com bằng Gmail shop, tạo project riêng. Dán nội dung `scripts/apps-script-otp/Code.gs` vào Code.gs.
2. Trong Project Settings > Script properties, đặt `OTP_SHARED_SECRET` là khóa ngẫu nhiên tối thiểu 32 ký tự. Lưu cùng khóa trong biến môi trường backend `APPS_SCRIPT_OTP_SECRET`; không đưa khóa vào Git hoặc frontend.
3. Chạy `authorizeMail` và tự cấp quyền gửi email. Hàm này không gửi thư. Nếu Google chặn tài khoản/ứng dụng, dừng và xử lý hạn chế đó qua hỗ trợ Google.
4. Deploy > New deployment > Web app: Execute as Me (Gmail shop); Who has access: Anyone. Chỉ triển khai sau khi kiểm tra script xác thực chữ ký. URL công khai nhưng yêu cầu gửi email phải có chữ ký HMAC hợp lệ từ backend.
5. Lưu URL kết thúc `/exec` vào `APPS_SCRIPT_OTP_URL` trên backend local/Render. Script trả JSON `ok:true` khi Google chấp nhận gửi; không đồng nghĩa thư đã vào inbox.
6. Thử gửi một OTP đến email shop, kiểm tra inbox/spam; sau đó mới bật trên bản đang chạy. Không cần đổi tên trường hoặc cấu trúc database.

Nhánh Apps Script ưu tiên hơn Gmail OAuth nếu có APPS_SCRIPT_OTP_URL. Khi lỗi gửi không tự hạ xuống terminal cho tài khoản đã có email. Khách chưa có email vẫn dùng terminal theo logic hiện tại. Hiệu lực/5 lần sai/mã mới nhất vẫn kiểm tra tại backend.

Hạn mức Gmail cá nhân: 100 người nhận/ngày (Google có thể thay đổi). Yêu cầu ký có thời gian tối đa 30 giây và chống lặp bằng cache; không tự retry khi kết quả gửi không rõ ràng. Khi sửa script phải cập nhật deployment version.

Tài liệu: https://developers.google.com/apps-script/guides/web
https://developers.google.com/apps-script/guides/services/quotas

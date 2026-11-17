# Apps Script gửi email Marketing

1. Mở dự án Google Apps Script thuộc Gmail của Tiệm Hoa Yên.
2. Dán toàn bộ `Code.gs` vào dự án.
3. Vào **Project Settings > Script properties**, tạo `MARKETING_SHARED_SECRET` với chuỗi ngẫu nhiên tối thiểu 32 ký tự.
4. Chạy `authorizeMarketingMail` một lần và cấp quyền gửi email.
5. Chọn **Deploy > Manage deployments > Edit/New deployment > Web app**.
6. Chọn **Execute as: Me** và quyền truy cập phù hợp để backend Render gọi được Web App.
7. Trên Render đặt cùng secret vào `APPS_SCRIPT_MARKETING_SECRET`, đồng thời đặt một trong hai biến:
   - `APPS_SCRIPT_MARKETING_URL=https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`
   - hoặc `APPS_SCRIPT_MARKETING_DEPLOYMENT_ID=<DEPLOYMENT_ID>`

Không dùng Deployment ID làm secret và không commit secret thật vào Git.

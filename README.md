# Tiệm Hoa Yên

Tiệm Hoa Yên là hệ thống thương mại điện tử chuyên kinh doanh hoa tươi, quà tặng và phụ kiện. Dự án gồm website dành cho khách hàng, trang quản trị nội bộ và REST API kết nối Microsoft SQL Server.

Website hỗ trợ toàn bộ quy trình từ xem sản phẩm, tìm kiếm, thiết kế bó hoa 3D, đặt hàng, thanh toán, theo dõi đơn, đánh giá sản phẩm đến quản lý sản phẩm, khách hàng, kho, khuyến mãi và nội dung ở phía quản trị.

## Liên kết website

- Website Tiệm Hoa Yên: <a href="https://tiemhoayen.vercel.app/" target="_blank" rel="noopener noreferrer">https://tiemhoayen.vercel.app/</a>
- Trang quản trị: <a href="https://tiemhoayen-admin.vercel.app/" target="_blank" rel="noopener noreferrer">https://tiemhoayen-admin.vercel.app/</a>

## Thành phần hệ thống

| Thành phần | Thư mục | Công nghệ chính | Cổng mặc định |
| --- | --- | --- | --- |
| Website khách hàng | `TIEMHOAYEN/my-client` | Angular 22, Bootstrap, Three.js | `4200` |
| Trang quản trị | `TIEMHOAYEN/my-admin` | Angular 22, Chart.js, TinyMCE, jsPDF, XLSX | `4300` |
| Backend API | `TIEMHOAYEN/my-server` | Node.js, Express, TypeScript, SQL Server | `3000` |

## Tính năng chính

### Website khách hàng

- Trang chủ, giới thiệu, liên hệ, blog và hệ thống chính sách.
- Danh mục sản phẩm theo chủ đề, đối tượng, kiểu dáng, loại hoa, màu sắc và bộ sưu tập.
- Tìm kiếm sản phẩm, xem chi tiết và gợi ý sản phẩm liên quan.
- Wishlist, giỏ hàng và gợi ý sản phẩm mua kèm.
- Đặt hàng cho khách vãng lai hoặc thành viên.
- Thanh toán, voucher, điểm thưởng và hạng thành viên.
- Theo dõi trạng thái và tra cứu chi tiết đơn hàng.
- Yêu cầu hoàn tiền/trả hàng theo trạng thái đơn.
- Đánh giá đơn hàng một lần sau khi giao thành công hoặc hoàn thành.
- Quản lý hồ sơ, địa chỉ, đơn hàng, voucher và điểm thưởng.
- Đăng ký, đăng nhập, ghi nhớ đăng nhập và quên mật khẩu bằng OTP.
- Thiết kế bó hoa 3D bằng Three.js.
- Chatbot hỗ trợ khách hàng và tạo hình ảnh qua workflow n8n.
- Giao diện responsive cho desktop, tablet và mobile.

### Trang quản trị

- Dashboard và thống kê hoạt động kinh doanh.
- Quản lý sản phẩm, danh mục, hình ảnh và chi tiết sản phẩm.
- Quản lý đơn hàng, tạo đơn và cập nhật trạng thái.
- Quản lý giao dịch và thanh toán.
- Quản lý khách hàng và thông tin chi tiết khách hàng.
- Quản lý nguyên vật liệu, nhà cung cấp, phiếu nhập và phiếu xuất.
- Quản lý chiến dịch, voucher và khuyến mãi.
- Quản lý bài viết, nội dung và blog.
- Chăm sóc khách hàng, chat và quản lý chatbot.
- Quản lý tài khoản quản trị, vai trò và phân quyền.
- Xuất báo cáo PDF/Excel và hiển thị biểu đồ.

### Backend API

- Xác thực khách hàng và nhân viên.
- CRUD sản phẩm, danh mục, thuộc tính và hình ảnh.
- Giỏ hàng, wishlist, voucher và đơn hàng.
- Thanh toán, giao hàng, đánh giá và thông báo.
- Quản lý kho, nhà cung cấp, nhập/xuất nguyên vật liệu.
- Blog, liên hệ, FAQ, chat và yêu cầu tạo ảnh.
- API quản trị, thống kê và phân quyền.

## Cấu trúc thư mục

```text
.
├── README.md
├── render.yaml                 # Cấu hình triển khai backend trên Render
└── TIEMHOAYEN
    ├── my-client               # Website dành cho khách hàng
    │   ├── public
    │   ├── src
    │   │   ├── app
    │   │   │   ├── components # Header, footer, chatbot và component dùng chung
    │   │   │   ├── pages      # Các trang nghiệp vụ của khách hàng
    │   │   │   └── services   # Service gọi API và quản lý dữ liệu
    │   │   └── assets          # Hình ảnh, video, font và dữ liệu tĩnh
    │   ├── angular.json
    │   └── package.json
    ├── my-admin                # Trang quản trị
    │   ├── public
    │   ├── src
    │   │   ├── app
    │   │   │   ├── components # Layout, sidebar và component dùng chung
    │   │   │   ├── pages      # Các màn hình quản trị
    │   │   │   └── services   # Service kết nối API quản trị
    │   │   └── assets
    │   ├── angular.json
    │   └── package.json
    └── my-server               # REST API
        ├── controllers         # Xử lý request và nghiệp vụ
        ├── middleware          # Middleware của Express
        ├── routes              # Khai báo endpoint
        ├── services            # Nghiệp vụ dùng chung
        ├── uploads             # File được tải lên server
        ├── utils               # Tiện ích, mã hóa mật khẩu
        ├── .env.example        # Mẫu biến môi trường
        ├── db.ts               # Kết nối SQL Server
        ├── server.ts           # Điểm khởi động backend
        └── package.json
```

## Công nghệ sử dụng

### Frontend

- Angular 22 và TypeScript.
- Angular Router, Forms và HttpClient.
- Bootstrap 5 và Bootstrap Icons.
- RxJS.
- Three.js cho thiết kế hoa 3D.
- Chart.js/ng2-charts cho biểu đồ quản trị.
- TinyMCE cho trình soạn thảo nội dung.
- jsPDF, jsPDF-AutoTable và XLSX cho xuất báo cáo.

### Backend

- Node.js và Express.
- TypeScript chạy bằng `tsx`.
- Microsoft SQL Server qua thư viện `mssql`.
- `bcryptjs` để băm và kiểm tra mật khẩu.
- `multer` để xử lý file tải lên.
- CORS và Axios.

### Triển khai

- Client/Admin: Vercel.
- Backend: Render.
- Database: Microsoft SQL Server/Azure SQL.

## Yêu cầu môi trường

- Node.js 22 trở lên.
- npm 11 hoặc phiên bản tương thích.
- Microsoft SQL Server hoặc Azure SQL Database.
- Git.

Kiểm tra phiên bản:

```bash
node --version
npm --version
git --version
```

## Cài đặt dự án

Clone repository:

```bash
git clone https://github.com/phuongtrinh05/TIEMHOAYEN--BUSINESS-WEB-DEVELOPMENT--253BIE503002--GROUP-06.git
cd TIEMHOAYEN--BUSINESS-WEB-DEVELOPMENT--253BIE503002--GROUP-06
```

Cài dependency cho từng ứng dụng:

```bash
cd TIEMHOAYEN/my-server
npm install

cd ../my-client
npm install

cd ../my-admin
npm install
```

## Cấu hình backend

Sao chép file môi trường mẫu:

```powershell
cd TIEMHOAYEN/my-server
Copy-Item .env.example .env
```

Nội dung `.env`:

```env
PORT=3000
SQL_USER=
SQL_PASSWORD=
SQL_SERVER=tiemhoayenadmin.database.windows.net
SQL_PORT=1433
SQL_DATABASE=TIEM_HOA_YEN
CORS_ORIGINS=http://localhost:4200,http://localhost:4300
PUBLIC_BASE_URL=http://localhost:3000
PASSWORD_HASH_ROUNDS=12
```

Ý nghĩa các biến:

| Biến | Mô tả |
| --- | --- |
| `PORT` | Cổng chạy backend |
| `SQL_USER` | Tài khoản SQL Server |
| `SQL_PASSWORD` | Mật khẩu SQL Server |
| `SQL_SERVER` | Host của SQL Server/Azure SQL |
| `SQL_PORT` | Cổng SQL Server, mặc định `1433` |
| `SQL_DATABASE` | Tên cơ sở dữ liệu |
| `CORS_ORIGINS` | Danh sách origin được phép, phân cách bằng dấu phẩy |
| `PUBLIC_BASE_URL` | URL public của backend, dùng cho file upload |
| `PASSWORD_HASH_ROUNDS` | Số vòng băm mật khẩu bằng bcrypt |

## Chạy dự án ở môi trường phát triển

Mở ba terminal riêng.

### 1. Backend

```bash
cd TIEMHOAYEN/my-server
npm start
```

Backend chạy tại `http://localhost:3000`.

Kiểm tra health check:

```text
http://localhost:3000/health
```

### 2. Website khách hàng

```bash
cd TIEMHOAYEN/my-client
npm start
```

Client chạy tại `http://localhost:4200`.

### 3. Trang quản trị

```bash
cd TIEMHOAYEN/my-admin
npm start
```

Admin chạy tại `http://localhost:4300`.

## Build và kiểm tra

Build client:

```bash
cd TIEMHOAYEN/my-client
npm run build
```

Build admin:

```bash
cd TIEMHOAYEN/my-admin
npm run build
```

Kiểm tra TypeScript frontend:

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Kiểm tra TypeScript backend:

```bash
cd TIEMHOAYEN/my-server
npx tsc --noEmit
```

Chạy test Angular:

```bash
npm test
```

## API chính

Base URL local:

```text
http://localhost:3000/api
```

Một số nhóm endpoint chính:

| Endpoint | Chức năng |
| --- | --- |
| `/api/customers` | Khách hàng, đăng ký, đăng nhập và OTP |
| `/api/employees` | Nhân viên và tài khoản quản trị |
| `/api/products` | Sản phẩm và chi tiết sản phẩm |
| `/api/categories` | Danh mục sản phẩm |
| `/api/category-products` | Lọc sản phẩm theo thuộc tính |
| `/api/cart` | Giỏ hàng |
| `/api/wishlists` | Sản phẩm yêu thích |
| `/api/orders` | Đặt hàng, trạng thái và chi tiết đơn |
| `/api/payments` | Thanh toán và giao dịch |
| `/api/vouchers` | Voucher và khuyến mãi |
| `/api/reviews` | Đánh giá sản phẩm/đơn hàng |
| `/api/notifications` | Thông báo khách hàng |
| `/api/blogs` | Bài viết và blog |
| `/api/chat` | Chat hỗ trợ khách hàng |
| `/api/image-requests` | Yêu cầu tạo hình ảnh |
| `/api/admin` | Nghiệp vụ quản trị và phân quyền |

Xem đầy đủ route trong `TIEMHOAYEN/my-server/routes` và file `server.ts`.

## Luồng nghiệp vụ đáng chú ý

### Đăng nhập

- Có thể chọn ghi nhớ đăng nhập.
- Khi ghi nhớ, số điện thoại được điền lại và phiên được duy trì.
- Mật khẩu không được lưu trực tiếp trong localStorage.

### Đơn hàng và đánh giá

- Đơn ở trạng thái giao hàng thành công cho phép khách chọn đánh giá hoặc yêu cầu hoàn tiền/trả hàng.
- Mỗi đơn chỉ được đánh giá một lần.
- Sau khi đánh giá thành công, đơn chuyển sang hoàn thành.
- Đơn đã yêu cầu hoàn tiền/trả hàng không được đánh giá.

### Thông báo

- Header tải thông báo từ backend.
- Client kiểm tra thông báo mới định kỳ khi tab đang hoạt động.
- Trạng thái đã đọc được đồng bộ với API.

## Triển khai

### Backend trên Render

Repository đã có `render.yaml` tại thư mục gốc:

- Root directory: `TIEMHOAYEN/my-server`.
- Build command: `npm ci`.
- Start command: `npm start`.
- Health check: `/health`.

Khai báo các biến môi trường SQL, CORS và public URL trong Render Dashboard. Không đưa giá trị bí mật trực tiếp vào `render.yaml`.

### Frontend trên Vercel

Tạo project riêng cho client và admin nếu triển khai cả hai:

| Ứng dụng | Root Directory | Build Command | Output Directory |
| --- | --- | --- | --- |
| Client | `TIEMHOAYEN/my-client` | `npm run build` | Theo output trong `angular.json` |
| Admin | `TIEMHOAYEN/my-admin` | `npm run build` | Theo output trong `angular.json` |

Sau khi push lên nhánh production, Vercel và Render sẽ tự triển khai nếu repository đã được kết nối và bật auto-deploy.

## Quy ước làm việc với Git

Kiểm tra thay đổi:

```bash
git status
git diff
```

Commit thay đổi:

```bash
git add <duong-dan-file>
git commit -m "mo ta ngan gon thay doi"
git push origin main
```

Khuyến nghị:

- Không dùng `git add .` khi thư mục có thay đổi không liên quan.
- Không commit `node_modules`, `.env`, file build hoặc thông tin bí mật.
- Chạy kiểm tra TypeScript/build trước khi push.
- Viết commit message ngắn gọn, mô tả đúng phạm vi thay đổi.

## Xử lý lỗi thường gặp

### Backend không kết nối được database

- Kiểm tra các biến `SQL_USER`, `SQL_PASSWORD`, `SQL_SERVER` và `SQL_DATABASE`.
- Kiểm tra firewall của Azure SQL đã cho phép địa chỉ IP hiện tại.
- Kiểm tra cổng `1433` và kết nối mạng.

### Client gọi API bị lỗi CORS

- Thêm URL client/admin vào `CORS_ORIGINS`.
- Các origin được phân cách bằng dấu phẩy và không có dấu `/` cuối.

### Vercel mở route trực tiếp bị 404

- Kiểm tra cấu hình rewrite SPA/SSR của project.
- Đảm bảo Root Directory và Output Directory trỏ đúng ứng dụng Angular.

### Render phản hồi chậm lần đầu

Gói miễn phí có thể đưa service vào trạng thái ngủ. Request đầu tiên sau thời gian không hoạt động thường mất thêm thời gian để khởi động.

## Bảo mật

- Không lưu mật khẩu dạng văn bản thuần ở client hoặc database.
- Luôn băm mật khẩu bằng bcrypt trước khi lưu.
- Không commit `.env`, token, khóa API hoặc chuỗi kết nối.
- Kiểm tra quyền sở hữu khách hàng trước khi trả dữ liệu đơn hàng.
- Giới hạn loại file, dung lượng file upload và kiểm tra dữ liệu đầu vào.
- Chỉ cho phép các origin cần thiết ở môi trường production.

## Đóng góp

1. Tạo branch mới từ nhánh chính.
2. Thực hiện thay đổi trong đúng ứng dụng.
3. Chạy build, TypeScript check và test liên quan.
4. Commit với nội dung rõ ràng.
5. Push branch và tạo pull request để review.

## Nhóm phát triển

Dự án được xây dựng cho môn **Business Web Development** bởi nhóm phát triển Tiệm Hoa Yên.

## Giấy phép

Dự án phục vụ mục đích học tập. Vui lòng liên hệ nhóm phát triển trước khi sử dụng mã nguồn cho mục đích thương mại.

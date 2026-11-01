# Đối chiếu kho – NCC – BOM ngày 01/11/2026

> Bảng điểm 75% bên dưới là kết quả TRƯỚC lượt sửa tiếp theo. Xem cập nhật cuối file; không dùng nó để suy ra tỷ lệ nghiệm thu sau sửa.

Phạm vi: D01/D02 và 14 mục kho–NCC–BOM trong bảng “Kết quả phân tích D04” đã dán trong chat. Không tính dòng duyệt thiết kế 3D, không chấm toàn bộ 5 giai đoạn của dự án. Không có workbook sheet gốc trong các file đính kèm hiện truy cập được; báo cáo dùng nội dung D04 đã dán, không khẳng định đã kiểm từng ô của sheet khác.

Đây là ước lượng mức bao phủ yêu cầu, không phải tỷ lệ hết lỗi hay chứng nhận nghiệm thu. Chấm mỗi mục đạt = 1, một phần = 0,5: 7 đạt + 7 một phần trên 14 mục = 75%. Các mục có nội dung giao nhau; điểm dùng để theo dõi tiến độ, không đo mức rủi ro.

## Đối chiếu từng mục D04

| Mục | Yêu cầu | Kết quả | Còn thiếu / giới hạn |
|---|---|---|---|
| 1 | Tổng quan 3 tầng: NVL, số bó, nhu cầu đơn trả tiền theo T; PO đang giao và phần còn chờ | Một phần | Đã có đủ 3 tầng, không tự đặt PO. API lập nhu cầu thủ công chưa tự kiểm điều kiện đã nhận tiền; dữ liệu không hợp lệ có thể lọt vào dự báo. |
| 2 | Phân nhóm NVL, tồn thực/giữ/không đạt/khả dụng, nguồn PN và FIFO | Một phần | Công thức và nguồn đã có; phân bổ có lỗi nguồn ưu tiên trùng. Nhóm đã chốt luôn FIFO; không cho chọn nguồn ưu tiên. |
| 3 | Thêm danh mục NVL, không cộng tồn trực tiếp, kiểm mã/tên/ĐVT | Đạt | Trong các luồng đã kiểm tra. |
| 4 | Sửa danh mục có audit; NVL đã dùng chỉ ẩn; đổi ĐVT có kiểm soát | Một phần | Đang chỉ chặn đổi ĐVT khi TON_THUC > 0. Khi tồn bằng 0 nhưng có lịch sử/BOM vẫn có thể đổi mà không có quy đổi. |
| 5 | Danh sách PN lọc trạng thái/loại/NCC/ngày/người; PN độc lập PO; ghi một lần | Đạt | Đã bổ sung ngày nhận, người lập/xác nhận; không bắt buộc PO. |
| 6 | PN thực nhận: đạt + không đạt = thực nhận; mỗi NVL một dòng; chỉ đạt vào tồn | Đạt | Có NCC cho nhập mua và giá vốn phân bổ theo chính sách lượng đạt. |
| 7 | PN Nháp được sửa; Posted chỉ xem, sai có chứng từ điều chỉnh/đảo liên kết | Một phần | Có điều chỉnh tồn, đảo PN theo PO và đảo nhập hoàn. Chưa sửa trọn số nhận/PO/tiền khi PN đã có điều chỉnh hoặc nguồn đã dùng/giữ; hiện chặn trường hợp không an toàn. |
| 8 | PX theo loại; Nháp không trừ; Posted trừ một lần; giao không xuất NVL lại | Đạt | Trong các luồng đã kiểm tra; điều chỉnh sau Posted xem mục 10. |
| 9 | Xuất thực lấy x, kết thúc giữ n; x<n nhả dư, x>n kiểm phần bổ sung; FIFO | Một phần | Đã sửa bỏ sót NVL giữ và kiểm phần bổ sung. Lỗi trùng nguồn ưu tiên có thể gây phân bổ sai rồi transaction thất bại. |
| 10 | PX Posted chỉ xem; sai điều chỉnh/đảo, không tự hoàn khi hủy sau xuất | Một phần | Đảo PX độc lập đã có. PX gắn đơn và PX cắm bó sẵn vẫn chặn; chưa xử lý đồng bộ đơn/giữ/thành phẩm. |
| 11 | NCC dùng chung cho PO/PN; có giao dịch chỉ ẩn/ngừng hoạt động | Đạt | Không tự thay đổi tồn khi thêm/sửa NCC. |
| 12 | Thêm NCC, kiểm trùng hợp lý, không tự tạo PO/PN | Đạt | Có kiểm tên/mã số thuế khi tạo. |
| 13 | Sửa NCC giữ định danh và lưu người/thời gian; lịch sử giữ được nguồn | Đạt | Chưa xem đây là nghiệm thu toàn bộ validation liên hệ. |
| 15 | BOM một bó, phiên bản, thay thế cùng nhóm, không hao hụt riêng, giữ snapshot | Một phần | Danh mục/phiên bản/công tắc thay thế có. Một số API kho vẫn đọc BOM hiện hành khi tạo nhu cầu/gợi ý xuất thay vì snapshot đã chốt trên đơn. |

## Các điểm lệch hoặc thiếu ràng buộc so với tài liệu

### 1. Thời hạn giữ tạm mặc định còn 15 phút, tài liệu mới là 5 phút
- D01 cập nhật 22/10 và D04 yêu cầu QR/giữ tạm 5 phút.
- `services/inventory/constants.ts:16` mặc định `INVENTORY_HOLD_MINUTES = 15`.
- Không thấy biến này trong .env repo được đọc. Tiến trình có thể có biến môi trường riêng nên chưa kết luận runtime đang dùng bao nhiêu.
- Cần đồng bộ backend, thời hạn thanh toán và đếm ngược client theo quy tắc đã chốt.

### 2. Đổi đơn vị sau khi tồn về 0 chưa bảo vệ lịch sử/BOM
- `services/inventory/master-data.service.ts` → `updateMaterial` chỉ kiểm TON_THUC > 0.
- Ví dụ NVL trước đây dùng “cành”, đã xuất hết; đổi thành “bó” vẫn có thể lọt qua, dù dữ liệu trước đó và BOM còn mang định lượng cũ.
- Cần kiểm giao dịch/BOM, chặn đổi hoặc có quy đổi được kiểm soát.

### 3. Nguồn ưu tiên bị trùng khi phân bổ FIFO
- `services/inventory/stock.service.ts` → `allocateFifo` chưa loại trùng `preferred`.
- Đã tái hiện hàm thật: PN_A còn 5, PN_B còn 5; cần 7; preferred=[PN_A, PN_A] → phân bổ PN_A 5 + PN_A 2, báo missing=0 thay vì PN_A 5 + PN_B 2.
- Khi ghi kho, ràng buộc nguồn và transaction có thể chặn âm và rollback. Chưa có bằng chứng bán vượt tồn từ ca này, nhưng có thể chặn nhầm phiếu xuất hợp lệ.
- Chưa sửa trong lượt rà soát này.

### 4. Một số đường API kho chưa luôn dùng snapshot đã chốt
- `recordOrderDemand` đọc `getActiveBom` từ sản phẩm.
- `suggestExportLines` khi không có giữ/nhu cầu cũng quay về BOM hiện hành.
- `reserveOrderLines` có xử lý snapshot cho bó custom, nhưng nhánh catalog vẫn gọi `reserveProducts` theo sản phẩm hiện tại.
- Vì vậy chưa thể khẳng định đổi BOM chuẩn không ảnh hưởng mọi đơn cũ ở mọi đường gọi.
- Cần kiểm và nối nhất quán snapshot giữa đơn, thanh toán, nhu cầu T và gợi ý PX.

### 5. API lập nhu cầu thủ công chưa tự bắt buộc đơn đã nhận tiền
- `recordOrderDemand` kiểm đơn tồn tại nhưng chưa kiểm trạng thái thanh toán trước khi tạo nhu cầu.
- Dashboard dự báo dùng các dòng nhu cầu đang chờ, không kiểm lại tiền ở từng dòng.
- Luồng chuẩn gọi sau thanh toán có thể đúng; đây là lỗ hổng ràng buộc API, không phải kết luận mọi dự báo hiện tại đều sai.

## Các luồng chưa hoàn thiện cần làm sau

1. **Sửa số nhận NCC khi PN đã có điều chỉnh**: ví dụ thực giao 7, PN ghi 20, đã điều chỉnh -13. Cần chứng từ sửa liên kết, đối soát PO/tiền và điều chỉnh cũ; tồn cuối vẫn 7. Không sửa đè phiếu gốc, không trừ thêm 13. Người dùng đã yêu cầu ghi note và bàn sau, chưa triển khai.
2. **PN nguồn đã dùng/giữ cần sửa nghiệp vụ nhận hàng**: điều chỉnh kiểm kê hiện chỉ giảm phần khả dụng; chưa phải một quy trình sửa đầy đủ chứng từ nhận hàng và tài chính.
3. **PX gắn đơn ghi sai**: cần thống nhất trạng thái đơn sau sửa, có giữ lại NVL hay không, và khả năng xuất lại. Phải phối hợp bên đơn.
4. **PX cắm bó sẵn ghi sai**: phải xử lý cả NVL và thành phẩm; kiểm bó đã bán/giữ trước khi đảo. Cần nối kho thành phẩm/bên đơn.
5. **Đồng bộ snapshot/T/thanh toán**: thống nhất các điểm gọi API, không lấy BOM mới để thay ngược đơn đã chốt.
6. **Nguồn ưu tiên và FIFO**: đã chốt luôn FIFO; bỏ chọn nguồn ưu tiên, không có ngoại lệ lấy PN mới trước.

## Những điểm hiện tại không phải sai luồng

- PN Posted vẫn hiển thị số gốc sau điều chỉnh; số dư nguồn và lịch sử thể hiện thay đổi.
- Điều chỉnh tồn kiểm kê không tự đổi số đã nhận trên PO hoặc tiền NCC; khác với sửa sai số nhận hàng. Tài liệu không mô tả chi tiết mọi hình thức điều chỉnh nên cần chốt quy trình riêng cho trường hợp thứ hai.
- Không đạt lúc nhận hàng không vào tồn và không xuất hủy lần nữa. Không đạt phát sinh trong kho: cách ly giảm khả dụng, xuất hủy cách ly mới giảm tồn thực.
- Lịch sử nhiều năm được giữ lại; tab riêng, tìm kiếm, lọc ngày và phân trang chỉ thay cách xem.
- Giữ tồn không phải xuất; PX thực lấy kết thúc giữ, không trừ NVL lần hai khi giao.

## Căn cứ kiểm tra

- 33 kiểm thử kho đã đạt trong lượt sửa gần nhất; build admin và TypeScript backend đã đạt.
- 24 kiểm thử đơn đã đạt trong lượt tích hợp trước; không chạy lại toàn bộ đơn trong lượt rà soát này.
- Đã đọc lại các service và tái hiện riêng lỗi phân bổ nguồn ưu tiên trùng.
- Chưa chạy lại E2E mọi màn hình, chưa nghiệm thu 3D/toàn checkout/toàn bộ sheet ngoài bảng D04 đã dán.
- Lượt này chỉ rà soát và ghi nhận, không tự sửa các luồng đang chờ bàn.

## Cập nhật sau khi người dùng yêu cầu sửa tiếp

Đã sửa: mặc định QR/giữ 5 phút; chặn đổi ĐVT khi tồn bằng 0 nhưng đã có lịch sử/BOM/nguồn cung; loại trùng nguồn ưu tiên; lưu và dùng BOM snapshot trong checkout thường/giữ lại/nhu cầu/gợi ý xuất; kiểm bằng chứng thanh toán và loại nhu cầu không hợp lệ khỏi dự báo.

Đã nối đảo PX theo đơn ở trạng thái chờ xử lý/chuẩn bị (phục hồi giữ, bỏ dấu đã xuất, cho phép PX thay thế) và đảo cắm bó sẵn khi thành phẩm còn đủ khả dụng. Giữ chặn đơn đã giao/hủy, liên kết đã đổi, nguồn/giữ/giá trị không khớp hoặc thành phẩm không đủ; các lỗi phải rollback toàn giao dịch.

Còn chờ bàn: sửa số nhận NCC/PO/tiền khi PN đã điều chỉnh; nghiệp vụ sau giao/hủy; FIFO đã chốt: luôn tự động, không còn chọn nguồn ưu tiên.

Đơn cũ thiếu BOM snapshot không được âm thầm dùng BOM mới. Cần đối soát dữ liệu lịch sử, không tự backfill snapshot bằng công thức hiện hành.

Kết quả xác minh sau lượt sửa: 63 kiểm thử kho/đơn đạt (39 kho, 24 đơn), gồm đảo PX đồng thời, khôi phục giữ không chiếm tồn đơn khác, rollback khi thành phẩm không đủ, snapshot và điều kiện thanh toán. Chưa coi đây là nghiệm thu E2E mọi trang.

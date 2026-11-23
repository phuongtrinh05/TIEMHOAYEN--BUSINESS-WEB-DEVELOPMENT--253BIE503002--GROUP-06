// Trạng thái tài khoản được nhập tay theo nhiều kiểu dấu ("khóa"/"khoá", "Đã nghỉ"/"Nghỉ việc").
// Bỏ dấu trước khi so sánh để mọi biến thể khóa/nghỉ đều bị chặn như nhau.
const plain = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase()
  .trim();

const INACTIVE = /(cho xac minh|khoa|ngung|inactive|vo hieu|da xoa|nghi)/;
const LOCKED = /(khoa|ngung|inactive|vo hieu)/;

/** Tài khoản không được đăng nhập / thao tác: chờ xác minh, bị khóa, ngừng, đã xóa, nghỉ việc. */
export const isInactiveStatus = (status: unknown) => INACTIVE.test(plain(status));

/** Chỉ trạng thái bị khóa / ngừng (không gồm chờ xác minh). Dùng cho tài khoản khách hàng. */
export const isLockedStatus = (status: unknown) => LOCKED.test(plain(status));

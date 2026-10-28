/**
 * Địa chỉ backend dùng chung cho toàn Admin.
 * - Mặc định: backend đã deploy trên Render.
 * - Muốn trỏ backend chạy local (để test chức năng kho mới trước khi deploy), mở DevTools Console:
 *     localStorage.setItem('API_BASE_URL', 'http://localhost:3000/api'); location.reload();
 *   Bỏ trỏ local: localStorage.removeItem('API_BASE_URL').
 */
export const DEFAULT_API_BASE_URL = 'https://tiem-hoa-yen-api.onrender.com/api';

export function apiBaseUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const override = localStorage.getItem('API_BASE_URL');
      if (override && /^https?:\/\//.test(override)) return override.replace(/\/$/, '');
    }
  } catch {
    /* SSR / private mode */
  }
  if (typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname)) return LOCAL_API_BASE_URL;
  return DEFAULT_API_BASE_URL;
}

export const LOCAL_API_BASE_URL = 'http://localhost:3000/api';

/** Đổi backend cho Admin (lưu ở trình duyệt) rồi tải lại trang. */
export function switchApiBaseUrl(target: 'local' | 'render'): void {
  try {
    if (target === 'local') localStorage.setItem('API_BASE_URL', LOCAL_API_BASE_URL);
    else localStorage.removeItem('API_BASE_URL');
  } catch {
    /* ignore */
  }
  location.reload();
}

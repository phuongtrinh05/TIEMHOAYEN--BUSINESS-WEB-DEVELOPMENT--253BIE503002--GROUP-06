/**
 * Yêu thích & "Xem gần nhất" của Danh sách báo cáo — lưu ở trình duyệt (theo từng máy / tài khoản đăng nhập).
 * Bọc try/catch để chế độ ẩn danh hoặc SSR không lỗi.
 */
export interface ReportStore {
  favorites: string[];
  viewed: Record<string, string>; // key → ISO thời điểm mở gần nhất
}

const KEY = () => {
  try {
    return `THY_REPORTS_${localStorage.getItem('adminEmployeeId') || 'admin'}`;
  } catch {
    return 'THY_REPORTS_admin';
  }
};

export const readStore = (): ReportStore => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY()) : null;
    const v = raw ? JSON.parse(raw) : {};
    return { favorites: Array.isArray(v.favorites) ? v.favorites : [], viewed: v.viewed && typeof v.viewed === 'object' ? v.viewed : {} };
  } catch {
    return { favorites: [], viewed: {} };
  }
};

export const writeStore = (patch: Partial<ReportStore>): void => {
  try {
    localStorage.setItem(KEY(), JSON.stringify({ ...readStore(), ...patch }));
  } catch {
    /* bỏ qua */
  }
};

export const markViewed = (key: string): void => {
  const s = readStore();
  writeStore({ viewed: { ...s.viewed, [key]: new Date().toISOString() } });
};

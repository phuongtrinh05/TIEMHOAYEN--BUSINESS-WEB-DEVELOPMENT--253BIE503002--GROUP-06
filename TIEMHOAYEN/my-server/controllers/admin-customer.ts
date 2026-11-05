import { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { getCollection, getNextPrefixedId } from '../mongo.js';
import { summarizePayments } from '../services/admin-order.service.js';
import { audit, AuthError, revokeAllSessions } from '../services/auth.service.js';
import { formatDate, normalizeOrderStatus, normalizeText, toDate } from './admin.js';

/*
 * Quản lý khách hàng phía Admin (AD33–AD40).
 * Quy tắc số liệu dùng chung cho danh sách và trang chi tiết:
 *  - Số đơn: mọi đơn trừ đơn đã hủy.
 *  - Tổng chi tiêu: tổng tiền các đơn Đã giao / Hoàn thành.
 *  - Nợ phải thu: phần còn thiếu (tổng tiền − tiền đã thu thành công) của đơn đang xử lý trở đi,
 *    không tính đơn đã hủy hoặc đơn online chưa thanh toán xong.
 * Các số liệu này luôn tính từ đơn/thanh toán, không cho sửa tay.
 */
const COMPLETED = new Set(['Đã giao', 'Hoàn thành']);
const NOT_RECEIVABLE = new Set(['Đã hủy', 'Chờ thanh toán', 'Thanh toán thất bại']);
const GENDERS = ['Nam', 'Nữ', 'Khác'];
const LOCKED_STATUS = 'Bị khóa';
const PHONE = /^0\d{9}$/;

const fail = (res: Response, error: any, fallback: string) => {
  if (error instanceof AuthError) return res.status(error.status).json({ ...error.extra, message: error.message });
  console.error(fallback, error?.message);
  return res.status(500).json({ message: fallback });
};
const isLocked = (customer: any) => /khóa|khoa|ngừng|ngung|inactive/i.test(String(customer?.TRANG_THAI || ''));
const customerStatus = (customer: any) => /chờ xác minh/i.test(String(customer?.TRANG_THAI || '')) ? 'Chờ xác minh' : isLocked(customer) ? LOCKED_STATUS : 'Hoạt động';
const initials = (name: unknown) => String(name || '').trim().split(/\s+/).filter(Boolean).slice(-2).map(part => part[0]).join('').toUpperCase() || 'KH';
const isoDate = (value: unknown) => { const date = toDate(value); return date ? date.toISOString() : ''; };
const dateInput = (value: unknown) => { const date = toDate(value); return date ? date.toISOString().slice(0, 10) : ''; };

type OrderStats = { totalOrders: number; completedOrders: number; totalSpent: number; debt: number; latestOrderDate: Date | null };
const emptyStats = (): OrderStats => ({ totalOrders: 0, completedOrders: 0, totalSpent: 0, debt: 0, latestOrderDate: null });

const paymentPresentation = (summary: ReturnType<typeof summarizePayments>, latestStatus: unknown) =>
  summary.paymentStatus === 'PAID' ? 'Đã thanh toán' : summary.paymentStatus === 'PARTIALLY_PAID' ? 'Đã cọc'
    : /thất bại|failed/i.test(String(latestStatus || '')) ? 'Thanh toán thất bại' : 'Chờ thanh toán';

async function loadOrdersWithPayments(filter: Record<string, unknown>) {
  const orders = await (await getCollection<any>('DON_HANG')).find(filter, { projection: {
    DON_HANG_ID: 1, KHACH_HANG_ID: 1, TONG_TIEN: 1, TIEN_COC: 1, TRANG_THAI: 1, NGAY_TAO: 1,
  } }).toArray();
  const payments = orders.length ? await (await getCollection<any>('THANH_TOAN')).find({ DON_HANG_ID: { $in: orders.map(order => order.DON_HANG_ID) } }).toArray() : [];
  const paymentsByOrder = new Map<string, any[]>();
  for (const payment of payments) paymentsByOrder.set(payment.DON_HANG_ID, [...(paymentsByOrder.get(payment.DON_HANG_ID) || []), payment]);
  return orders.map(order => {
    const rows = paymentsByOrder.get(order.DON_HANG_ID) || [];
    const latest = [...rows].sort((a, b) => (toDate(b.NGAY_THANH_TOAN)?.getTime() || 0) - (toDate(a.NGAY_THANH_TOAN)?.getTime() || 0))[0];
    const summary = summarizePayments(rows, Number(order.TONG_TIEN || 0), Number(order.TIEN_COC || 0));
    return { order, status: normalizeOrderStatus(order.TRANG_THAI), summary, paymentStatus: paymentPresentation(summary, latest?.TRANG_THAI_THANH_TOAN) };
  });
}

function accumulate(stats: OrderStats, row: Awaited<ReturnType<typeof loadOrdersWithPayments>>[number]) {
  if (row.status !== 'Đã hủy') stats.totalOrders += 1;
  if (COMPLETED.has(row.status)) { stats.completedOrders += 1; stats.totalSpent += Number(row.order.TONG_TIEN || 0); }
  if (!NOT_RECEIVABLE.has(row.status)) stats.debt += row.summary.remainingAmount;
  const created = toDate(row.order.NGAY_TAO);
  if (created && (!stats.latestOrderDate || created > stats.latestOrderDate)) stats.latestOrderDate = created;
}

function mapCustomer(customer: any, stats: OrderStats = emptyStats()) {
  const { MAT_KHAU, SO_LAN_DANG_NHAP_SAI, KHOA_DANG_NHAP_DEN, ...safe } = customer || {};
  return {
    ...safe,
    id: customer.KHACH_HANG_ID,
    code: customer.KHACH_HANG_ID,
    name: customer.TEN || '',
    avatarText: initials(customer.TEN),
    avatar: customer.AVATAR || '',
    phone: customer.SDT || '',
    email: customer.EMAIL || '',
    point: Number(customer.DIEM_TICH_LUY || 0),
    points: Number(customer.DIEM_TICH_LUY || 0),
    membershipTier: customer.LOAI_THANH_VIEN || '',
    memberType: customer.LOAI_THANH_VIEN || '',
    birthDate: dateInput(customer.DOB),
    gender: customer.GIOI_TINH || '',
    status: customerStatus(customer),
    locked: isLocked(customer),
    lockReason: customer.LY_DO_KHOA || '',
    createdAt: isoDate(customer.NGAY_DANG_KY),
    lastLogin: customer.DANG_NHAP_GAN_NHAT ? { time: customer.DANG_NHAP_GAN_NHAT.THOI_GIAN, ip: customer.DANG_NHAP_GAN_NHAT.IP, device: customer.DANG_NHAP_GAN_NHAT.THIET_BI } : null,
    totalOrders: stats.totalOrders,
    completedOrders: stats.completedOrders,
    totalSpent: stats.totalSpent,
    debt: stats.debt,
    latestOrderDate: stats.latestOrderDate ? formatDate(stats.latestOrderDate) : '',
    selected: false,
  };
}

const mapAddress = (row: any) => {
  const parts = [row.DIA_CHI_CHI_TIET, row.PHUONG_XA, row.QUAN_HUYEN, row.TINH_THANH].map(part => String(part || '').trim()).filter(Boolean);
  return {
    ...row,
    id: row.DIA_CHI_ID,
    name: row.TEN_NGUOI_NHAN || '',
    phone: row.SDT_NGUOI_NHAN || '',
    province: row.TINH_THANH || '',
    district: row.QUAN_HUYEN || '',
    ward: row.PHUONG_XA || '',
    detailAddress: row.DIA_CHI_CHI_TIET || '',
    address: parts.join(', '),
    isDefault: row.LA_MAC_DINH === true,
    lastUsedAt: isoDate(row.NGAY_SU_DUNG_GAN_NHAT || row.NGAY_TAO),
  };
};

// ===== AD39: địa chỉ dạng cây Tỉnh → Quận/Huyện → Phường/Xã lấy từ dữ liệu địa chỉ hiện có =====
export const getAdminAddressOptions = async (_req: Request, res: Response) => {
  try {
    const rows = await (await getCollection<any>('DIA_CHI_GIAO_HANG')).find({ DA_XOA: { $ne: true } }, { projection: { TINH_THANH: 1, QUAN_HUYEN: 1, PHUONG_XA: 1 } }).toArray();
    const tree = new Map<string, Map<string, Set<string>>>();
    for (const row of rows) {
      const province = String(row.TINH_THANH || '').trim();
      if (!province) continue;
      const districts = tree.get(province) || new Map<string, Set<string>>();
      const district = String(row.QUAN_HUYEN || '').trim();
      if (district) {
        const wards = districts.get(district) || new Set<string>();
        const ward = String(row.PHUONG_XA || '').trim();
        if (ward) wards.add(ward);
        districts.set(district, wards);
      }
      tree.set(province, districts);
    }
    const sort = (a: string, b: string) => a.localeCompare(b, 'vi');
    res.json({
      provinces: [...tree.keys()].sort(sort).map(name => ({
        name,
        districts: [...tree.get(name)!.keys()].sort(sort).map(district => ({
          name: district, wards: [...tree.get(name)!.get(district)!].sort(sort).map(ward => ({ name: ward })),
        })),
      })),
    });
  } catch (error) { fail(res, error, 'Không thể tải dữ liệu địa chỉ.'); }
};

// ===== AD33: danh sách + tổng quan =====
export const getAdminCustomers = async (req: Request, res: Response) => {
  try {
    const [customers, orders] = await Promise.all([
      (await getCollection<any>('KHACH_HANG')).find({ DA_XOA: { $ne: true } }).sort({ KHACH_HANG_ID: 1 }).toArray(),
      loadOrdersWithPayments({ KHACH_HANG_ID: { $nin: [null, ''] } }),
    ]);
    const statsByCustomer = new Map<string, OrderStats>();
    for (const row of orders) {
      const id = String(row.order.KHACH_HANG_ID);
      const stats = statsByCustomer.get(id) || emptyStats();
      accumulate(stats, row);
      statsByCustomer.set(id, stats);
    }
    let list = customers.map(customer => mapCustomer(customer, statsByCustomer.get(customer.KHACH_HANG_ID)));
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const summary = {
      total: list.length,
      active: list.filter(row => row.status === 'Hoạt động').length,
      locked: list.filter(row => row.locked).length,
      pendingVerification: list.filter(row => row.status === 'Chờ xác minh').length,
      newThisMonth: customers.filter(row => (toDate(row.NGAY_DANG_KY)?.getTime() || 0) >= monthStart.getTime()).length,
      withDebt: list.filter(row => row.debt > 0).length,
      totalDebt: list.reduce((sum, row) => sum + row.debt, 0),
      totalSpent: list.reduce((sum, row) => sum + row.totalSpent, 0),
    };
    const keyword = normalizeText(req.query.search || '');
    const status = String(req.query.status || '').trim();
    const tier = normalizeText(req.query.tier || '');
    if (keyword) list = list.filter(row => normalizeText([row.code, row.name, row.phone, row.email].join(' ')).includes(keyword));
    if (status === 'locked') list = list.filter(row => row.locked);
    else if (status === 'active') list = list.filter(row => row.status === 'Hoạt động');
    else if (status === 'pending') list = list.filter(row => row.status === 'Chờ xác minh');
    else if (status === 'debt') list = list.filter(row => row.debt > 0);
    if (tier) list = list.filter(row => normalizeText(row.membershipTier) === tier);
    const total = list.length;
    const requestedLimit = Number.parseInt(String(req.query.limit || '0'), 10) || 0;
    const limit = requestedLimit ? Math.min(200, Math.max(1, requestedLimit)) : 0;
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    if (limit) list = list.slice((page - 1) * limit, page * limit);
    res.json({ total, page, limit: limit || total, totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1, summary, customers: list });
  } catch (error) { fail(res, error, 'Không thể tải danh sách khách hàng.'); }
};

// ===== AD35–AD38: chi tiết =====
export const getAdminCustomerDetail = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '');
    const customer = await (await getCollection<any>('KHACH_HANG')).findOne({ KHACH_HANG_ID: customerId });
    if (!customer) return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    const [addresses, orderRows, wishlist, reviews, notes] = await Promise.all([
      (await getCollection<any>('DIA_CHI_GIAO_HANG')).find({ KHACH_HANG_ID: customerId, DA_XOA: { $ne: true } }).toArray(),
      loadOrdersWithPayments({ KHACH_HANG_ID: customerId }),
      (await getCollection<any>('YEU_THICH')).find({ KHACH_HANG_ID: customerId }).sort({ NGAY_TAO: -1 }).toArray(),
      (await getCollection<any>('DANH_GIA')).find({ KHACH_HANG_ID: customerId }).sort({ NGAY_DANH_GIA: -1 }).toArray(),
      (await getCollection<any>('GHI_CHU_KHACH_HANG')).find({ KHACH_HANG_ID: customerId }).sort({ NGAY_TAO: -1 }).limit(100).toArray(),
    ]);
    const stats = emptyStats();
    orderRows.forEach(row => accumulate(stats, row));
    const productIds = [...new Set([...wishlist, ...reviews].map(row => String(row.SAN_PHAM_ID)))];
    const [products, images] = await Promise.all([
      (await getCollection<any>('SAN_PHAM')).find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
      (await getCollection<any>('HINH_ANH_SAN_PHAM')).find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
    ]);
    const productById = new Map(products.map(product => [product.SAN_PHAM_ID, product]));
    const imageById = new Map<string, string>();
    for (const image of images.sort((a, b) => Number(Boolean(b.LA_ANH_CHINH)) - Number(Boolean(a.LA_ANH_CHINH)))) {
      if (!imageById.has(image.SAN_PHAM_ID)) imageById.set(image.SAN_PHAM_ID, image.URL);
    }
    const staffIds = [...new Set(notes.map(note => note.NHAN_VIEN_ID).filter(Boolean))];
    const staff = staffIds.length ? await (await getCollection<any>('NHAN_VIEN')).find({ NHAN_VIEN_ID: { $in: staffIds } }, { projection: { NHAN_VIEN_ID: 1, HO_TEN: 1 } }).toArray() : [];
    const staffName = new Map(staff.map(row => [row.NHAN_VIEN_ID, row.HO_TEN]));
    const ratings = reviews.map(review => Number(review.SO_SAO || 0)).filter(Boolean);

    const detail = mapCustomer(customer, stats);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      customer: {
        ...detail,
        averageRating: ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 10) / 10 : 0,
        reviewCount: reviews.length,
        internalNote: customer.GHI_CHU_NOI_BO || '',
      },
      addresses: addresses.map(mapAddress).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
      orders: orderRows
        .sort((a, b) => (toDate(b.order.NGAY_TAO)?.getTime() || 0) - (toDate(a.order.NGAY_TAO)?.getTime() || 0))
        .map(row => ({
          id: row.order.DON_HANG_ID, code: row.order.DON_HANG_ID, createdAt: formatDate(row.order.NGAY_TAO),
          total: Number(row.order.TONG_TIEN || 0), paid: row.summary.successfulReceiptsTotal, remaining: row.summary.remainingAmount,
          paymentStatus: row.paymentStatus, status: row.status,
        })),
      favorites: wishlist.map(item => {
        const product = productById.get(item.SAN_PHAM_ID);
        const deleted = !product || product.DA_XOA === true || product.DA_XOA === 1 || /đã xóa/i.test(String(product.TRANG_THAI || ''));
        const selling = !deleted && String(product?.TRANG_THAI || '').trim() === 'Đang bán';
        const price = Number(product?.GIA || 0);
        const sale = Number(product?.GIA_KHUYEN_MAI || 0);
        return {
          id: item.SAN_PHAM_ID, code: item.SAN_PHAM_ID, name: product?.TEN_SAN_PHAM || 'Sản phẩm không còn tồn tại',
          image: imageById.get(item.SAN_PHAM_ID) || '', price: sale > 0 && sale < price ? sale : price, originalPrice: price,
          salePrice: sale > 0 && sale < price ? sale : 0, likedAt: isoDate(item.NGAY_TAO),
          availability: deleted ? 'Đã xóa' : !selling ? 'Ngừng bán' : Number(product?.SO_LUONG ?? 1) <= 0 ? 'Hết hàng' : 'Đang bán',
          canOpen: !deleted,
        };
      }),
      reviews: reviews.map(review => ({
        id: review.DANH_GIA_ID, orderId: review.DON_HANG_ID, productId: review.SAN_PHAM_ID,
        productName: productById.get(review.SAN_PHAM_ID)?.TEN_SAN_PHAM || review.SAN_PHAM_ID,
        productImage: imageById.get(review.SAN_PHAM_ID) || '', rating: Number(review.SO_SAO || 0),
        content: review.NOI_DUNG || '', createdAt: isoDate(review.NGAY_DANH_GIA), hidden: review.DA_AN === true,
        hiddenReason: review.LY_DO_AN || '', reply: review.PHAN_HOI_SHOP || '', replyDate: isoDate(review.NGAY_PHAN_HOI_SHOP),
      })),
      notes: notes.map(note => ({
        id: note.GHI_CHU_ID, content: note.NOI_DUNG, createdAt: isoDate(note.NGAY_TAO),
        staffId: note.NHAN_VIEN_ID, staffName: staffName.get(note.NHAN_VIEN_ID) || note.NHAN_VIEN_ID,
      })),
      stats: { totalOrders: stats.totalOrders, totalSpent: stats.totalSpent, debt: stats.debt, favorites: wishlist.length, reviews: reviews.length },
    });
  } catch (error) { fail(res, error, 'Không thể tải chi tiết khách hàng.'); }
};

// ===== AD34 / AD40: sửa hồ sơ (chỉ các trường được phép) =====
export const updateAdminCustomer = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '');
    const customers = await getCollection<any>('KHACH_HANG');
    const existing = await customers.findOne({ KHACH_HANG_ID: customerId });
    if (!existing) return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    const body = req.body || {};
    const changes: Record<string, unknown> = {};
    const name = body.name ?? body.TEN;
    if (name !== undefined) {
      const value = String(name).trim().replace(/\s+/g, ' ');
      if (!value || value.length > 100) throw new AuthError(400, 'Họ tên bắt buộc và tối đa 100 ký tự.', { field: 'name' });
      changes.TEN = value;
    }
    const birth = body.birthDate ?? body.DOB;
    if (birth !== undefined) {
      const date = birth ? toDate(birth) : null;
      if (birth && (!date || date.getTime() > Date.now() || date.getFullYear() < 1900)) throw new AuthError(400, 'Ngày sinh không hợp lệ.', { field: 'birthDate' });
      changes.DOB = date;
    }
    const gender = body.gender ?? body.GIOI_TINH;
    if (gender !== undefined && gender !== '') {
      if (!GENDERS.includes(String(gender))) throw new AuthError(400, 'Giới tính không hợp lệ.', { field: 'gender' });
      changes.GIOI_TINH = String(gender);
    }
    const note = body.internalNote ?? body.note ?? body.GHI_CHU_NOI_BO;
    if (note !== undefined) {
      if (String(note).length > 1000) throw new AuthError(400, 'Ghi chú nội bộ tối đa 1000 ký tự.', { field: 'note' });
      changes.GHI_CHU_NOI_BO = String(note).trim();
    }
    // Email/SĐT là thông tin đăng nhập: chỉ khách tự đổi qua bước xác minh, Admin không sửa trực tiếp.
    const phone = body.phone ?? body.SDT;
    const email = body.email ?? body.EMAIL;
    const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
    if ((phone !== undefined && !same(phone, existing.SDT)) || (email !== undefined && !same(email, existing.EMAIL))) {
      throw new AuthError(400, 'Số điện thoại và email là thông tin đăng nhập, khách hàng cần tự đổi và xác minh trong tài khoản.', { field: phone !== undefined && !same(phone, existing.SDT) ? 'phone' : 'email' });
    }
    if (body.status !== undefined || body.TRANG_THAI !== undefined) throw new AuthError(400, 'Dùng chức năng Khóa/Mở khóa để đổi trạng thái tài khoản.');
    if (!Object.keys(changes).length) throw new AuthError(400, 'Chưa có thay đổi nào.');
    changes.NGAY_CAP_NHAT = new Date();
    const updated = await customers.findOneAndUpdate({ KHACH_HANG_ID: customerId }, { $set: changes }, { returnDocument: 'after' });
    await audit(req, 'CAP_NHAT_KHACH_HANG', customerId, {
      truoc: Object.fromEntries(Object.keys(changes).filter(key => key !== 'NGAY_CAP_NHAT').map(key => [key, existing[key] ?? null])),
      sau: Object.fromEntries(Object.entries(changes).filter(([key]) => key !== 'NGAY_CAP_NHAT')),
    });
    res.json({ message: 'Đã cập nhật thông tin khách hàng.', customer: mapCustomer(updated) });
  } catch (error) { fail(res, error, 'Không thể cập nhật khách hàng.'); }
};

// ===== AD33: khóa / mở khóa tài khoản =====
export const setAdminCustomerLock = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '');
    const lock = req.body?.locked === true || req.body?.action === 'lock';
    const reason = String(req.body?.reason || '').trim();
    if (lock && (!reason || reason.length > 300)) throw new AuthError(400, 'Vui lòng nhập lý do khóa (tối đa 300 ký tự).', { field: 'reason' });
    const customers = await getCollection<any>('KHACH_HANG');
    const existing = await customers.findOne({ KHACH_HANG_ID: customerId });
    if (!existing) return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    if (lock === isLocked(existing)) throw new AuthError(409, lock ? 'Tài khoản đã bị khóa trước đó.' : 'Tài khoản đang hoạt động.');
    const update = lock
      ? { $set: { TRANG_THAI: LOCKED_STATUS, LY_DO_KHOA: reason, NGAY_KHOA: new Date(), NGUOI_KHOA_ID: req.identity?.id || null } }
      : { $set: { TRANG_THAI: 'Hoạt động' }, $unset: { LY_DO_KHOA: '', NGAY_KHOA: '', NGUOI_KHOA_ID: '' } };
    const updated = await customers.findOneAndUpdate({ KHACH_HANG_ID: customerId }, update, { returnDocument: 'after' });
    // Khóa thì ngừng ngay mọi phiên đang đăng nhập; lịch sử mua vẫn giữ nguyên.
    if (lock) await revokeAllSessions('KHACH_HANG', customerId);
    await audit(req, lock ? 'KHOA_KHACH_HANG' : 'MO_KHOA_KHACH_HANG', customerId, { truoc: existing.TRANG_THAI || 'Hoạt động', sau: updated?.TRANG_THAI, LY_DO: reason || undefined });
    res.json({ message: lock ? 'Đã khóa tài khoản và đăng xuất khách khỏi mọi thiết bị.' : 'Đã mở khóa tài khoản.', customer: mapCustomer(updated) });
  } catch (error) { fail(res, error, 'Không thể đổi trạng thái tài khoản.'); }
};

// ===== AD35: ghi chú nội bộ (chỉ nhân viên xem) =====
export const addAdminCustomerNote = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '');
    const content = String(req.body?.content || '').trim();
    if (!content || content.length > 1000) throw new AuthError(400, 'Nội dung ghi chú bắt buộc, tối đa 1000 ký tự.', { field: 'content' });
    if (!await (await getCollection<any>('KHACH_HANG')).findOne({ KHACH_HANG_ID: customerId }, { projection: { _id: 1 } })) return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    const note = { _id: randomBytes(12).toString('hex'), GHI_CHU_ID: `GC${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString('hex').toUpperCase()}`,
      KHACH_HANG_ID: customerId, NOI_DUNG: content, NHAN_VIEN_ID: req.identity?.id || null, NGAY_TAO: new Date() };
    await (await getCollection<any>('GHI_CHU_KHACH_HANG')).insertOne(note);
    await audit(req, 'THEM_GHI_CHU_KHACH_HANG', customerId, { GHI_CHU_ID: note.GHI_CHU_ID });
    res.status(201).json({ message: 'Đã lưu ghi chú.', note: { id: note.GHI_CHU_ID, content, createdAt: note.NGAY_TAO.toISOString(), staffId: note.NHAN_VIEN_ID, staffName: req.identity?.account?.HO_TEN || note.NHAN_VIEN_ID } });
  } catch (error) { fail(res, error, 'Không thể lưu ghi chú.'); }
};

// ===== AD38: ẩn / hiện đánh giá =====
export const setAdminReviewVisibility = async (req: Request, res: Response) => {
  try {
    const hidden = req.body?.hidden === true;
    const reason = String(req.body?.reason || '').trim();
    if (hidden && (!reason || reason.length > 300)) throw new AuthError(400, 'Vui lòng nhập lý do ẩn đánh giá (tối đa 300 ký tự).', { field: 'reason' });
    const reviews = await getCollection<any>('DANH_GIA');
    const update = hidden ? { $set: { DA_AN: true, LY_DO_AN: reason, NGAY_AN: new Date(), NGUOI_AN_ID: req.identity?.id || null } }
      : { $set: { DA_AN: false }, $unset: { LY_DO_AN: '', NGAY_AN: '', NGUOI_AN_ID: '' } };
    const result = await reviews.findOneAndUpdate({ DANH_GIA_ID: req.params.reviewId }, update, { returnDocument: 'after' });
    if (!result) return res.status(404).json({ message: 'Không tìm thấy đánh giá.' });
    await audit(req, hidden ? 'AN_DANH_GIA' : 'HIEN_DANH_GIA', String(req.params.reviewId), { LY_DO: reason || undefined });
    res.json({ message: hidden ? 'Đã ẩn đánh giá khỏi trang sản phẩm.' : 'Đã hiển thị lại đánh giá.', hidden });
  } catch (error) { fail(res, error, 'Không thể cập nhật đánh giá.'); }
};

// ===== AD39: địa chỉ giao hàng =====
function readAddress(body: any) {
  const value = (...keys: string[]) => String(keys.map(key => body?.[key]).find(item => item !== undefined && item !== null) ?? '').trim().replace(/\s+/g, ' ');
  const address = {
    TEN_NGUOI_NHAN: value('name', 'receiverName', 'TEN_NGUOI_NHAN'),
    SDT_NGUOI_NHAN: value('phone', 'receiverPhone', 'SDT_NGUOI_NHAN').replace(/[\s.-]/g, ''),
    TINH_THANH: value('province', 'TINH_THANH'),
    QUAN_HUYEN: value('district', 'QUAN_HUYEN'),
    PHUONG_XA: value('ward', 'PHUONG_XA'),
    DIA_CHI_CHI_TIET: value('detailAddress', 'DIA_CHI_CHI_TIET'),
  };
  if (!address.TEN_NGUOI_NHAN || address.TEN_NGUOI_NHAN.length > 100) throw new AuthError(400, 'Tên người nhận bắt buộc, tối đa 100 ký tự.', { field: 'name' });
  if (!PHONE.test(address.SDT_NGUOI_NHAN)) throw new AuthError(400, 'Số điện thoại người nhận cần 10 chữ số, bắt đầu bằng 0.', { field: 'phone' });
  if (!address.TINH_THANH || !address.QUAN_HUYEN || !address.PHUONG_XA) throw new AuthError(400, 'Vui lòng chọn đủ Tỉnh/Thành, Quận/Huyện, Phường/Xã.', { field: 'province' });
  if (!address.DIA_CHI_CHI_TIET || address.DIA_CHI_CHI_TIET.length > 255) throw new AuthError(400, 'Địa chỉ chi tiết bắt buộc, tối đa 255 ký tự.', { field: 'detailAddress' });
  return address;
}
const sameAddress = (row: any, address: Record<string, string>) => Object.entries(address).every(([key, value]) => normalizeText(row[key]) === normalizeText(value));
const truthy = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true';

export const createAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '');
    const address = readAddress(req.body);
    if (!await (await getCollection<any>('KHACH_HANG')).findOne({ KHACH_HANG_ID: customerId }, { projection: { _id: 1 } })) return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    const addresses = await getCollection<any>('DIA_CHI_GIAO_HANG');
    const current = await addresses.find({ KHACH_HANG_ID: customerId, DA_XOA: { $ne: true } }).toArray();
    if (current.some(row => sameAddress(row, address))) throw new AuthError(409, 'Địa chỉ này đã có trong sổ địa chỉ của khách.');
    const isDefault = truthy(req.body.isDefault ?? req.body.LA_MAC_DINH) || current.length === 0;
    const id = await getNextPrefixedId('DIA_CHI_GIAO_HANG', 'DIA_CHI_ID', 'DC', 4);
    const row = { _id: id, DIA_CHI_ID: id, KHACH_HANG_ID: customerId, ...address, LA_MAC_DINH: isDefault, DA_XOA: false, NGAY_TAO: new Date() };
    await addresses.insertOne(row);
    if (isDefault) await addresses.updateMany({ KHACH_HANG_ID: customerId, DIA_CHI_ID: { $ne: id } }, { $set: { LA_MAC_DINH: false } });
    await audit(req, 'THEM_DIA_CHI_KHACH_HANG', customerId, { DIA_CHI_ID: id });
    res.status(201).json({ message: 'Đã thêm địa chỉ.', address: mapAddress(row) });
  } catch (error) { fail(res, error, 'Không thể thêm địa chỉ.'); }
};

export const updateAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { customerId, addressId } = req.params;
    const address = readAddress(req.body);
    const addresses = await getCollection<any>('DIA_CHI_GIAO_HANG');
    const others = await addresses.find({ KHACH_HANG_ID: customerId, DIA_CHI_ID: { $ne: addressId }, DA_XOA: { $ne: true } }).toArray();
    if (others.some(row => sameAddress(row, address))) throw new AuthError(409, 'Địa chỉ này đã có trong sổ địa chỉ của khách.');
    const isDefault = truthy(req.body.isDefault ?? req.body.LA_MAC_DINH) || others.length === 0;
    const updated = await addresses.findOneAndUpdate({ KHACH_HANG_ID: customerId, DIA_CHI_ID: addressId, DA_XOA: { $ne: true } },
      { $set: { ...address, LA_MAC_DINH: isDefault, NGAY_CAP_NHAT: new Date() } }, { returnDocument: 'after' });
    if (!updated) return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    if (isDefault) await addresses.updateMany({ KHACH_HANG_ID: customerId, DIA_CHI_ID: { $ne: addressId } }, { $set: { LA_MAC_DINH: false } });
    else if (!others.some(row => row.LA_MAC_DINH === true)) await addresses.updateOne({ DIA_CHI_ID: addressId }, { $set: { LA_MAC_DINH: true } });
    await audit(req, 'SUA_DIA_CHI_KHACH_HANG', String(customerId), { DIA_CHI_ID: addressId });
    res.json({ message: 'Đã cập nhật địa chỉ.', address: mapAddress(await addresses.findOne({ DIA_CHI_ID: addressId })) });
  } catch (error) { fail(res, error, 'Không thể cập nhật địa chỉ.'); }
};

export const setDefaultAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { customerId, addressId } = req.params;
    const addresses = await getCollection<any>('DIA_CHI_GIAO_HANG');
    const target = await addresses.findOne({ KHACH_HANG_ID: customerId, DIA_CHI_ID: addressId, DA_XOA: { $ne: true } });
    if (!target) return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    await addresses.updateOne({ DIA_CHI_ID: addressId }, { $set: { LA_MAC_DINH: true } });
    await addresses.updateMany({ KHACH_HANG_ID: customerId, DIA_CHI_ID: { $ne: addressId } }, { $set: { LA_MAC_DINH: false } });
    res.json({ message: 'Đã đặt làm địa chỉ mặc định.', address: mapAddress({ ...target, LA_MAC_DINH: true }) });
  } catch (error) { fail(res, error, 'Không thể đặt địa chỉ mặc định.'); }
};

export const deleteAdminCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { customerId, addressId } = req.params;
    const addresses = await getCollection<any>('DIA_CHI_GIAO_HANG');
    const target = await addresses.findOneAndUpdate({ KHACH_HANG_ID: customerId, DIA_CHI_ID: addressId, DA_XOA: { $ne: true } },
      { $set: { DA_XOA: true, LA_MAC_DINH: false } }, { returnDocument: 'before' });
    if (!target) return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    // Xóa địa chỉ mặc định thì địa chỉ được thêm gần nhất trở thành mặc định mới. Đơn cũ giữ bản địa chỉ đã chốt.
    let newDefaultId = '';
    if (target.LA_MAC_DINH === true) {
      const next = await addresses.find({ KHACH_HANG_ID: customerId, DA_XOA: { $ne: true } }).sort({ NGAY_TAO: -1, DIA_CHI_ID: -1 }).limit(1).next();
      if (next) { await addresses.updateOne({ DIA_CHI_ID: next.DIA_CHI_ID }, { $set: { LA_MAC_DINH: true } }); newDefaultId = next.DIA_CHI_ID; }
    }
    await audit(req, 'XOA_DIA_CHI_KHACH_HANG', String(customerId), { DIA_CHI_ID: addressId });
    res.json({ message: 'Đã xóa địa chỉ.', newDefaultId });
  } catch (error) { fail(res, error, 'Không thể xóa địa chỉ.'); }
};

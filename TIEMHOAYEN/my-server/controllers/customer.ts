import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';
import { hashPassword, isPasswordHash, verifyPassword } from '../utils/passwordHash.js';
import { randomUUID } from 'node:crypto';
import { InventoryError, withTransaction } from '../services/inventory/helpers.js';
import { createCustomerOrderAccess } from '../services/order-access.service.js';
import { assertLoginNotLocked, assertStrongPassword, audit, AuthError, recordLoginFailure, recordLoginSuccess, wrongPasswordError } from '../services/auth.service.js';
import { derivePromotionStatus } from '../services/pricing-voucher.service.js';
import { expireCustomerPoints } from '../services/loyalty-policy.service.js';


const normalizeAddressText = (value: unknown): string => {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
};

const sanitizeCustomer = (customer: any) => {
  if (!customer) {
    return customer;
  }

  const { MAT_KHAU, GHI_CHU_NOI_BO, SO_LAN_DANG_NHAP_SAI, KHOA_DANG_NHAP_DEN, ...safeCustomer } = customer;
  return safeCustomer;
};

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const compareDateDesc = (left: unknown, right: unknown): number => {
  return (toDate(right)?.getTime() || 0) - (toDate(left)?.getTime() || 0);
};

const compareDateAsc = (left: unknown, right: unknown): number => {
  return (toDate(left)?.getTime() || 0) - (toDate(right)?.getTime() || 0);
};

const isActiveRow = (row: any): boolean => row?.DA_XOA !== true && row?.DA_XOA !== 1;

const getCustomerCollection = () => getCollection<any>('KHACH_HANG');
const getAddressCollection = () => getCollection<any>('DIA_CHI_GIAO_HANG');

let wishlistIndexReady: Promise<string> | null = null;
const findWishlistUniqueIndex = (indexes: any[]): any | undefined => indexes.find(index => {
  const key = index?.key || {};
  return index?.unique === true &&
    Object.keys(key).length === 2 &&
    key.KHACH_HANG_ID === 1 &&
    key.SAN_PHAM_ID === 1;
});

const ensureWishlistIndex = () => {
  if (!wishlistIndexReady) {
    wishlistIndexReady = getCollection<any>('YEU_THICH').then(async (collection) => {
      const indexes = await collection.listIndexes().toArray().catch(error => {
        if (error.code === 26) return []; // Collection has not been created yet.
        throw error;
      });
      const existing = findWishlistUniqueIndex(indexes);
      if (existing?.name) return existing.name;
      const duplicates = await collection.aggregate([
        { $group: { _id: { customerId: '$KHACH_HANG_ID', productId: '$SAN_PHAM_ID' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ]).toArray();
      for (const duplicate of duplicates) {
        const [, ...redundantIds] = duplicate.ids;
        if (redundantIds.length) await collection.deleteMany({ _id: { $in: redundantIds } });
      }
      try {
        return await collection.createIndex(
          { KHACH_HANG_ID: 1, SAN_PHAM_ID: 1 },
          { unique: true, name: 'uniq_wishlist_customer_product' },
        );
      } catch (error: any) {
        // Dữ liệu import từ SQL đã có thể mang index cùng khóa với tên pk_...
        // MongoDB không cho tạo lại cùng đặc tả dưới một tên khác. Xác minh lại
        // index thực tế rồi tái sử dụng, thay vì làm thao tác Wishlist thất bại.
        const currentIndexes = await collection.listIndexes().toArray();
        const current = findWishlistUniqueIndex(currentIndexes);
        if (current?.name) return current.name;
        throw error;
      }
    }).catch((error) => {
      wishlistIndexReady = null;
      throw error;
    });
  }
  return wishlistIndexReady;
};

const readCustomerById = async (customerId: string) => {
  const customerCollection = await getCustomerCollection();
  return customerCollection.findOne({ KHACH_HANG_ID: customerId });
};

const normalizeAddressPayload = (body: any) => ({
  TEN_NGUOI_NHAN: normalizeAddressText(body.TEN_NGUOI_NHAN),
  SDT_NGUOI_NHAN: normalizeAddressText(body.SDT_NGUOI_NHAN),
  TINH_THANH: normalizeAddressText(body.TINH_THANH),
  QUAN_HUYEN: normalizeAddressText(body.QUAN_HUYEN),
  PHUONG_XA: normalizeAddressText(body.PHUONG_XA),
  DIA_CHI_CHI_TIET: normalizeAddressText(body.DIA_CHI_CHI_TIET),
});

const isSameAddress = (address: any, normalizedAddress: Record<string, string>): boolean => {
  return Object.entries(normalizedAddress).every(([key, value]) => normalizeAddressText(address[key]) === value);
};

const getPrimaryImageByProductIds = async (productIds: string[]) => {
  const imageCollection = await getCollection<any>('HINH_ANH_SAN_PHAM');
  const images = await imageCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray();
  const imageMap = new Map<string, any>();

  for (const image of images.sort((left, right) => {
    if (Boolean(left.LA_ANH_CHINH) !== Boolean(right.LA_ANH_CHINH)) {
      return Boolean(left.LA_ANH_CHINH) ? -1 : 1;
    }
    return String(left.HINH_ANH_ID || '').localeCompare(String(right.HINH_ANH_ID || ''), 'vi');
  })) {
    if (!imageMap.has(image.SAN_PHAM_ID)) {
      imageMap.set(image.SAN_PHAM_ID, image);
    }
  }

  return imageMap;
};

export const getAllCustomers = async (_req: Request, res: Response) => {
  try {
    const customerCollection = await getCustomerCollection();
    const customers = await customerCollection.find({}).sort({ KHACH_HANG_ID: 1 }).toArray();
    return res.status(200).json(customers.map(sanitizeCustomer));
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

const GENDERS = ['Nam', 'Nữ', 'Khác'];
const authFailure = (res: Response, error: any, fallback: string) => {
  if (error instanceof AuthError) return res.status(error.status).json({ ...error.extra, message: error.message });
  console.error(fallback, error?.message);
  return res.status(500).json({ message: fallback });
};

export const registerCustomer = async (req: Request, res: Response) => {
  try {
    const name = String(req.body.TEN || '').trim().replace(/\s+/g, ' ');
    const gender = String(req.body.GIOI_TINH || '').trim();
    const phone = String(req.body.SDT || '').replace(/[\s.-]/g, '');
    const emailValue = String(req.body.EMAIL || '').trim().toLowerCase();
    const password = String(req.body.MAT_KHAU || '');

    if (!name || name.length > 100) return res.status(400).json({ field: 'name', message: 'Vui lòng nhập họ tên (tối đa 100 ký tự).' });
    if (!GENDERS.includes(gender)) return res.status(400).json({ field: 'gender', message: 'Vui lòng chọn giới tính.' });
    if (!/^0\d{9}$/.test(phone)) return res.status(400).json({ field: 'phone', message: 'Số điện thoại cần gồm 10 chữ số, bắt đầu bằng 0.' });
    // Email không bắt buộc; nếu có nhập thì phải đúng định dạng và chưa được dùng.
    if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) return res.status(400).json({ field: 'email', message: 'Email không hợp lệ.' });
    assertStrongPassword(password);

    const customerCollection = await getCustomerCollection();
    if (await customerCollection.findOne({ SDT: phone })) {
      return res.status(409).json({ field: 'phone', message: 'Số điện thoại đã được đăng ký. Vui lòng đăng nhập hoặc dùng Quên mật khẩu.' });
    }
    if (emailValue) {
      const escaped = emailValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (await customerCollection.findOne({ EMAIL: { $regex: `^${escaped}$`, $options: 'i' } })) {
        return res.status(409).json({ field: 'email', message: 'Email đã được đăng ký.' });
      }
    }

    const newId = await getNextPrefixedId('KHACH_HANG', 'KHACH_HANG_ID', 'CUST', 4);
    const customer = {
      _id: newId,
      KHACH_HANG_ID: newId,
      TEN: name,
      EMAIL: emailValue || null,
      SDT: phone,
      MAT_KHAU: await hashPassword(password),
      DOB: null,
      GIOI_TINH: gender,
      NGAY_DANG_KY: new Date(),
      LOAI_THANH_VIEN: 'Thành viên',
      DIEM_TICH_LUY: 0,
      AVATAR: null,
      // Không còn bước xác minh email khi đăng ký: tài khoản dùng được ngay.
      TRANG_THAI: 'Hoạt động',
      DA_XOA: false,
    };

    await customerCollection.insertOne(customer);
    await audit(req, 'DANG_KY', newId);

    return res.status(201).json({
      message: 'Đăng ký thành công. Bạn có thể đăng nhập ngay.',
      customer: sanitizeCustomer(customer),
      requiresVerification: false,
    });
  } catch (error: any) {
    return authFailure(res, error, 'Chưa đăng ký được tài khoản. Vui lòng thử lại.');
  }
};

export const loginCustomer = async (req: Request, res: Response) => {
  try {
    const phone = String(req.body.SDT || '').replace(/[\s.-]/g, '');
    const password = String(req.body.MAT_KHAU || '');
    if (!phone || !password) return res.status(400).json({ message: 'Vui lòng nhập số điện thoại và mật khẩu.' });

    const customerCollection = await getCustomerCollection();
    const customer = await customerCollection.findOne({ SDT: phone });
    // Không tiết lộ số điện thoại có tồn tại hay không (KH02).
    if (!customer || !isActiveRow(customer)) {
      await audit(req, 'DANG_NHAP', 'KHACH_HANG', { LY_DO: 'Sai thông tin' }, false);
      return res.status(401).json({ message: 'Số điện thoại hoặc mật khẩu không đúng.' });
    }
    assertLoginNotLocked(customer);
    if (!await verifyPassword(password, customer.MAT_KHAU)) {
      await audit(req, 'DANG_NHAP', customer.KHACH_HANG_ID, { LY_DO: 'Sai mật khẩu' }, false);
      throw wrongPasswordError(await recordLoginFailure('KHACH_HANG', customer), 'Số điện thoại hoặc mật khẩu không đúng.');
    }
    // Tài khoản cũ còn "Chờ xác minh" (từ khi còn bắt buộc xác minh email) được kích hoạt khi đăng nhập đúng mật khẩu.
    if (/chờ xác minh/i.test(String(customer.TRANG_THAI || ''))) {
      await customerCollection.updateOne({ KHACH_HANG_ID: customer.KHACH_HANG_ID, TRANG_THAI: customer.TRANG_THAI }, { $set: { TRANG_THAI: 'Hoạt động' } });
      customer.TRANG_THAI = 'Hoạt động';
      await audit(req, 'KICH_HOAT_TAI_KHOAN', customer.KHACH_HANG_ID, { LY_DO: 'Bỏ xác minh email khi đăng ký' });
    }
    if (/khóa|ngừng|inactive/i.test(String(customer.TRANG_THAI || ''))) return res.status(403).json({ locked: true, message: 'Tài khoản đã bị khóa. Vui lòng liên hệ cửa hàng để được hỗ trợ.' });

    if (!isPasswordHash(customer.MAT_KHAU)) {
      await customerCollection.updateOne(
        { KHACH_HANG_ID: customer.KHACH_HANG_ID },
        { $set: { MAT_KHAU: await hashPassword(password) } },
      );
    }

    const orderAccess = await createCustomerOrderAccess(customer);
    req.identity = { id: customer.KHACH_HANG_ID, type: 'KHACH_HANG', account: customer, sessionId: '' };
    const lastLogin = await recordLoginSuccess('KHACH_HANG', customer, req);
    await audit(req, 'DANG_NHAP', customer.KHACH_HANG_ID);
    return res.status(200).json({
      message: 'Đăng nhập thành công.', token: orderAccess.accessToken, orderAccess, lastLogin,
      customer: sanitizeCustomer(customer),
    });
  } catch (error: any) {
    return authFailure(res, error, 'Chưa đăng nhập được. Vui lòng thử lại.');
  }
};

export const getCustomerById = async (req: Request, res: Response) => {
  try {
    await expireCustomerPoints(String(res.locals.customerId || req.params.id));
    const customer = await readCustomerById(req.params.id);

    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }

    return res.status(200).json(sanitizeCustomer(customer));
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

export const updateCustomerById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { TEN, EMAIL, SDT, DOB, GIOI_TINH } = req.body;
    const customerCollection = await getCustomerCollection();

    const existing = await customerCollection.findOne({ KHACH_HANG_ID: id });
    const same = (a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim();
    if (existing && ((EMAIL !== undefined && !same(EMAIL, existing.EMAIL)) || (SDT !== undefined && !same(SDT, existing.SDT)))) {
      return res.status(400).json({ message: 'Đổi email hoặc số điện thoại cần được xác minh riêng.' });
    }
    const name = String(TEN || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100) return res.status(400).json({ field: 'name', message: 'Vui lòng nhập họ tên (tối đa 100 ký tự).' });
    const birthDate = DOB ? toDate(DOB) : null;
    if (DOB && (!birthDate || birthDate.getTime() > Date.now() || birthDate.getFullYear() < 1900)) return res.status(400).json({ field: 'birthDate', message: 'Ngày sinh không hợp lệ.' });
    if (GIOI_TINH !== undefined && GIOI_TINH !== null && GIOI_TINH !== '' && !GENDERS.includes(String(GIOI_TINH))) return res.status(400).json({ field: 'gender', message: 'Giới tính không hợp lệ.' });
    const result = await customerCollection.findOneAndUpdate(
      { KHACH_HANG_ID: id },
      {
        $set: {
          TEN: name,
          DOB: birthDate,
          GIOI_TINH: GIOI_TINH || existing?.GIOI_TINH,
          NGAY_CAP_NHAT: new Date(),
        },
      },
      { returnDocument: 'after' },
    );

    if (!result) {
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }

    await audit(req, 'CAP_NHAT_HO_SO', id, { TRUOC: { TEN: existing?.TEN, DOB: existing?.DOB, GIOI_TINH: existing?.GIOI_TINH }, SAU: { TEN: name, DOB: birthDate, GIOI_TINH } });
    return res.status(200).json({
      message: 'Cập nhật thông tin thành công.',
      customer: sanitizeCustomer(result),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

export const getCustomerAddresses = async (req: Request, res: Response) => {
  try {
    const addressCollection = await getAddressCollection();
    const addresses = await addressCollection.find({ KHACH_HANG_ID: req.params.id }).toArray();
    const activeAddresses = addresses
      .filter(isActiveRow)
      .sort((left, right) => {
        if (Boolean(left.LA_MAC_DINH) !== Boolean(right.LA_MAC_DINH)) {
          return Boolean(left.LA_MAC_DINH) ? -1 : 1;
        }
        return String(left.DIA_CHI_ID || '').localeCompare(String(right.DIA_CHI_ID || ''), 'vi');
      });

    return res.status(200).json(activeAddresses);
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

const changeOwnedAddress = (action: 'add' | 'edit' | 'delete' | 'default') => async (req: Request, res: Response) => {
  try {
    const customerId = res.locals.orderAccess?.customerId;
    if (!customerId || res.locals.orderAccess?.authType !== 'member') throw new InventoryError(403, 'Cần đăng nhập để quản lý địa chỉ.');
    const address = await withTransaction(async session => {
      // One member document serializes concurrent default-address changes.
      const owner = await (await getCustomerCollection()).updateOne({ KHACH_HANG_ID: customerId }, { $inc: { PHIEN_BAN_DIA_CHI: 1 } }, { session });
      if (!owner.matchedCount) throw new InventoryError(404, 'Không tìm thấy tài khoản.');
      const col = await getAddressCollection();
      const current = action === 'add' ? null : await col.findOne({ DIA_CHI_ID: req.params.addressId, KHACH_HANG_ID: customerId, DA_XOA: { $nin: [true, 1] } }, { session });
      if (action !== 'add' && !current) throw new InventoryError(404, 'Không tìm thấy địa chỉ của bạn.');
      const rows = await col.find({ KHACH_HANG_ID: customerId, DA_XOA: { $nin: [true, 1] } }, { session }).sort({ DIA_CHI_ID: 1 }).toArray();
      const id = current?.DIA_CHI_ID || `DC${randomUUID().replaceAll('-', '')}`;
      if (action === 'delete') {
        await col.updateOne({ DIA_CHI_ID: id, KHACH_HANG_ID: customerId }, { $set: { DA_XOA: true, LA_MAC_DINH: false } }, { session });
        if (current.LA_MAC_DINH) {
          const replacement = rows.find(r => r.DIA_CHI_ID !== id);
          if (replacement) await col.updateOne({ DIA_CHI_ID: replacement.DIA_CHI_ID }, { $set: { LA_MAC_DINH: true } }, { session });
        }
        return null;
      }
      const data = action === 'default' ? normalizeAddressPayload(current) : normalizeAddressPayload(req.body);
      if (Object.values(data).some(v => !v || v.length > 300) || !/^\+?\d[\d\s.-]{7,19}$/.test(data.SDT_NGUOI_NHAN)) throw new InventoryError(400, 'Cần đủ địa chỉ và số điện thoại hợp lệ.');
      if (action !== 'default' && rows.some(r => r.DIA_CHI_ID !== id && isSameAddress(r, data))) throw new InventoryError(409, 'Địa chỉ này đã tồn tại.');
      const wantsDefault = action === 'default' || req.body.LA_MAC_DINH === true || req.body.LA_MAC_DINH === 1;
      const isDefault = wantsDefault || !rows.length || !!current?.LA_MAC_DINH;
      if (isDefault) await col.updateMany({ KHACH_HANG_ID: customerId, DA_XOA: { $nin: [true, 1] } }, { $set: { LA_MAC_DINH: false } }, { session });
      const next = { DIA_CHI_ID: id, KHACH_HANG_ID: customerId, ...data, LA_MAC_DINH: isDefault, DA_XOA: false };
      await col.updateOne({ DIA_CHI_ID: id, KHACH_HANG_ID: customerId }, { $set: next, ...(current ? {} : { $setOnInsert: { _id: id } }) }, { upsert: !current, session });
      return next;
    });
    return res.status(action === 'add' ? 201 : 200).json({ message: 'Đã lưu thay đổi địa chỉ.', address, addressId: address?.DIA_CHI_ID });
  } catch (e: any) {
    return res.status(e instanceof InventoryError ? e.status : 500).json({ message: e instanceof InventoryError ? e.message : 'Không thể cập nhật địa chỉ.' });
  }
};
export const addCustomerAddress = changeOwnedAddress('add');
export const updateCustomerAddress = changeOwnedAddress('edit');
export const deleteCustomerAddress = changeOwnedAddress('delete');
export const setDefaultCustomerAddress = changeOwnedAddress('default');

export const getCustomerOrders = async (req: Request, res: Response) => {
  try {
    const orderCollection = await getCollection<any>('DON_HANG');
    const orders = await orderCollection.find({ KHACH_HANG_ID: req.params.id }).toArray();
    const orderIds = orders.map(order => order.DON_HANG_ID);
    const [details, reviews] = await Promise.all([
      (await getCollection<any>('DON_HANG_CHI_TIET')).find({ DON_HANG_ID: { $in: orderIds } }).toArray(),
      (await getCollection<any>('DANH_GIA')).find({ DON_HANG_ID: { $in: orderIds } }).toArray(),
    ]);
    const productsByOrder = new Map<string, Set<string>>();
    details.forEach(row => {
      const set = productsByOrder.get(row.DON_HANG_ID) || new Set<string>(); set.add(String(row.SAN_PHAM_ID)); productsByOrder.set(row.DON_HANG_ID, set);
    });
    const reviewsByOrder = new Map<string, Set<string>>();
    reviews.forEach(row => {
      const set = reviewsByOrder.get(row.DON_HANG_ID) || new Set<string>(); set.add(String(row.SAN_PHAM_ID)); reviewsByOrder.set(row.DON_HANG_ID, set);
    });

    return res.status(200).json(
      orders
        .sort((left, right) => compareDateDesc(left.NGAY_TAO, right.NGAY_TAO))
        .map((order) => ({
          DON_HANG_ID: order.DON_HANG_ID,
          NGAY_TAO: order.NGAY_TAO,
          TAM_TINH: order.TAM_TINH,
          TONG_TIEN: order.TONG_TIEN,
          TRANG_THAI: order.TRANG_THAI,
          DANH_GIA_DA_GUI: reviewsByOrder.get(order.DON_HANG_ID)?.size || 0,
          DANH_GIA_TONG_SAN_PHAM: productsByOrder.get(order.DON_HANG_ID)?.size || 0,
        })),
    );
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

export const getCustomerVouchers = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const voucherCollection = await getCollection<any>('VOUCHER');
    const today = new Date();
    const vouchers = await voucherCollection.find({
      $or: [{ KHACH_HANG_ID: id }, { KHACH_HANG_ID: null }, { KHACH_HANG_ID: { $exists: false } }],
    }).toArray();
    const usageRows = await (await getCollection<any>('VOUCHER_SU_DUNG')).find({ DINH_DANH: `member:${id}` }).toArray();
    const usageCount = new Map<string, number>();
    usageRows.forEach(row => usageCount.set(String(row.VOUCHER_ID), (usageCount.get(String(row.VOUCHER_ID)) || 0) + 1));

    const available = vouchers.filter((voucher) => {
      const perUserLimit = Number(voucher.GIOI_HAN_MOI_NGUOI || (voucher.KHACH_HANG_ID ? 1 : 0));
      const used = usageCount.get(String(voucher.VOUCHER_ID)) || 0;
      return derivePromotionStatus(voucher, today) === 'Đang diễn ra' && (!perUserLimit || used < perUserLimit);
    }).map(voucher => ({ ...voucher, DA_DUNG: (usageCount.get(String(voucher.VOUCHER_ID)) || 0) > 0 }));
    const byCode = new Map<string, any>();

    for (const voucher of available.sort((left, right) => {
      const leftSpecific = left.KHACH_HANG_ID === id ? 0 : 1;
      const rightSpecific = right.KHACH_HANG_ID === id ? 0 : 1;
      if (leftSpecific !== rightSpecific) return leftSpecific - rightSpecific;
      const dateCompare = compareDateAsc(left.NGAY_KET_THUC, right.NGAY_KET_THUC);
      if (dateCompare !== 0) return dateCompare;
      return String(left.VOUCHER_ID || '').localeCompare(String(right.VOUCHER_ID || ''), 'vi');
    })) {
      const code = String(voucher.MA_VOUCHER || '').trim().toUpperCase();
      if (!byCode.has(code)) {
        byCode.set(code, voucher);
      }
    }

    const result = Array.from(byCode.values()).sort((left, right) => {
      const leftSpecific = left.KHACH_HANG_ID === id ? 0 : 1;
      const rightSpecific = right.KHACH_HANG_ID === id ? 0 : 1;
      if (leftSpecific !== rightSpecific) return leftSpecific - rightSpecific;
      const dateCompare = compareDateAsc(left.NGAY_KET_THUC, right.NGAY_KET_THUC);
      if (dateCompare !== 0) return dateCompare;
      return String(left.MA_VOUCHER || '').localeCompare(String(right.MA_VOUCHER || ''), 'vi');
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

export const getCustomerWishlist = async (req: Request, res: Response) => {
  try {
    const id = String(res.locals.customerId || '');
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const pageSize = Math.max(1, Math.min(500, Math.floor(Number(req.query.pageSize) || 12)));
    await ensureWishlistIndex();
    const wishlistCollection = await getCollection<any>('YEU_THICH');
    const productCollection = await getCollection<any>('SAN_PHAM');
    const allWishlist = await wishlistCollection
      .find({ KHACH_HANG_ID: id })
      .sort({ NGAY_TAO: -1, SAN_PHAM_ID: 1 })
      .toArray();
    const total = allWishlist.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const productIds = allWishlist.map((item) => item.SAN_PHAM_ID).filter(Boolean);

    if (productIds.length === 0) {
      return res.status(200).json({ items: [], page: safePage, pageSize, total, totalPages });
    }

    const [products, imageMap] = await Promise.all([
      productCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
      getPrimaryImageByProductIds(productIds),
    ]);
    const productMap = new Map(products.map((product) => [product.SAN_PHAM_ID, product]));

    const result = allWishlist.map((item) => {
        const product = productMap.get(item.SAN_PHAM_ID);
        const image = imageMap.get(item.SAN_PHAM_ID);
        if (!product) {
          return {
            SAN_PHAM_ID: item.SAN_PHAM_ID,
            TEN_SAN_PHAM: 'Sản phẩm không còn tồn tại',
            GIA: 0,
            GIA_KHUYEN_MAI: null,
            HINH_ANH: null,
            TRANG_THAI_HIEN_THI: 'Không còn truy cập được',
            CO_THE_MUA: false,
            DA_XOA: true,
            LIEN_KET_CON_HIEU_LUC: false,
            _WISHLIST_CREATED_AT: item.NGAY_TAO,
          };
        }
        const deleted = product.DA_XOA === true || product.DA_XOA === 1;
        const selling = String(product.TRANG_THAI || '').trim() === 'Đang bán';
        return {
              SAN_PHAM_ID: item.SAN_PHAM_ID,
              TEN_SAN_PHAM: product.TEN_SAN_PHAM,
              GIA: product.GIA,
              GIA_KHUYEN_MAI: product.GIA_KHUYEN_MAI,
              HINH_ANH: image?.URL || null,
              // Không suy luận khả năng đặt hàng chỉ từ tồn thành phẩm. Sản phẩm
              // đang bán vẫn đi qua luồng kho/BOM/Sales khi khách tạo đơn.
              TRANG_THAI_HIEN_THI: deleted ? 'Đã xóa' : !selling ? 'Ngừng bán' : 'Đang bán',
              CO_THE_MUA: !deleted && selling,
              DA_XOA: deleted,
              LIEN_KET_CON_HIEU_LUC: !deleted,
              _WISHLIST_CREATED_AT: item.NGAY_TAO,
            };
      });

    result.sort((left, right) => {
      const purchaseCompare = Number(right.CO_THE_MUA) - Number(left.CO_THE_MUA);
      if (purchaseCompare !== 0) return purchaseCompare;
      const dateCompare = compareDateDesc(left._WISHLIST_CREATED_AT, right._WISHLIST_CREATED_AT);
      return dateCompare || String(left.SAN_PHAM_ID).localeCompare(String(right.SAN_PHAM_ID), 'vi');
    });
    const pageItems = result
      .slice((safePage - 1) * pageSize, safePage * pageSize)
      .map(({ _WISHLIST_CREATED_AT, ...item }) => item);

    return res.status(200).json({ items: pageItems, page: safePage, pageSize, total, totalPages });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

export const updateCustomerAvatar = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: 'Chưa chọn ảnh.' });
    }

    const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const avatarUrl = `${publicBaseUrl}/uploads/account/${req.file.filename}`;
    const customerCollection = await getCustomerCollection();
    const customer = await customerCollection.findOneAndUpdate(
      { KHACH_HANG_ID: id },
      { $set: { AVATAR: avatarUrl } },
      { returnDocument: 'after' },
    );

    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }

    return res.status(200).json({
      message: 'Cập nhật avatar thành công.',
      customer: sanitizeCustomer(customer),
    });
  } catch (_error: any) {
    return res.status(500).json({ message: 'Không thể cập nhật avatar.' });
  }
};

export const removeCustomerAvatar = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const customerCollection = await getCustomerCollection();
    const customer = await customerCollection.findOneAndUpdate(
      { KHACH_HANG_ID: id },
      { $set: { AVATAR: null } },
      { returnDocument: 'after' },
    );

    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }

    return res.status(200).json({
      message: 'Đã gỡ ảnh đại diện.',
      customer: sanitizeCustomer(customer),
    });
  } catch (_error: any) {
    return res.status(500).json({ message: 'Không thể gỡ ảnh đại diện.' });
  }
};

export const addWishlistItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(res.locals.customerId || '');
    const productId = String(req.params.productId || '').trim();

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu mã khách hàng hoặc mã sản phẩm.' });
    }

    await ensureWishlistIndex();
    const [productCollection, wishlistCollection] = await Promise.all([
      getCollection<any>('SAN_PHAM'),
      getCollection<any>('YEU_THICH'),
    ]);

    if (!await productCollection.findOne(
      { SAN_PHAM_ID: productId, DA_XOA: { $nin: [true, 1] } },
      { projection: { SAN_PHAM_ID: 1 } },
    )) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    }

    await wishlistCollection.updateOne(
      { KHACH_HANG_ID: customerId, SAN_PHAM_ID: productId },
      {
        $setOnInsert: {
          _id: { KHACH_HANG_ID: customerId, SAN_PHAM_ID: productId },
          KHACH_HANG_ID: customerId,
          SAN_PHAM_ID: productId,
          NGAY_TAO: new Date(),
        },
      },
      { upsert: true },
    );

    return res.status(200).json({ message: 'Đã thêm vào danh sách yêu thích' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const removeWishlistItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(res.locals.customerId || '');
    const productId = String(req.params.productId || '').trim();
    const wishlistCollection = await getCollection<any>('YEU_THICH');
    await wishlistCollection.deleteOne({ KHACH_HANG_ID: customerId, SAN_PHAM_ID: productId });

    return res.status(200).json({ message: 'Đã xóa khỏi danh sách yêu thích' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

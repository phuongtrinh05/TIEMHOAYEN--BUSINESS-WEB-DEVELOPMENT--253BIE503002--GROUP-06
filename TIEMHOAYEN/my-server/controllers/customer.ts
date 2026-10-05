import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';
import { hashPassword, isPasswordHash, verifyPassword } from '../utils/passwordHash.js';

const otpStore = new Map<string, string>();

const normalizeAddressText = (value: unknown): string => {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
};

const sanitizeCustomer = (customer: any) => {
  if (!customer) {
    return customer;
  }

  const { MAT_KHAU, ...safeCustomer } = customer;
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

export const registerCustomer = async (req: Request, res: Response) => {
  try {
    const { TEN, GIOI_TINH, SDT, EMAIL, MAT_KHAU } = req.body;

    if (!TEN || !SDT || !MAT_KHAU || !GIOI_TINH) {
      return res.status(400).json({ message: 'Thiếu thông tin bắt buộc.' });
    }

    const customerCollection = await getCustomerCollection();
    const phone = String(SDT).trim();
    const emailValue = EMAIL && String(EMAIL).trim() !== '' ? String(EMAIL).trim() : null;

    if (await customerCollection.findOne({ SDT: phone })) {
      return res.status(409).json({
        field: 'phone',
        message: 'Số điện thoại đã được đăng ký.',
      });
    }

    if (emailValue && await customerCollection.findOne({ EMAIL: emailValue })) {
      return res.status(409).json({
        field: 'email',
        message: 'Email đã được đăng ký.',
      });
    }

    const newId = await getNextPrefixedId('KHACH_HANG', 'KHACH_HANG_ID', 'CUST', 4);
    const customer = {
      _id: newId,
      KHACH_HANG_ID: newId,
      TEN: String(TEN).trim(),
      EMAIL: emailValue,
      SDT: phone,
      MAT_KHAU: await hashPassword(String(MAT_KHAU)),
      DOB: null,
      GIOI_TINH: String(GIOI_TINH).trim(),
      NGAY_DANG_KY: new Date(),
      LOAI_THANH_VIEN: 'Thành viên',
      DIEM_TICH_LUY: 0,
      AVATAR: null,
      TRANG_THAI: 'Hoạt động',
      DA_XOA: false,
    };

    await customerCollection.insertOne(customer);

    return res.status(201).json({
      message: 'Đăng ký thành công',
      customer: sanitizeCustomer(customer),
    });
  } catch (error: any) {
    console.error('Lỗi registerCustomer:', error.message);
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

export const loginCustomer = async (req: Request, res: Response) => {
  try {
    const { SDT, MAT_KHAU } = req.body;

    if (!SDT || !MAT_KHAU) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ thông tin.' });
    }

    const customerCollection = await getCustomerCollection();
    const customer = await customerCollection.findOne({ SDT: String(SDT).trim() });

    if (!customer) {
      return res.status(404).json({ message: 'Số điện thoại không tồn tại.' });
    }

    const isValidPassword = await verifyPassword(String(MAT_KHAU), customer.MAT_KHAU);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Mật khẩu không chính xác.' });
    }

    if (!isPasswordHash(customer.MAT_KHAU)) {
      await customerCollection.updateOne(
        { KHACH_HANG_ID: customer.KHACH_HANG_ID },
        { $set: { MAT_KHAU: await hashPassword(String(MAT_KHAU)) } },
      );
    }

    return res.status(200).json({
      message: 'Đăng nhập thành công.',
      customer: sanitizeCustomer(customer),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { SDT, NEW_PASSWORD } = req.body;

    if (!SDT || !NEW_PASSWORD) {
      return res.status(400).json({ message: 'Thiếu thông tin.' });
    }

    const customerCollection = await getCustomerCollection();
    const customer = await customerCollection.findOne({ SDT: String(SDT).trim() });

    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });
    }

    await customerCollection.updateOne(
      { KHACH_HANG_ID: customer.KHACH_HANG_ID },
      { $set: { MAT_KHAU: await hashPassword(String(NEW_PASSWORD)) } },
    );

    return res.status(200).json({ message: 'Đổi mật khẩu thành công.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

export const sendOtp = async (req: Request, res: Response) => {
  try {
    const { SDT } = req.body;
    const customerCollection = await getCustomerCollection();
    const customer = await customerCollection.findOne({ SDT: String(SDT || '').trim() });

    if (!customer) {
      return res.status(404).json({ message: 'Số điện thoại không tồn tại' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(String(SDT).trim(), otp);
    console.log('OTP:', otp);

    return res.status(200).json({ message: 'Đã gửi OTP' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { SDT, OTP } = req.body;
    const savedOtp = otpStore.get(String(SDT || '').trim());

    if (savedOtp !== String(OTP || '').trim()) {
      return res.status(400).json({ message: 'OTP không đúng' });
    }

    return res.status(200).json({ message: 'OTP hợp lệ' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const getCustomerById = async (req: Request, res: Response) => {
  try {
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

    const result = await customerCollection.findOneAndUpdate(
      { KHACH_HANG_ID: id },
      {
        $set: {
          TEN,
          EMAIL: EMAIL || null,
          SDT,
          DOB: DOB || null,
          GIOI_TINH,
        },
      },
      { returnDocument: 'after' },
    );

    if (!result) {
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }

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

export const addCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const addressCollection = await getAddressCollection();
    const normalizedAddress = normalizeAddressPayload(req.body);
    const activeAddresses = (await addressCollection.find({ KHACH_HANG_ID: id }).toArray()).filter(isActiveRow);

    if (activeAddresses.some((address) => isSameAddress(address, normalizedAddress))) {
      return res.status(409).json({ message: 'Địa chỉ này đã tồn tại.' });
    }

    const newId = await getNextPrefixedId('DIA_CHI_GIAO_HANG', 'DIA_CHI_ID', 'DC', 4);
    const isDefaultAddress = Boolean(req.body.LA_MAC_DINH) || activeAddresses.length === 0;

    if (isDefaultAddress) {
      await addressCollection.updateMany(
        { KHACH_HANG_ID: id, DA_XOA: { $ne: true } },
        { $set: { LA_MAC_DINH: false } },
      );
    }

    await addressCollection.insertOne({
      _id: newId,
      DIA_CHI_ID: newId,
      KHACH_HANG_ID: id,
      ...normalizedAddress,
      LA_MAC_DINH: isDefaultAddress,
      DA_XOA: false,
    });

    return res.status(201).json({ message: 'Thêm địa chỉ thành công' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const deleteCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const addressCollection = await getAddressCollection();
    const address = await addressCollection.findOne({ DIA_CHI_ID: addressId });

    if (!address) {
      return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    }

    if (address.LA_MAC_DINH) {
      const replacement = await addressCollection.findOne(
        {
          KHACH_HANG_ID: address.KHACH_HANG_ID,
          DIA_CHI_ID: { $ne: addressId },
          DA_XOA: { $ne: true },
        },
        { sort: { DIA_CHI_ID: 1 } },
      );

      if (replacement) {
        await addressCollection.updateOne(
          { DIA_CHI_ID: replacement.DIA_CHI_ID },
          { $set: { LA_MAC_DINH: true } },
        );
      }
    }

    await addressCollection.updateOne(
      { DIA_CHI_ID: addressId },
      { $set: { DA_XOA: true, LA_MAC_DINH: false } },
    );

    return res.status(200).json({ message: 'Xóa địa chỉ thành công.' });
  } catch (_error: any) {
    return res.status(500).json({ message: 'Đã xảy ra lỗi. Vui lòng thử lại sau.' });
  }
};

export const updateCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const addressCollection = await getAddressCollection();
    const address = await addressCollection.findOne({ DIA_CHI_ID: addressId, DA_XOA: { $ne: true } });

    if (!address) {
      return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    }

    const normalizedAddress = normalizeAddressPayload(req.body);
    const activeAddresses = (await addressCollection.find({ KHACH_HANG_ID: address.KHACH_HANG_ID }).toArray())
      .filter((item) => isActiveRow(item) && item.DIA_CHI_ID !== addressId);

    if (activeAddresses.some((item) => isSameAddress(item, normalizedAddress))) {
      return res.status(409).json({ message: 'Địa chỉ này đã tồn tại.' });
    }

    const isDefault = Boolean(req.body.LA_MAC_DINH);
    if (isDefault) {
      await addressCollection.updateMany(
        { KHACH_HANG_ID: address.KHACH_HANG_ID, DA_XOA: { $ne: true } },
        { $set: { LA_MAC_DINH: false } },
      );
    }

    await addressCollection.updateOne(
      { DIA_CHI_ID: addressId },
      { $set: { ...normalizedAddress, LA_MAC_DINH: isDefault } },
    );

    return res.status(200).json({ message: 'Cập nhật địa chỉ thành công.' });
  } catch (_error: any) {
    return res.status(500).json({ message: 'Không thể cập nhật địa chỉ.' });
  }
};

export const setDefaultCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const addressCollection = await getAddressCollection();
    const address = await addressCollection.findOne({ DIA_CHI_ID: addressId, DA_XOA: { $ne: true } });

    if (!address) {
      return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    }

    await addressCollection.updateMany(
      { KHACH_HANG_ID: address.KHACH_HANG_ID, DA_XOA: { $ne: true } },
      { $set: { LA_MAC_DINH: false } },
    );
    await addressCollection.updateOne(
      { DIA_CHI_ID: addressId },
      { $set: { LA_MAC_DINH: true } },
    );

    return res.status(200).json({ message: 'Đã đặt địa chỉ mặc định.' });
  } catch (_error: any) {
    return res.status(500).json({ message: 'Không thể đặt địa chỉ mặc định.' });
  }
};

export const getCustomerOrders = async (req: Request, res: Response) => {
  try {
    const orderCollection = await getCollection<any>('DON_HANG');
    const orders = await orderCollection.find({ KHACH_HANG_ID: req.params.id }).toArray();

    return res.status(200).json(
      orders
        .sort((left, right) => compareDateDesc(left.NGAY_TAO, right.NGAY_TAO))
        .map((order) => ({
          DON_HANG_ID: order.DON_HANG_ID,
          NGAY_TAO: order.NGAY_TAO,
          TAM_TINH: order.TAM_TINH,
          TONG_TIEN: order.TONG_TIEN,
          TRANG_THAI: order.TRANG_THAI,
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
      DA_DUNG: { $ne: true },
    }).toArray();

    const available = vouchers.filter((voucher) => {
      const start = toDate(voucher.NGAY_BAT_DAU);
      const end = toDate(voucher.NGAY_KET_THUC);
      return (!start || today >= start) && (!end || today <= end);
    });
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
    const { id } = req.params;
    const wishlistCollection = await getCollection<any>('YEU_THICH');
    const productCollection = await getCollection<any>('SAN_PHAM');
    const wishlist = await wishlistCollection.find({ KHACH_HANG_ID: id }).toArray();
    const productIds = wishlist.map((item) => item.SAN_PHAM_ID).filter(Boolean);

    if (productIds.length === 0) {
      return res.status(200).json([]);
    }

    const [products, imageMap] = await Promise.all([
      productCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
      getPrimaryImageByProductIds(productIds),
    ]);
    const productMap = new Map(products.map((product) => [product.SAN_PHAM_ID, product]));

    const result = wishlist
      .sort((left, right) => compareDateDesc(left.NGAY_TAO, right.NGAY_TAO))
      .map((item) => {
        const product = productMap.get(item.SAN_PHAM_ID);
        const image = imageMap.get(item.SAN_PHAM_ID);
        return product
          ? {
              SAN_PHAM_ID: item.SAN_PHAM_ID,
              TEN_SAN_PHAM: product.TEN_SAN_PHAM,
              GIA: product.GIA,
              GIA_KHUYEN_MAI: product.GIA_KHUYEN_MAI,
              HINH_ANH: image?.URL || null,
            }
          : null;
      })
      .filter(Boolean);

    return res.status(200).json(result);
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
    const { customerId, productId } = req.params;

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu mã khách hàng hoặc mã sản phẩm.' });
    }

    const [customerCollection, productCollection, wishlistCollection] = await Promise.all([
      getCustomerCollection(),
      getCollection<any>('SAN_PHAM'),
      getCollection<any>('YEU_THICH'),
    ]);

    if (!await customerCollection.findOne({ KHACH_HANG_ID: customerId }, { projection: { KHACH_HANG_ID: 1 } })) {
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }

    if (!await productCollection.findOne({ SAN_PHAM_ID: productId }, { projection: { SAN_PHAM_ID: 1 } })) {
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

    return res.status(201).json({ message: 'Đã thêm vào danh sách yêu thích' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const removeWishlistItem = async (req: Request, res: Response) => {
  try {
    const { customerId, productId } = req.params;
    const wishlistCollection = await getCollection<any>('YEU_THICH');
    await wishlistCollection.deleteOne({ KHACH_HANG_ID: customerId, SAN_PHAM_ID: productId });

    return res.status(200).json({ message: 'Đã xóa khỏi danh sách yêu thích' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

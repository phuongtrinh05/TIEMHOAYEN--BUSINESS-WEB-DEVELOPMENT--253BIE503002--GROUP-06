import { Request, Response } from 'express';
import { connectDB, sql } from '../db.js';
const otpStore = new Map<string, string>();

const normalizeAddressText = (value: unknown): string => {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
};

export const getAllCustomers = async (req: Request, res: Response) => {
  try {
    const pool = await connectDB();
    const result = await pool.request()
      .query('SELECT * FROM KHACH_HANG');
    res.status(200).json(result.recordset);
  } catch (error: any) {
    res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

export const registerCustomer = async (req: Request, res: Response) => {
  try {
    const { TEN, GIOI_TINH, SDT, EMAIL, MAT_KHAU } = req.body;

    console.log('BODY nhận được:', req.body);

    if (!TEN || !SDT || !MAT_KHAU || !GIOI_TINH) {
      return res.status(400).json({ message: 'Thiếu thông tin bắt buộc.' });
    }

    const emailValue = EMAIL && EMAIL.trim() !== '' ? EMAIL.trim() : null;
    const pool = await connectDB();

    const phoneCheck = await pool.request()
      .input('SDT', sql.NVarChar, SDT)
      .query('SELECT 1 AS found FROM KHACH_HANG WHERE SDT = @SDT');

    if (phoneCheck.recordset.length > 0) {
      return res.status(409).json({
        field: 'phone',
        message: 'Số điện thoại đã được đăng ký.'
      });
    }

    if (emailValue) {
      const emailCheck = await pool.request()
        .input('EMAIL', sql.NVarChar, emailValue)
        .query('SELECT 1 AS found FROM KHACH_HANG WHERE EMAIL = @EMAIL');

      if (emailCheck.recordset.length > 0) {
        return res.status(409).json({
          field: 'email',
          message: 'Email đã được đăng ký.'
        });
      }
    }

    const idCheck = await pool.request()
      .query(`
                SELECT TOP 1 KHACH_HANG_ID 
                FROM KHACH_HANG 
                ORDER BY KHACH_HANG_ID DESC
            `);

    let newId = 'CUST0001';
    if (idCheck.recordset.length > 0) {
      const lastId = idCheck.recordset[0].KHACH_HANG_ID as string;
      const lastNum = parseInt(lastId.replace('CUST', ''));
      const nextNum = lastNum + 1;
      newId = 'CUST' + nextNum.toString().padStart(4, '0');
    }

    await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, newId)
      .input('TEN', sql.NVarChar, TEN)
      .input('EMAIL', sql.NVarChar, emailValue)
      .input('SDT', sql.NVarChar, SDT)
      .input('MAT_KHAU', sql.NVarChar, MAT_KHAU)
      .input('GIOI_TINH', sql.NVarChar, GIOI_TINH)
      .query(`
                INSERT INTO KHACH_HANG (
                    KHACH_HANG_ID, TEN, EMAIL, SDT,
                    MAT_KHAU, GIOI_TINH,
                    LOAI_THANH_VIEN, DIEM_TICH_LUY,
                    NGAY_DANG_KY
                )
                VALUES (
                    @KHACH_HANG_ID, @TEN, @EMAIL, @SDT,
                    @MAT_KHAU, @GIOI_TINH,
                    N'Thành viên', 0,
                    GETDATE()
                )
            `);

    const customerResult = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, newId)
      .query(`
        SELECT *
        FROM KHACH_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
    `);

    return res.status(201).json({
      message: 'Đăng ký thành công',
      customer: customerResult.recordset[0]
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
      return res.status(400).json({
        message: 'Vui lòng nhập đầy đủ thông tin.'
      });
    }

    const pool = await connectDB();

    const phoneResult = await pool.request()
      .input('SDT', sql.NVarChar, SDT)
      .query(`
                SELECT *
                FROM KHACH_HANG
                WHERE SDT = @SDT
            `);

    if (phoneResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Số điện thoại không tồn tại.'
      });
    }

    const customer = phoneResult.recordset[0];

    if (customer.MAT_KHAU !== MAT_KHAU) {
      return res.status(401).json({
        message: 'Mật khẩu không chính xác.'
      });
    }

    return res.status(200).json({
      message: 'Đăng nhập thành công.',
      customer
    });

  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi server: ' + error.message
    });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { SDT, NEW_PASSWORD } = req.body;

    if (!SDT || !NEW_PASSWORD) {
      return res.status(400).json({
        message: 'Thiếu thông tin.'
      });
    }

    const pool = await connectDB();

    const checkCustomer = await pool.request()
      .input('SDT', sql.NVarChar, SDT)
      .query(`
                SELECT *
                FROM KHACH_HANG
                WHERE SDT = @SDT
            `);

    if (checkCustomer.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy tài khoản.'
      });
    }

    await pool.request()
      .input('SDT', sql.NVarChar, SDT)
      .input('MAT_KHAU', sql.NVarChar, NEW_PASSWORD)
      .query(`
                UPDATE KHACH_HANG
                SET MAT_KHAU = @MAT_KHAU
                WHERE SDT = @SDT
            `);

    return res.status(200).json({
      message: 'Đổi mật khẩu thành công.'
    });

  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi server: ' + error.message
    });
  }
};

export const sendOtp = async (req: Request, res: Response) => {
  try {
    const { SDT } = req.body;
    const pool = await connectDB();

    const result = await pool.request()
      .input('SDT', sql.NVarChar, SDT)
      .query(`
        SELECT *
        FROM KHACH_HANG
        WHERE SDT = @SDT
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: 'Số điện thoại không tồn tại'
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(SDT, otp);
    console.log('OTP:', otp);

    return res.status(200).json({
      message: 'Đã gửi OTP'
    });

  } catch (error: any) {
    return res.status(500).json({
      message: error.message
    });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { SDT, OTP } = req.body;
    const savedOtp = otpStore.get(SDT);

    if (savedOtp !== OTP) {
      return res.status(400).json({
        message: 'OTP không đúng'
      });
    }

    return res.status(200).json({
      message: 'OTP hợp lệ'
    });

  } catch (error: any) {
    return res.status(500).json({
      message: error.message
    });
  }
};

export const getCustomerById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .query('SELECT * FROM KHACH_HANG WHERE KHACH_HANG_ID = @KHACH_HANG_ID');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }

    return res.status(200).json(result.recordset[0]);
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

export const updateCustomerById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { TEN, EMAIL, SDT, DOB, GIOI_TINH } = req.body;

    const pool = await connectDB();

    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .input('TEN', sql.NVarChar, TEN)
      .input('EMAIL', sql.NVarChar, EMAIL || null)
      .input('SDT', sql.NVarChar, SDT)
      .input('DOB', sql.Date, DOB || null)
      .input('GIOI_TINH', sql.NVarChar, GIOI_TINH)
      .query(`
                UPDATE KHACH_HANG
                SET
                    TEN = @TEN,
                    EMAIL = @EMAIL,
                    SDT = @SDT,
                    DOB = @DOB,
                    GIOI_TINH = @GIOI_TINH
                WHERE KHACH_HANG_ID = @KHACH_HANG_ID;

                SELECT *
                FROM KHACH_HANG
                WHERE KHACH_HANG_ID = @KHACH_HANG_ID;
            `);

    return res.status(200).json({
      message: 'Cập nhật thông tin thành công.',
      customer: result.recordset[0]
    });

  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi server: ' + error.message
    });
  }
};

export const getCustomerAddresses = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .query(`
        SELECT *
        FROM DIA_CHI_GIAO_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
          AND DA_XOA = 0
        ORDER BY LA_MAC_DINH DESC, DIA_CHI_ID ASC
      `);

    return res.status(200).json(result.recordset);
  } catch (error: any) {
    return res.status(500).json({ message: 'Lỗi server: ' + error.message });
  }
};

export const addCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const {
      TEN_NGUOI_NHAN,
      SDT_NGUOI_NHAN,
      TINH_THANH,
      QUAN_HUYEN,
      PHUONG_XA,
      DIA_CHI_CHI_TIET,
      LA_MAC_DINH
    } = req.body;

    const pool = await connectDB();
    const normalizedAddress = {
      TEN_NGUOI_NHAN: normalizeAddressText(TEN_NGUOI_NHAN),
      SDT_NGUOI_NHAN: normalizeAddressText(SDT_NGUOI_NHAN),
      TINH_THANH: normalizeAddressText(TINH_THANH),
      QUAN_HUYEN: normalizeAddressText(QUAN_HUYEN),
      PHUONG_XA: normalizeAddressText(PHUONG_XA),
      DIA_CHI_CHI_TIET: normalizeAddressText(DIA_CHI_CHI_TIET)
    };

    const duplicateAddressResult = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .input('TEN_NGUOI_NHAN', sql.NVarChar, normalizedAddress.TEN_NGUOI_NHAN)
      .input('SDT_NGUOI_NHAN', sql.NVarChar, normalizedAddress.SDT_NGUOI_NHAN)
      .input('TINH_THANH', sql.NVarChar, normalizedAddress.TINH_THANH)
      .input('QUAN_HUYEN', sql.NVarChar, normalizedAddress.QUAN_HUYEN)
      .input('PHUONG_XA', sql.NVarChar, normalizedAddress.PHUONG_XA)
      .input('DIA_CHI_CHI_TIET', sql.NVarChar, normalizedAddress.DIA_CHI_CHI_TIET)
      .query(`
        SELECT TOP 1 DIA_CHI_ID
        FROM DIA_CHI_GIAO_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
          AND DA_XOA = 0
          AND LTRIM(RTRIM(ISNULL(TEN_NGUOI_NHAN, N''))) = @TEN_NGUOI_NHAN
          AND LTRIM(RTRIM(ISNULL(SDT_NGUOI_NHAN, N''))) = @SDT_NGUOI_NHAN
          AND LTRIM(RTRIM(ISNULL(TINH_THANH, N''))) = @TINH_THANH
          AND LTRIM(RTRIM(ISNULL(QUAN_HUYEN, N''))) = @QUAN_HUYEN
          AND LTRIM(RTRIM(ISNULL(PHUONG_XA, N''))) = @PHUONG_XA
          AND LTRIM(RTRIM(ISNULL(DIA_CHI_CHI_TIET, N''))) = @DIA_CHI_CHI_TIET
      `);

    if (duplicateAddressResult.recordset.length > 0) {
      return res.status(409).json({
        message: 'Địa chỉ này đã tồn tại.'
      });
    }

    const idResult = await pool.request().query(`
      SELECT TOP 1 DIA_CHI_ID
      FROM DIA_CHI_GIAO_HANG
      ORDER BY DIA_CHI_ID DESC
    `);

    let newId = 'DC0001';

    if (idResult.recordset.length > 0) {
      const lastId = idResult.recordset[0].DIA_CHI_ID;
      const nextNum = parseInt(lastId.replace('DC', '')) + 1;
      newId = 'DC' + nextNum.toString().padStart(4, '0');
    }
    const activeAddressResult = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .query(`
        SELECT COUNT(*) AS total
        FROM DIA_CHI_GIAO_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
          AND DA_XOA = 0
      `);

    const hasActiveAddress = activeAddressResult.recordset[0].total > 0;
    const isDefaultAddress = LA_MAC_DINH || !hasActiveAddress;
    if (isDefaultAddress) {
      await pool.request()
        .input('KHACH_HANG_ID', sql.NVarChar, id)
        .query(`
          UPDATE DIA_CHI_GIAO_HANG
          SET LA_MAC_DINH = 0
          WHERE KHACH_HANG_ID = @KHACH_HANG_ID
        `);
    }

    await pool.request()
      .input('DIA_CHI_ID', sql.NVarChar, newId)
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .input('TEN_NGUOI_NHAN', sql.NVarChar, normalizedAddress.TEN_NGUOI_NHAN)
      .input('SDT_NGUOI_NHAN', sql.NVarChar, normalizedAddress.SDT_NGUOI_NHAN)
      .input('TINH_THANH', sql.NVarChar, normalizedAddress.TINH_THANH)
      .input('QUAN_HUYEN', sql.NVarChar, normalizedAddress.QUAN_HUYEN)
      .input('PHUONG_XA', sql.NVarChar, normalizedAddress.PHUONG_XA)
      .input('DIA_CHI_CHI_TIET', sql.NVarChar, normalizedAddress.DIA_CHI_CHI_TIET)
      .input('LA_MAC_DINH', sql.Bit, isDefaultAddress)
      .query(`
        INSERT INTO DIA_CHI_GIAO_HANG
        (
          DIA_CHI_ID,
          KHACH_HANG_ID,
          TEN_NGUOI_NHAN,
          SDT_NGUOI_NHAN,
          TINH_THANH,
          QUAN_HUYEN,
          PHUONG_XA,
          DIA_CHI_CHI_TIET,
          LA_MAC_DINH,
          DA_XOA
        )
        VALUES
        (
          @DIA_CHI_ID,
          @KHACH_HANG_ID,
          @TEN_NGUOI_NHAN,
          @SDT_NGUOI_NHAN,
          @TINH_THANH,
          @QUAN_HUYEN,
          @PHUONG_XA,
          @DIA_CHI_CHI_TIET,
          @LA_MAC_DINH,
          0
        )
      `);

    res.status(201).json({
      message: 'Thêm địa chỉ thành công'
    });

  } catch (error: any) {
    res.status(500).json({
      message: error.message
    });
  }
};

export const deleteCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const pool = await connectDB();

    const addressResult = await pool.request()
      .input('DIA_CHI_ID', sql.NVarChar, addressId)
      .query(`
        SELECT *
        FROM DIA_CHI_GIAO_HANG
        WHERE DIA_CHI_ID = @DIA_CHI_ID
      `);

    if (addressResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy địa chỉ.'
      });
    }

    const address = addressResult.recordset[0];

    if (address.LA_MAC_DINH) {
      const anotherAddressResult = await pool.request()
        .input('KHACH_HANG_ID', sql.NVarChar, address.KHACH_HANG_ID)
        .input('DIA_CHI_ID', sql.NVarChar, addressId)
        .query(`
          SELECT TOP 1 DIA_CHI_ID
          FROM DIA_CHI_GIAO_HANG
          WHERE KHACH_HANG_ID = @KHACH_HANG_ID
            AND DIA_CHI_ID <> @DIA_CHI_ID
            AND DA_XOA = 0
          ORDER BY DIA_CHI_ID ASC
        `);

      if (anotherAddressResult.recordset.length > 0) {
        const nextDefaultId = anotherAddressResult.recordset[0].DIA_CHI_ID;

        await pool.request()
          .input('DIA_CHI_ID', sql.NVarChar, nextDefaultId)
          .query(`
            UPDATE DIA_CHI_GIAO_HANG
            SET LA_MAC_DINH = 1
            WHERE DIA_CHI_ID = @DIA_CHI_ID
          `);
      }
    }

    await pool.request()
      .input('DIA_CHI_ID', sql.NVarChar, addressId)
      .query(`
        UPDATE DIA_CHI_GIAO_HANG
        SET 
          DA_XOA = 1,
          LA_MAC_DINH = 0
        WHERE DIA_CHI_ID = @DIA_CHI_ID
      `);

    return res.status(200).json({
      message: 'Xóa địa chỉ thành công.'
    });

  } catch (error: any) {

    return res.status(500).json({
      message: 'Đã xảy ra lỗi. Vui lòng thử lại sau.'
    });
  }
};
export const updateCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;

    const {
      TEN_NGUOI_NHAN,
      SDT_NGUOI_NHAN,
      TINH_THANH,
      QUAN_HUYEN,
      PHUONG_XA,
      DIA_CHI_CHI_TIET,
      LA_MAC_DINH
    } = req.body;

    const pool = await connectDB();
    const addressResult = await pool.request()
      .input('DIA_CHI_ID', sql.NVarChar, addressId)
      .query(`
        SELECT KHACH_HANG_ID
        FROM DIA_CHI_GIAO_HANG
        WHERE DIA_CHI_ID = @DIA_CHI_ID
          AND DA_XOA = 0
      `);

    if (addressResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy địa chỉ.'
      });
    }

    const customerId = addressResult.recordset[0].KHACH_HANG_ID;
    const normalizedAddress = {
      TEN_NGUOI_NHAN: normalizeAddressText(TEN_NGUOI_NHAN),
      SDT_NGUOI_NHAN: normalizeAddressText(SDT_NGUOI_NHAN),
      TINH_THANH: normalizeAddressText(TINH_THANH),
      QUAN_HUYEN: normalizeAddressText(QUAN_HUYEN),
      PHUONG_XA: normalizeAddressText(PHUONG_XA),
      DIA_CHI_CHI_TIET: normalizeAddressText(DIA_CHI_CHI_TIET)
    };

    const duplicateAddressResult = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, customerId)
      .input('DIA_CHI_ID', sql.NVarChar, addressId)
      .input('TEN_NGUOI_NHAN', sql.NVarChar, normalizedAddress.TEN_NGUOI_NHAN)
      .input('SDT_NGUOI_NHAN', sql.NVarChar, normalizedAddress.SDT_NGUOI_NHAN)
      .input('TINH_THANH', sql.NVarChar, normalizedAddress.TINH_THANH)
      .input('QUAN_HUYEN', sql.NVarChar, normalizedAddress.QUAN_HUYEN)
      .input('PHUONG_XA', sql.NVarChar, normalizedAddress.PHUONG_XA)
      .input('DIA_CHI_CHI_TIET', sql.NVarChar, normalizedAddress.DIA_CHI_CHI_TIET)
      .query(`
        SELECT TOP 1 DIA_CHI_ID
        FROM DIA_CHI_GIAO_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
          AND DIA_CHI_ID <> @DIA_CHI_ID
          AND DA_XOA = 0
          AND LTRIM(RTRIM(ISNULL(TEN_NGUOI_NHAN, N''))) = @TEN_NGUOI_NHAN
          AND LTRIM(RTRIM(ISNULL(SDT_NGUOI_NHAN, N''))) = @SDT_NGUOI_NHAN
          AND LTRIM(RTRIM(ISNULL(TINH_THANH, N''))) = @TINH_THANH
          AND LTRIM(RTRIM(ISNULL(QUAN_HUYEN, N''))) = @QUAN_HUYEN
          AND LTRIM(RTRIM(ISNULL(PHUONG_XA, N''))) = @PHUONG_XA
          AND LTRIM(RTRIM(ISNULL(DIA_CHI_CHI_TIET, N''))) = @DIA_CHI_CHI_TIET
      `);

    if (duplicateAddressResult.recordset.length > 0) {
      return res.status(409).json({
        message: 'Địa chỉ này đã tồn tại.'
      });
    }

    if (LA_MAC_DINH) {
      await pool.request()
        .input('KHACH_HANG_ID', sql.NVarChar, customerId)
        .query(`
          UPDATE DIA_CHI_GIAO_HANG
          SET LA_MAC_DINH = 0
          WHERE KHACH_HANG_ID = @KHACH_HANG_ID
          AND DA_XOA = 0
        `);
    }

    await pool.request()
      .input('DIA_CHI_ID', sql.NVarChar, addressId)
      .input('TEN_NGUOI_NHAN', sql.NVarChar, normalizedAddress.TEN_NGUOI_NHAN)
      .input('SDT_NGUOI_NHAN', sql.NVarChar, normalizedAddress.SDT_NGUOI_NHAN)
      .input('TINH_THANH', sql.NVarChar, normalizedAddress.TINH_THANH)
      .input('QUAN_HUYEN', sql.NVarChar, normalizedAddress.QUAN_HUYEN)
      .input('PHUONG_XA', sql.NVarChar, normalizedAddress.PHUONG_XA)
      .input('DIA_CHI_CHI_TIET', sql.NVarChar, normalizedAddress.DIA_CHI_CHI_TIET)
      .input('LA_MAC_DINH', sql.Bit, LA_MAC_DINH)
      .query(`
        UPDATE DIA_CHI_GIAO_HANG
        SET
          TEN_NGUOI_NHAN = @TEN_NGUOI_NHAN,
          SDT_NGUOI_NHAN = @SDT_NGUOI_NHAN,
          TINH_THANH = @TINH_THANH,
          QUAN_HUYEN = @QUAN_HUYEN,
          PHUONG_XA = @PHUONG_XA,
          DIA_CHI_CHI_TIET = @DIA_CHI_CHI_TIET,
          LA_MAC_DINH = @LA_MAC_DINH
        WHERE DIA_CHI_ID = @DIA_CHI_ID
        AND DA_XOA = 0
      `);

    return res.status(200).json({
      message: 'Cập nhật địa chỉ thành công.'
    });

  } catch (error: any) {
    return res.status(500).json({
      message: 'Không thể cập nhật địa chỉ.'
    });
  }
};
export const setDefaultCustomerAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const pool = await connectDB();

    const addressResult = await pool.request()
      .input('DIA_CHI_ID', sql.NVarChar, addressId)
      .query(`
        SELECT KHACH_HANG_ID
        FROM DIA_CHI_GIAO_HANG
        WHERE DIA_CHI_ID = @DIA_CHI_ID
        AND DA_XOA = 0
      `);

    if (addressResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy địa chỉ.'
      });
    }

    const customerId = addressResult.recordset[0].KHACH_HANG_ID;

    await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, customerId)
      .query(`
        UPDATE DIA_CHI_GIAO_HANG
        SET LA_MAC_DINH = 0
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
        AND DA_XOA = 0
      `);

    await pool.request()
      .input('DIA_CHI_ID', sql.NVarChar, addressId)
      .query(`
        UPDATE DIA_CHI_GIAO_HANG
        SET LA_MAC_DINH = 1
        WHERE DIA_CHI_ID = @DIA_CHI_ID
        AND DA_XOA = 0
      `);

    return res.status(200).json({
      message: 'Đã đặt địa chỉ mặc định.'
    });

  } catch (error: any) {
    return res.status(500).json({
      message: 'Không thể đặt địa chỉ mặc định.'
    });
  }
};
export const getCustomerOrders = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .query(`
        SELECT 
          DON_HANG_ID,
          NGAY_TAO,
          TAM_TINH,
          TONG_TIEN,
          TRANG_THAI
        FROM DON_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
        ORDER BY NGAY_TAO DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi server: ' + error.message
    });
  }
};
export const getCustomerVouchers = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .query(`
        SELECT
          VOUCHER_ID,
          KHACH_HANG_ID,
          MA_VOUCHER,
          LOAI_GIAM_GIA,
          GIA_TRI_GIAM,
          NGAY_BAT_DAU,
          NGAY_KET_THUC,
          DA_DUNG
        FROM VOUCHER
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
          AND DA_DUNG = 0
          AND (
            NGAY_BAT_DAU IS NULL
            OR CAST(GETDATE() AS date) >= NGAY_BAT_DAU
          )
          AND (
            NGAY_KET_THUC IS NULL
            OR CAST(GETDATE() AS date) <= NGAY_KET_THUC
          )
        ORDER BY NGAY_KET_THUC ASC
      `);

    return res.status(200).json(result.recordset);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi server: ' + error.message
    });
  }
};
export const getCustomerWishlist = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .query(`
        SELECT
          yt.SAN_PHAM_ID,
          sp.TEN_SAN_PHAM,
          sp.GIA,
          sp.GIA_KHUYEN_MAI,
          ha.URL AS HINH_ANH
        FROM YEU_THICH yt
        JOIN SAN_PHAM sp
          ON yt.SAN_PHAM_ID = sp.SAN_PHAM_ID
        OUTER APPLY (
          SELECT TOP 1 URL
          FROM HINH_ANH_SAN_PHAM
          WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
          ORDER BY LA_ANH_CHINH DESC
        ) ha
        WHERE yt.KHACH_HANG_ID = @KHACH_HANG_ID
        ORDER BY yt.NGAY_TAO DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error: any) {
    return res.status(500).json({
      message: 'Lỗi server: ' + error.message
    });
  }
};
export const updateCustomerAvatar = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: 'Chưa chọn ảnh.' });
    }

    const avatarUrl = `http://localhost:3000/uploads/account/${req.file.filename}`;

    const pool = await connectDB();

    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .input('AVATAR', sql.NVarChar, avatarUrl)
      .query(`
        UPDATE KHACH_HANG
        SET AVATAR = @AVATAR
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID;

        SELECT *
        FROM KHACH_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID;
      `);

    return res.status(200).json({
      message: 'Cập nhật avatar thành công.',
      customer: result.recordset[0]
    });

  } catch (error: any) {
    return res.status(500).json({
      message: 'Không thể cập nhật avatar.'
    });
  }
};
export const removeCustomerAvatar = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await connectDB();

    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, id)
      .query(`
        UPDATE KHACH_HANG
        SET AVATAR = NULL
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID;

        SELECT *
        FROM KHACH_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID;
      `);

    return res.status(200).json({
      message: 'Đã gỡ ảnh đại diện.',
      customer: result.recordset[0]
    });

  } catch (error: any) {
    return res.status(500).json({
      message: 'Không thể gỡ ảnh đại diện.'
    });
  }
};
export const addWishlistItem = async (req: Request, res: Response) => {
  try {
    const { customerId, productId } = req.params;

    if (!customerId || !productId) {
      return res.status(400).json({
        message: 'Thiếu mã khách hàng hoặc mã sản phẩm.'
      });
    }

    const pool = await connectDB();

    const customerResult = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, customerId)
      .query(`
        SELECT 1 AS found
        FROM KHACH_HANG
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
      `);

    if (customerResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy khách hàng.'
      });
    }

    const productResult = await pool.request()
      .input('SAN_PHAM_ID', sql.NVarChar, productId)
      .query(`
        SELECT 1 AS found
        FROM SAN_PHAM
        WHERE SAN_PHAM_ID = @SAN_PHAM_ID
      `);

    if (productResult.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy sản phẩm.'
      });
    }

    await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, customerId)
      .input('SAN_PHAM_ID', sql.NVarChar, productId)
      .query(`
        IF NOT EXISTS (
          SELECT 1
          FROM YEU_THICH
          WHERE KHACH_HANG_ID = @KHACH_HANG_ID
            AND SAN_PHAM_ID = @SAN_PHAM_ID
        )
        BEGIN
          INSERT INTO YEU_THICH (
            KHACH_HANG_ID,
            SAN_PHAM_ID,
            NGAY_TAO
          )
          VALUES (
            @KHACH_HANG_ID,
            @SAN_PHAM_ID,
            GETDATE()
          )
        END
      `);

    return res.status(201).json({
      message: 'Đã thêm vào danh sách yêu thích'
    });

  } catch (error: any) {
    return res.status(500).json({
      message: error.message
    });
  }
};

export const removeWishlistItem = async (req: Request, res: Response) => {
  try {
    const { customerId, productId } = req.params;

    const pool = await connectDB();

    await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar, customerId)
      .input('SAN_PHAM_ID', sql.NVarChar, productId)
      .query(`
        DELETE FROM YEU_THICH
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
        AND SAN_PHAM_ID = @SAN_PHAM_ID
      `);

    return res.status(200).json({
      message: 'Đã xóa khỏi danh sách yêu thích'
    });

  } catch (error: any) {
    return res.status(500).json({
      message: error.message
    });
  }
};

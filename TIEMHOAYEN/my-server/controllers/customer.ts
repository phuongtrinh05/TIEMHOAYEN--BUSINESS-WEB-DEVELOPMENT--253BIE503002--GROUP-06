import { Request, Response } from 'express';
import { connectDB, sql } from '../db.js';
const otpStore = new Map<string, string>();
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

        // Check SĐT trùng
        const phoneCheck = await pool.request()
            .input('SDT', sql.NVarChar, SDT)
            .query('SELECT 1 AS found FROM KHACH_HANG WHERE SDT = @SDT');

        if (phoneCheck.recordset.length > 0) {
            return res.status(409).json({
                field: 'phone',
                message: 'Số điện thoại đã được đăng ký.'
            });
        }

        // Check Email trùng
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

        // Tạo ID mới theo format CUST0001
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

        // Insert
        await pool.request()
            .input('KHACH_HANG_ID', sql.NVarChar, newId)
            .input('TEN', sql.NVarChar, TEN)
            .input('EMAIL', sql.NVarChar, emailValue)
            .input('SDT', sql.NVarChar, SDT)
            .input('MAT_KHAU', sql.NVarChar, MAT_KHAU)
            .input('GIOI_TINH', sql.NVarChar, GIOI_TINH)
            .query(`
                INSERT INTO KHACH_HANG (KHACH_HANG_ID, TEN, EMAIL, SDT, MAT_KHAU, GIOI_TINH, LOAI_THANH_VIEN, DIEM_TICH_LUY)
                VALUES (@KHACH_HANG_ID, @TEN, @EMAIL, @SDT, @MAT_KHAU, @GIOI_TINH, N'Thành viên', 0)
            `);

        return res.status(201).json({ message: 'Đăng ký thành công.' });

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

        // Kiểm tra SĐT trước
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

        // Kiểm tra mật khẩu
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

        const {
            SDT,
            NEW_PASSWORD
        } = req.body;

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
export const sendOtp = async (
  req: Request,
  res: Response
) => {

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

    if(result.recordset.length === 0){
      return res.status(404).json({
        message:'Số điện thoại không tồn tại'
      });
    }

    const otp =
      Math.floor(
        100000 +
        Math.random()*900000
      ).toString();

    otpStore.set(
      SDT,
      otp
    );

    console.log(
      'OTP:',
      otp
    );

    return res.status(200).json({
      message:'Đã gửi OTP'
    });

  } catch(error:any){

    return res.status(500).json({
      message:error.message
    });
  }
};
export const verifyOtp = async (
  req: Request,
  res: Response
) => {

  try {

    const {
      SDT,
      OTP
    } = req.body;

    const savedOtp =
      otpStore.get(SDT);

    if(savedOtp !== OTP){

      return res.status(400).json({
        message:'OTP không đúng'
      });
    }

    return res.status(200).json({
      message:'OTP hợp lệ'
    });

  } catch(error:any){

    return res.status(500).json({
      message:error.message
    });
  }
};
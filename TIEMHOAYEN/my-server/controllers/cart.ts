import { Request, Response } from 'express';
import { sql } from '../db.js';

export const getAllCarts = async (req: Request, res: Response) => {
  try {
    const result = await sql.query('SELECT * FROM GIO_HANG');
    res.status(200).json(result.recordset);
  } catch (error: any) {
    res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
  }
};

const createCartId = (): string => {
  return `GH${Date.now().toString().slice(-8)}`;
};

const getOrCreateCart = async (customerId: string): Promise<string> => {
  const existingRequest = new sql.Request();
  existingRequest.input('KHACH_HANG_ID', sql.NVarChar, customerId);

  const existing = await existingRequest.query(`
    SELECT TOP 1 GIO_HANG_ID
    FROM GIO_HANG
    WHERE KHACH_HANG_ID = @KHACH_HANG_ID
    ORDER BY NGAY_TAO DESC
  `);

  if (existing.recordset.length > 0) {
    return existing.recordset[0].GIO_HANG_ID;
  }

  const cartId = createCartId();
  const insertRequest = new sql.Request();
  insertRequest.input('GIO_HANG_ID', sql.NVarChar, cartId);
  insertRequest.input('KHACH_HANG_ID', sql.NVarChar, customerId);

  await insertRequest.query(`
    INSERT INTO GIO_HANG (GIO_HANG_ID, KHACH_HANG_ID, NGAY_TAO)
    VALUES (@GIO_HANG_ID, @KHACH_HANG_ID, GETDATE())
  `);

  return cartId;
};

export const getCartByCustomer = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId || '');

    if (!customerId) {
      return res.status(400).json({ message: 'Thiếu customerId.' });
    }

    const cartId = await getOrCreateCart(customerId);
    const request = new sql.Request();
    request.input('GIO_HANG_ID', sql.NVarChar, cartId);

    const result = await request.query(`
      SELECT
        sp.SAN_PHAM_ID,
        sp.TEN_SAN_PHAM,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        sp.SO_LUONG AS SO_LUONG_TON,
        sp.KIEU_DANG,
        sp.CHU_DE_ID,
        cd.TEN_CHU_DE,
        ct.SO_LUONG,
        img.URL AS HINH_ANH
      FROM GIO_HANG_CHI_TIET ct
      INNER JOIN SAN_PHAM sp
        ON ct.SAN_PHAM_ID = sp.SAN_PHAM_ID
      LEFT JOIN CHU_DE cd
        ON sp.CHU_DE_ID = cd.CHU_DE_ID
      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC, HINH_ANH_ID ASC
      ) img
      WHERE ct.GIO_HANG_ID = @GIO_HANG_ID
      ORDER BY sp.TEN_SAN_PHAM ASC
    `);

    return res.status(200).json({
      cartId,
      items: result.recordset,
    });
  } catch (error: any) {
    console.error('Lỗi lấy giỏ hàng theo khách hàng:', error);
    return res.status(500).json({ message: 'Không thể lấy giỏ hàng.' });
  }
};

export const addCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.body.customerId || '');
    const productId = String(req.body.productId || '');
    const quantity = Math.max(1, Number(req.body.quantity || 1));

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu customerId hoặc productId.' });
    }

    if (!productId.startsWith('SP')) {
      return res.status(400).json({ message: 'GIO_HANG_CHI_TIET chỉ nhận SAN_PHAM_ID.' });
    }

    const cartId = await getOrCreateCart(customerId);

    const productRequest = new sql.Request();
    productRequest.input('SAN_PHAM_ID', sql.NVarChar, productId);

    const product = await productRequest.query(`
      SELECT TOP 1 SAN_PHAM_ID
      FROM SAN_PHAM
      WHERE SAN_PHAM_ID = @SAN_PHAM_ID
    `);

    if (product.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    }

    const existingRequest = new sql.Request();
    existingRequest.input('GIO_HANG_ID', sql.NVarChar, cartId);
    existingRequest.input('SAN_PHAM_ID', sql.NVarChar, productId);

    const existing = await existingRequest.query(`
      SELECT SO_LUONG
      FROM GIO_HANG_CHI_TIET
      WHERE GIO_HANG_ID = @GIO_HANG_ID
        AND SAN_PHAM_ID = @SAN_PHAM_ID
    `);

    if (existing.recordset.length > 0) {
      const updateRequest = new sql.Request();
      updateRequest.input('GIO_HANG_ID', sql.NVarChar, cartId);
      updateRequest.input('SAN_PHAM_ID', sql.NVarChar, productId);
      updateRequest.input('SO_LUONG', sql.Int, quantity);

      await updateRequest.query(`
        UPDATE GIO_HANG_CHI_TIET
        SET SO_LUONG = @SO_LUONG
        WHERE GIO_HANG_ID = @GIO_HANG_ID
          AND SAN_PHAM_ID = @SAN_PHAM_ID
      `);
    } else {
      const insertRequest = new sql.Request();
      insertRequest.input('GIO_HANG_ID', sql.NVarChar, cartId);
      insertRequest.input('SAN_PHAM_ID', sql.NVarChar, productId);
      insertRequest.input('SO_LUONG', sql.Int, quantity);

      await insertRequest.query(`
        INSERT INTO GIO_HANG_CHI_TIET (GIO_HANG_ID, SAN_PHAM_ID, SO_LUONG)
        VALUES (@GIO_HANG_ID, @SAN_PHAM_ID, @SO_LUONG)
      `);
    }

    return res.status(200).json({
      message: 'Đã lưu sản phẩm vào giỏ hàng.',
      cartId,
    });
  } catch (error: any) {
    console.error('Lỗi thêm sản phẩm vào giỏ hàng:', error);
    return res.status(500).json({ message: 'Không thể thêm sản phẩm vào giỏ hàng.' });
  }
};

export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.body.customerId || '');
    const productId = String(req.body.productId || '');
    const quantity = Math.max(1, Number(req.body.quantity || 1));

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu customerId hoặc productId.' });
    }

    const cartId = await getOrCreateCart(customerId);
    const request = new sql.Request();
    request.input('GIO_HANG_ID', sql.NVarChar, cartId);
    request.input('SAN_PHAM_ID', sql.NVarChar, productId);
    request.input('SO_LUONG', sql.Int, quantity);

    await request.query(`
      UPDATE GIO_HANG_CHI_TIET
      SET SO_LUONG = @SO_LUONG
      WHERE GIO_HANG_ID = @GIO_HANG_ID
        AND SAN_PHAM_ID = @SAN_PHAM_ID
    `);

    return res.status(200).json({ message: 'Đã cập nhật số lượng.' });
  } catch (error: any) {
    console.error('Lỗi cập nhật giỏ hàng:', error);
    return res.status(500).json({ message: 'Không thể cập nhật giỏ hàng.' });
  }
};

export const removeCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.body.customerId || '');
    const productId = String(req.body.productId || '');

    if (!customerId || !productId) {
      return res.status(400).json({ message: 'Thiếu customerId hoặc productId.' });
    }

    const cartId = await getOrCreateCart(customerId);
    const request = new sql.Request();
    request.input('GIO_HANG_ID', sql.NVarChar, cartId);
    request.input('SAN_PHAM_ID', sql.NVarChar, productId);

    await request.query(`
      DELETE FROM GIO_HANG_CHI_TIET
      WHERE GIO_HANG_ID = @GIO_HANG_ID
        AND SAN_PHAM_ID = @SAN_PHAM_ID
    `);

    return res.status(200).json({ message: 'Đã xóa sản phẩm khỏi giỏ hàng.' });
  } catch (error: any) {
    console.error('Lỗi xóa sản phẩm khỏi giỏ hàng:', error);
    return res.status(500).json({ message: 'Không thể xóa sản phẩm khỏi giỏ hàng.' });
  }
};

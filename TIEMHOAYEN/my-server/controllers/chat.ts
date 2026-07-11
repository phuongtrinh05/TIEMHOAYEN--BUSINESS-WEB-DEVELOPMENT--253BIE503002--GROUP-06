import { Request, Response } from 'express';
import { connectDB, sql } from '../db.js';
import axios from 'axios';

const N8N_WEBHOOK_URL = 'https://thuongthu.app.n8n.cloud/webhook/2bb78087-b702-4dc2-91d4-12b65ef2dc79';
const CHAT_PUBLIC_BASE_URL = String(
  process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
).replace(/\/$/, '');
const CHAT_CACHE_TTL_MS = 10_000;
const CHAT_POLL_CACHE_TTL_MS = 2_000;

type CacheEntry<T> = {
  expiresAt: number;
  data: T;
};
export const saveHandoffChat = async (req: Request, res: Response) => {
  try {
    const {
      chatInput,
      customerId,
      productId,
      orderId,
      image,
      imageDataUrl,
      imageName,
      imageType,
      guestName,
      guestPhone,
      guestEmail
    } = req.body;

    const question = toNullableString(chatInput);
    const attachedImage = toNullableString(imageDataUrl || image?.dataUrl);
    const normalizedCustomerId = toNullableString(customerId);
    const guestContactBlock = normalizedCustomerId
      ? ''
      : buildGuestContactBlock(guestName, guestPhone, guestEmail);
    const storedQuestion = `${guestContactBlock}${question || 'Khách hàng đã gửi hình ảnh'}`;

    if (!question && !attachedImage) {
      return res.status(400).json({ message: 'Thiếu nội dung tin nhắn hoặc hình ảnh.' });
    }

    const pool = await connectDB();

    const nextIdResult = await pool.request().query(`
      SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(TIN_NHAN_ID, 5, 20))), 0) + 1 AS NEXT_NUM
      FROM TIN_NHAN_CHAT
      WHERE TIN_NHAN_ID LIKE 'CHAT%'
    `);

    const chatId = makeChatId(Number(nextIdResult.recordset[0]?.NEXT_NUM || 1));
    const hasImageColumns = await pool.request().query(`
      SELECT
        COL_LENGTH('dbo.TIN_NHAN_CHAT', 'HINH_ANH') AS HINH_ANH,
        COL_LENGTH('dbo.TIN_NHAN_CHAT', 'TEN_FILE_ANH') AS TEN_FILE_ANH,
        COL_LENGTH('dbo.TIN_NHAN_CHAT', 'LOAI_FILE_ANH') AS LOAI_FILE_ANH
    `);

    const imageColumnsReady =
      hasImageColumns.recordset[0]?.HINH_ANH !== null &&
      hasImageColumns.recordset[0]?.TEN_FILE_ANH !== null &&
      hasImageColumns.recordset[0]?.LOAI_FILE_ANH !== null;

    const request = pool.request()
      .input('TIN_NHAN_ID', sql.NVarChar(20), chatId)
      .input('KHACH_HANG_ID', sql.NVarChar(20), normalizedCustomerId)
      .input('DON_HANG_ID', sql.NVarChar(20), toNullableString(orderId))
      .input('SAN_PHAM_ID', sql.NVarChar(20), toNullableString(productId))
      .input('NOI_DUNG_CAU_HOI', sql.NVarChar(sql.MAX), storedQuestion)
      .input('LOAI_TIN_NHAN', sql.NVarChar(50), 'human_request')
      .input('TRANG_THAI', sql.NVarChar(50), 'pending')
      .input('HINH_ANH', sql.NVarChar(sql.MAX), attachedImage)
      .input('TEN_FILE_ANH', sql.NVarChar(255), toNullableString(imageName || image?.name))
      .input('LOAI_FILE_ANH', sql.NVarChar(100), toNullableString(imageType || image?.type));

    if (imageColumnsReady) {
      await request.query(`
        INSERT INTO TIN_NHAN_CHAT (
          TIN_NHAN_ID,
          KHACH_HANG_ID,
          DON_HANG_ID,
          SAN_PHAM_ID,
          NOI_DUNG_CAU_HOI,
          LOAI_TIN_NHAN,
          THOI_GIAN_GUI,
          TRANG_THAI,
          HINH_ANH,
          TEN_FILE_ANH,
          LOAI_FILE_ANH
        )
        VALUES (
          @TIN_NHAN_ID,
          @KHACH_HANG_ID,
          @DON_HANG_ID,
          @SAN_PHAM_ID,
          @NOI_DUNG_CAU_HOI,
          @LOAI_TIN_NHAN,
          GETDATE(),
          @TRANG_THAI,
          @HINH_ANH,
          @TEN_FILE_ANH,
          @LOAI_FILE_ANH
        )
      `);
    } else {
      await request.query(`
        INSERT INTO TIN_NHAN_CHAT (
          TIN_NHAN_ID,
          KHACH_HANG_ID,
          DON_HANG_ID,
          SAN_PHAM_ID,
          NOI_DUNG_CAU_HOI,
          LOAI_TIN_NHAN,
          THOI_GIAN_GUI,
          TRANG_THAI
        )
        VALUES (
          @TIN_NHAN_ID,
          @KHACH_HANG_ID,
          @DON_HANG_ID,
          @SAN_PHAM_ID,
          @NOI_DUNG_CAU_HOI,
          @LOAI_TIN_NHAN,
          GETDATE(),
          @TRANG_THAI
        )
      `);
    }

    clearChatCache();

    return res.status(201).json({
      message: 'Đã chuyển yêu cầu cho nhân viên.',
      chatId,
      imageSaved: imageColumnsReady && !!attachedImage
    });
  } catch (error: any) {
    console.error('SAVE HANDOFF CHAT ERROR:', error);
    return res.status(500).json({ message: 'Không thể lưu yêu cầu chat.' });
  }
};

export const getAdminChatConversations = async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'admin-chat-conversations';
    const cached = getCachedChatData<{ total: number; conversations: any[] }>(cacheKey);

    if (cached) {
      return res.status(200).json(cached);
    }

    const pool = await connectDB();

    const result = await pool.request().query(`
      SELECT
        t.TIN_NHAN_ID,
        t.KHACH_HANG_ID,
        t.DON_HANG_ID,
        t.SAN_PHAM_ID,
        t.NHAN_VIEN_ID,
        t.NOI_DUNG_CAU_HOI,
        t.NOI_DUNG_TRA_LOI,
        t.LOAI_TIN_NHAN,
        t.THOI_GIAN_GUI,
        t.TRANG_THAI,
        CASE
          WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'HINH_ANH') IS NULL THEN NULL
          WHEN t.HINH_ANH IS NULL OR LTRIM(RTRIM(t.HINH_ANH)) = '' THEN NULL
          WHEN t.HINH_ANH LIKE 'http%' THEN t.HINH_ANH
          ELSE CONCAT('${CHAT_PUBLIC_BASE_URL}/api/chats/image/', t.TIN_NHAN_ID)
        END AS HINH_ANH,
        CASE WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'TEN_FILE_ANH') IS NULL THEN NULL ELSE t.TEN_FILE_ANH END AS TEN_FILE_ANH,
        CASE WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'LOAI_FILE_ANH') IS NULL THEN NULL ELSE t.LOAI_FILE_ANH END AS LOAI_FILE_ANH,
        kh.TEN AS TEN_KHACH_HANG,
        kh.SDT,
        sp.TEN_SAN_PHAM,
        sp.GIA,
        sp.GIA_KHUYEN_MAI,
        img.URL AS HINH_ANH_SAN_PHAM
      FROM TIN_NHAN_CHAT t
      LEFT JOIN KHACH_HANG kh ON kh.KHACH_HANG_ID = t.KHACH_HANG_ID
      LEFT JOIN SAN_PHAM sp ON sp.SAN_PHAM_ID = t.SAN_PHAM_ID
      OUTER APPLY (
        SELECT TOP 1 URL
        FROM HINH_ANH_SAN_PHAM
        WHERE SAN_PHAM_ID = sp.SAN_PHAM_ID
        ORDER BY LA_ANH_CHINH DESC, HINH_ANH_ID ASC
      ) img
      ORDER BY ISNULL(t.KHACH_HANG_ID, t.TIN_NHAN_ID), t.THOI_GIAN_GUI ASC, t.TIN_NHAN_ID ASC
    `);

    const grouped = new Map<string, any>();
    const dateTracker = new Map<string, Set<string>>();

    result.recordset.forEach((row: any) => {
      const conversationId = makeConversationId(row);
      const guestContact = parseGuestContact(row.NOI_DUNG_CAU_HOI);
      const displayQuestion = getVisibleQuestion(row.NOI_DUNG_CAU_HOI);
      const customerName = row.TEN_KHACH_HANG || row.KHACH_HANG_ID || guestContact.name || 'Khách vãng lai';
      const time = formatTime(row.THOI_GIAN_GUI);
      const dateLabel = formatDateLabel(row.THOI_GIAN_GUI);
      const dateKey = row.THOI_GIAN_GUI
        ? new Date(row.THOI_GIAN_GUI).toISOString().slice(0, 10)
        : 'today';

      if (!grouped.has(conversationId)) {
        grouped.set(conversationId, {
          id: conversationId,
          name: customerName,
          initials: getInitials(customerName),
          avatarColor: '#c87070',
          customerId: row.KHACH_HANG_ID || conversationId,
          phone: row.SDT || guestContact.phone || '',
          isOnline: false,
          lastMessage: '',
          unread: 0,
          isPending: false,
          pendingChatId: null,
          pinnedProduct: row.SAN_PHAM_ID
            ? {
                id: row.SAN_PHAM_ID,
                name: row.TEN_SAN_PHAM || row.SAN_PHAM_ID,
                price: Number(row.GIA_KHUYEN_MAI || row.GIA || 0),
                image: row.HINH_ANH_SAN_PHAM || null
              }
            : null,
          messages: []
        });
        dateTracker.set(conversationId, new Set<string>());
      }

      const conversation = grouped.get(conversationId);
      const seenDates = dateTracker.get(conversationId)!;

      if (!seenDates.has(dateKey)) {
        conversation.messages.push({ type: 'date', text: dateLabel });
        seenDates.add(dateKey);
      }

      const isStaffMessage = row.LOAI_TIN_NHAN === 'staff_reply';
      const hasQuestion = !isStaffMessage && (!!displayQuestion || !!row.HINH_ANH);
      const hasAnswer = !!String(row.NOI_DUNG_TRA_LOI || '').trim() || (isStaffMessage && !!row.HINH_ANH);
      const pending = isPendingChatStatus(row.TRANG_THAI);

      if (row.SAN_PHAM_ID && !conversation.pinnedProduct) {
        conversation.pinnedProduct = {
          id: row.SAN_PHAM_ID,
          name: row.TEN_SAN_PHAM || row.SAN_PHAM_ID,
          price: Number(row.GIA_KHUYEN_MAI || row.GIA || 0),
          image: row.HINH_ANH_SAN_PHAM || null
        };
      }

      if (hasQuestion) {
        conversation.messages.push({
          id: row.TIN_NHAN_ID,
          type: row.SAN_PHAM_ID ? 'product' : 'text',
          text: displayQuestion || 'Khách hàng đã gửi hình ảnh',
          isCustomer: true,
          time,
          status: row.TRANG_THAI,
          image: row.HINH_ANH || null,
          imageName: row.TEN_FILE_ANH || null,
          imageType: row.LOAI_FILE_ANH || null,
          product: row.SAN_PHAM_ID
            ? {
                id: row.SAN_PHAM_ID,
                name: row.TEN_SAN_PHAM || row.SAN_PHAM_ID,
                price: Number(row.GIA_KHUYEN_MAI || row.GIA || 0),
                image: row.HINH_ANH_SAN_PHAM || null
              }
            : null
        });
        conversation.lastMessage = displayQuestion || 'Khách hàng đã gửi hình ảnh';
      }

      if (hasAnswer) {
        conversation.messages.push({
          id: `${row.TIN_NHAN_ID}-reply`,
          type: 'text',
          text: row.NOI_DUNG_TRA_LOI || '',
          isCustomer: false,
          time,
          status: row.TRANG_THAI,
          image: isStaffMessage ? row.HINH_ANH || null : null,
          imageName: isStaffMessage ? row.TEN_FILE_ANH || null : null,
          imageType: isStaffMessage ? row.LOAI_FILE_ANH || null : null
        });
        conversation.lastMessage = row.NOI_DUNG_TRA_LOI || 'Ảnh';
      }

      if (pending) {
        conversation.isPending = true;
        conversation.unread += 1;
        conversation.pendingChatId = conversation.pendingChatId || row.TIN_NHAN_ID;
      }
    });

    const conversations = Array.from(grouped.values()).sort((a, b) => {
      const aLast = a.messages.at(-1)?.id || '';
      const bLast = b.messages.at(-1)?.id || '';
      return String(bLast).localeCompare(String(aLast));
    });

    const payload = {
      total: conversations.length,
      conversations
    };

    setCachedChatData(cacheKey, payload, CHAT_CACHE_TTL_MS);
    return res.status(200).json(payload);
  } catch (error: any) {
    console.error('ADMIN CHAT CONVERSATIONS ERROR:', error);
    return res.status(500).json({ message: 'Không thể tải danh sách chat.' });
  }
};

export const getCustomerChatMessages = async (req: Request, res: Response) => {
  try {
    const customerId = toNullableString(req.params.customerId);

    if (!customerId) {
      return res.status(400).json({ message: 'Thiếu mã khách hàng.' });
    }

    const cacheKey = `customer-chat-messages:${customerId}`;
    const cached = getCachedChatData<{ customerId: string; messages: any[] }>(cacheKey);

    if (cached) {
      return res.status(200).json(cached);
    }

    const pool = await connectDB();
    const result = await pool.request()
      .input('KHACH_HANG_ID', sql.NVarChar(20), customerId)
      .query(`
        SELECT TOP 100
          TIN_NHAN_ID,
          KHACH_HANG_ID,
          DON_HANG_ID,
          SAN_PHAM_ID,
          NHAN_VIEN_ID,
          NOI_DUNG_CAU_HOI,
          NOI_DUNG_TRA_LOI,
          LOAI_TIN_NHAN,
          THOI_GIAN_GUI,
          TRANG_THAI,
          CASE
            WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'HINH_ANH') IS NULL THEN NULL
            WHEN HINH_ANH IS NULL OR LTRIM(RTRIM(HINH_ANH)) = '' THEN NULL
            WHEN HINH_ANH LIKE 'http%' THEN HINH_ANH
            ELSE CONCAT('${CHAT_PUBLIC_BASE_URL}/api/chats/image/', TIN_NHAN_ID)
          END AS HINH_ANH,
          CASE WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'TEN_FILE_ANH') IS NULL THEN NULL ELSE TEN_FILE_ANH END AS TEN_FILE_ANH,
          CASE WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'LOAI_FILE_ANH') IS NULL THEN NULL ELSE LOAI_FILE_ANH END AS LOAI_FILE_ANH
        FROM TIN_NHAN_CHAT
        WHERE KHACH_HANG_ID = @KHACH_HANG_ID
        ORDER BY THOI_GIAN_GUI ASC, TIN_NHAN_ID ASC
      `);

    const messages: any[] = [];

    result.recordset.forEach((row: any) => {
      const time = formatTime(row.THOI_GIAN_GUI);
      const question = toNullableString(getVisibleQuestion(row.NOI_DUNG_CAU_HOI));
      const answer = toNullableString(row.NOI_DUNG_TRA_LOI);
      const isStaffMessage = row.LOAI_TIN_NHAN === 'staff_reply';

      if (!isStaffMessage && (question || row.HINH_ANH)) {
        messages.push({
          id: row.TIN_NHAN_ID,
          role: 'user',
          content: question || '',
          imageUrl: row.HINH_ANH || null,
          imageName: row.TEN_FILE_ANH || null,
          imageType: row.LOAI_FILE_ANH || null,
          time,
          status: row.TRANG_THAI,
          type: row.LOAI_TIN_NHAN
        });
      }

      if (answer || (isStaffMessage && row.HINH_ANH)) {
        messages.push({
          id: `${row.TIN_NHAN_ID}-reply`,
          role: 'bot',
          content: answer || '',
          imageUrl: isStaffMessage ? row.HINH_ANH || null : null,
          time,
          status: row.TRANG_THAI,
          type: row.LOAI_TIN_NHAN || 'staff_reply'
        });
      }
    });

    const payload = { customerId, messages };
    setCachedChatData(cacheKey, payload, CHAT_POLL_CACHE_TTL_MS);
    return res.status(200).json(payload);
  } catch (error: any) {
    console.error('CUSTOMER CHAT MESSAGES ERROR:', error);
    return res.status(500).json({ message: 'Không thể tải tin nhắn chat.' });
  }
};

export const getChatImage = async (req: Request, res: Response) => {
  try {
    const chatId = toNullableString(req.params.chatId);

    if (!chatId) {
      return res.status(400).json({ message: 'Thiếu mã tin nhắn.' });
    }

    const pool = await connectDB();
    const result = await pool.request()
      .input('TIN_NHAN_ID', sql.NVarChar(20), chatId)
      .query(`
        SELECT TOP 1
          CASE WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'HINH_ANH') IS NULL THEN NULL ELSE HINH_ANH END AS HINH_ANH,
          CASE WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'LOAI_FILE_ANH') IS NULL THEN NULL ELSE LOAI_FILE_ANH END AS LOAI_FILE_ANH
        FROM TIN_NHAN_CHAT
        WHERE TIN_NHAN_ID = @TIN_NHAN_ID
      `);

    const rawImage = toNullableString(result.recordset[0]?.HINH_ANH);
    const fileType = toNullableString(result.recordset[0]?.LOAI_FILE_ANH) || 'image/jpeg';

    if (!rawImage) {
      return res.status(404).json({ message: 'Không tìm thấy ảnh.' });
    }

    if (/^https?:\/\//i.test(rawImage)) {
      return res.redirect(rawImage);
    }

    const dataUrlMatch = rawImage.match(/^data:([^;]+);base64,(.+)$/);
    const contentType = dataUrlMatch?.[1] || fileType;
    const base64Content = dataUrlMatch?.[2] || rawImage;
    const buffer = Buffer.from(base64Content, 'base64');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(buffer);
  } catch (error: any) {
    console.error('CHAT IMAGE ERROR:', error);
    return res.status(500).json({ message: 'Không thể tải ảnh chat.' });
  }
};

export const getGuestChatMessages = async (req: Request, res: Response) => {
  try {
    const chatId = toNullableString(req.params.chatId);

    if (!chatId) {
      return res.status(400).json({ message: 'Thiếu mã cuộc trò chuyện.' });
    }

    const cacheKey = `guest-chat-messages:${chatId}`;
    const cached = getCachedChatData<{ chatId: string; messages: any[] }>(cacheKey);

    if (cached) {
      return res.status(200).json(cached);
    }

    const pool = await connectDB();
    const result = await pool.request()
      .input('TIN_NHAN_ID', sql.NVarChar(20), chatId)
      .input('REPLY_PARENT_START', sql.NVarChar(50), REPLY_PARENT_START)
      .input('REPLY_PARENT_END', sql.NVarChar(50), REPLY_PARENT_END)
      .query(`
        SELECT TOP 100
          TIN_NHAN_ID,
          NOI_DUNG_CAU_HOI,
          NOI_DUNG_TRA_LOI,
          LOAI_TIN_NHAN,
          THOI_GIAN_GUI,
          TRANG_THAI,
          CASE WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'HINH_ANH') IS NULL THEN NULL ELSE HINH_ANH END AS HINH_ANH,
          CASE WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'TEN_FILE_ANH') IS NULL THEN NULL ELSE TEN_FILE_ANH END AS TEN_FILE_ANH,
          CASE WHEN COL_LENGTH('dbo.TIN_NHAN_CHAT', 'LOAI_FILE_ANH') IS NULL THEN NULL ELSE LOAI_FILE_ANH END AS LOAI_FILE_ANH
        FROM TIN_NHAN_CHAT
        WHERE
          (TIN_NHAN_ID = @TIN_NHAN_ID AND KHACH_HANG_ID IS NULL)
          OR (
            KHACH_HANG_ID IS NULL
            AND LOAI_TIN_NHAN = 'staff_reply'
            AND NOI_DUNG_CAU_HOI LIKE '%' + @REPLY_PARENT_START + @TIN_NHAN_ID + @REPLY_PARENT_END + '%'
          )
        ORDER BY THOI_GIAN_GUI ASC, TIN_NHAN_ID ASC
      `);

    const messages: any[] = [];

    result.recordset.forEach((row: any) => {
      const time = formatTime(row.THOI_GIAN_GUI);
      const question = toNullableString(getVisibleQuestion(row.NOI_DUNG_CAU_HOI));
      const answer = toNullableString(row.NOI_DUNG_TRA_LOI);
      const isStaffMessage = row.LOAI_TIN_NHAN === 'staff_reply';

      if (!isStaffMessage && (question || row.HINH_ANH)) {
        messages.push({
          id: row.TIN_NHAN_ID,
          role: 'user',
          content: question || '',
          imageUrl: row.HINH_ANH || null,
          imageName: row.TEN_FILE_ANH || null,
          imageType: row.LOAI_FILE_ANH || null,
          time,
          status: row.TRANG_THAI,
          type: row.LOAI_TIN_NHAN
        });
      }

      if (answer || (isStaffMessage && row.HINH_ANH)) {
        messages.push({
          id: `${row.TIN_NHAN_ID}-reply`,
          role: 'bot',
          content: answer || '',
          imageUrl: isStaffMessage ? row.HINH_ANH || null : null,
          imageName: isStaffMessage ? row.TEN_FILE_ANH || null : null,
          imageType: isStaffMessage ? row.LOAI_FILE_ANH || null : null,
          time,
          status: row.TRANG_THAI,
          type: row.LOAI_TIN_NHAN || 'staff_reply'
        });
      }
    });

    const payload = { chatId, messages };
    setCachedChatData(cacheKey, payload, CHAT_POLL_CACHE_TTL_MS);
    return res.status(200).json(payload);
  } catch (error: any) {
    console.error('GUEST CHAT MESSAGES ERROR:', error);
    return res.status(500).json({ message: 'Không thể tải tin nhắn khách vãng lai.' });
  }
};

export const replyAdminChat = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { message, staffId, chatId, image, imageDataUrl, imageName, imageType } = req.body;
    const reply = toNullableString(message);
    const attachedImage = toNullableString(imageDataUrl || image?.dataUrl);

    if (!conversationId || (!reply && !attachedImage)) {
      return res.status(400).json({ message: 'Thiếu nội dung trả lời.' });
    }

    const pool = await connectDB();
    const hasImageColumns = await pool.request().query(`
      SELECT
        COL_LENGTH('dbo.TIN_NHAN_CHAT', 'HINH_ANH') AS HINH_ANH,
        COL_LENGTH('dbo.TIN_NHAN_CHAT', 'TEN_FILE_ANH') AS TEN_FILE_ANH,
        COL_LENGTH('dbo.TIN_NHAN_CHAT', 'LOAI_FILE_ANH') AS LOAI_FILE_ANH
    `);
    const imageColumnsReady =
      hasImageColumns.recordset[0]?.HINH_ANH !== null &&
      hasImageColumns.recordset[0]?.TEN_FILE_ANH !== null &&
      hasImageColumns.recordset[0]?.LOAI_FILE_ANH !== null;

    const targetRequest = pool.request()
      .input('CONVERSATION_ID', sql.NVarChar(50), conversationId)
      .input('CHAT_ID', sql.NVarChar(20), toNullableString(chatId));

    const targetResult = await targetRequest.query(`
      SELECT TOP 1
        TIN_NHAN_ID,
        KHACH_HANG_ID,
        DON_HANG_ID,
        SAN_PHAM_ID
      FROM TIN_NHAN_CHAT
      WHERE
        (@CHAT_ID IS NOT NULL AND TIN_NHAN_ID = @CHAT_ID)
        OR (
          @CHAT_ID IS NULL
          AND @CONVERSATION_ID LIKE 'CHAT%'
          AND TIN_NHAN_ID = @CONVERSATION_ID
          AND (
            LOWER(ISNULL(TRANG_THAI, '')) = 'pending'
            OR TRANG_THAI LIKE N'%Chờ%'
            OR TRANG_THAI LIKE N'%cho%'
          )
        )
        OR (
          @CHAT_ID IS NULL
          AND (KHACH_HANG_ID = @CONVERSATION_ID OR DON_HANG_ID = @CONVERSATION_ID OR SAN_PHAM_ID = @CONVERSATION_ID)
          AND (
            LOWER(ISNULL(TRANG_THAI, '')) = 'pending'
            OR TRANG_THAI LIKE N'%Chờ%'
            OR TRANG_THAI LIKE N'%cho%'
          )
        )
      ORDER BY THOI_GIAN_GUI DESC, TIN_NHAN_ID DESC
    `);

    const targetRow = targetResult.recordset[0];
    const targetChatId = targetRow?.TIN_NHAN_ID;
    const employeeId = toNullableString(staffId);

    if (targetChatId) {
      await pool.request()
        .input('TIN_NHAN_ID', sql.NVarChar(20), targetChatId)
        .input('NHAN_VIEN_ID', sql.NVarChar(20), employeeId)
        .input('TRANG_THAI', sql.NVarChar(50), 'completed')
        .query(`
          UPDATE TIN_NHAN_CHAT
          SET
            NHAN_VIEN_ID = @NHAN_VIEN_ID,
            TRANG_THAI = @TRANG_THAI
          WHERE TIN_NHAN_ID = @TIN_NHAN_ID
        `);
    }

    const nextIdResult = await pool.request().query(`
      SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(TIN_NHAN_ID, 5, 20))), 0) + 1 AS NEXT_NUM
      FROM TIN_NHAN_CHAT
      WHERE TIN_NHAN_ID LIKE 'CHAT%'
    `);
    const newChatId = makeChatId(Number(nextIdResult.recordset[0]?.NEXT_NUM || 1));
    const replyParentBlock = targetChatId
      ? buildReplyParentBlock(targetChatId)
      : conversationId.startsWith('CHAT')
        ? buildReplyParentBlock(conversationId)
        : null;
    const replyCustomerId = toNullableString(targetRow?.KHACH_HANG_ID)
      || (conversationId.startsWith('CUST') ? conversationId : null);
    const replyOrderId = toNullableString(targetRow?.DON_HANG_ID)
      || (conversationId.startsWith('ORD') || conversationId.startsWith('YEN') ? conversationId : null);
    const replyProductId = toNullableString(targetRow?.SAN_PHAM_ID)
      || (conversationId.startsWith('SP') ? conversationId : null);

    const insertRequest = pool.request()
      .input('TIN_NHAN_ID', sql.NVarChar(20), newChatId)
      .input('KHACH_HANG_ID', sql.NVarChar(20), replyCustomerId)
      .input('DON_HANG_ID', sql.NVarChar(20), replyOrderId)
      .input('SAN_PHAM_ID', sql.NVarChar(20), replyProductId)
      .input('NHAN_VIEN_ID', sql.NVarChar(20), employeeId)
      .input('NOI_DUNG_CAU_HOI', sql.NVarChar(sql.MAX), replyParentBlock)
      .input('NOI_DUNG_TRA_LOI', sql.NVarChar(sql.MAX), reply)
      .input('LOAI_TIN_NHAN', sql.NVarChar(50), 'staff_reply')
      .input('TRANG_THAI', sql.NVarChar(50), 'completed');

    if (imageColumnsReady) {
      insertRequest
        .input('HINH_ANH', sql.NVarChar(sql.MAX), attachedImage)
        .input('TEN_FILE_ANH', sql.NVarChar(255), toNullableString(imageName || image?.name))
        .input('LOAI_FILE_ANH', sql.NVarChar(100), toNullableString(imageType || image?.type));

      await insertRequest.query(`
        INSERT INTO TIN_NHAN_CHAT (
          TIN_NHAN_ID,
          KHACH_HANG_ID,
          DON_HANG_ID,
          SAN_PHAM_ID,
          NHAN_VIEN_ID,
          NOI_DUNG_CAU_HOI,
          NOI_DUNG_TRA_LOI,
          LOAI_TIN_NHAN,
          THOI_GIAN_GUI,
          TRANG_THAI,
          HINH_ANH,
          TEN_FILE_ANH,
          LOAI_FILE_ANH
        )
        VALUES (
          @TIN_NHAN_ID,
          @KHACH_HANG_ID,
          @DON_HANG_ID,
          @SAN_PHAM_ID,
          @NHAN_VIEN_ID,
          @NOI_DUNG_CAU_HOI,
          @NOI_DUNG_TRA_LOI,
          @LOAI_TIN_NHAN,
          GETDATE(),
          @TRANG_THAI,
          @HINH_ANH,
          @TEN_FILE_ANH,
          @LOAI_FILE_ANH
        )
      `);
    } else {
      await insertRequest.query(`
        INSERT INTO TIN_NHAN_CHAT (
          TIN_NHAN_ID,
          KHACH_HANG_ID,
          DON_HANG_ID,
          SAN_PHAM_ID,
          NHAN_VIEN_ID,
          NOI_DUNG_CAU_HOI,
          NOI_DUNG_TRA_LOI,
          LOAI_TIN_NHAN,
          THOI_GIAN_GUI,
          TRANG_THAI
        )
        VALUES (
          @TIN_NHAN_ID,
          @KHACH_HANG_ID,
          @DON_HANG_ID,
          @SAN_PHAM_ID,
          @NHAN_VIEN_ID,
          @NOI_DUNG_CAU_HOI,
          @NOI_DUNG_TRA_LOI,
          @LOAI_TIN_NHAN,
          GETDATE(),
          @TRANG_THAI
        )
      `);
    }

    clearChatCache();

    return res.status(201).json({
      message: 'Đã lưu phản hồi chat.',
      chatId: newChatId
    });
  } catch (error: any) {
    console.error('ADMIN CHAT REPLY ERROR:', error);
    return res.status(500).json({ message: 'Không thể lưu phản hồi chat.' });
  }
};

const chatCache = new Map<string, CacheEntry<unknown>>();

const toNullableString = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text ? text : null;
};

const GUEST_CONTACT_START = '[guest_contact]';
const GUEST_CONTACT_END = '[/guest_contact]';
const REPLY_PARENT_START = '[reply_parent]';
const REPLY_PARENT_END = '[/reply_parent]';

const makeChatId = (rawNumber: number): string => {
  return `CHAT${String(rawNumber).padStart(6, '0')}`;
};

const parseReplyParentId = (value: unknown): string | null => {
  const text = String(value || '');
  const match = text.match(/\[reply_parent\]([\s\S]*?)\[\/reply_parent\]/);
  return toNullableString(match?.[1]);
};

const makeConversationId = (row: any): string => {
  return row.KHACH_HANG_ID || row.DON_HANG_ID || row.SAN_PHAM_ID || parseReplyParentId(row.NOI_DUNG_CAU_HOI) || row.TIN_NHAN_ID;
};

const getInitials = (name: string): string => {
  return String(name || 'KH')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('') || 'KH';
};

const formatTime = (value: unknown): string => {
  if (!value) return '';
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const formatDateLabel = (value: unknown): string => {
  const date = value ? new Date(value as string) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

const isPendingChatStatus = (status: unknown): boolean => {
  const value = String(status || '').trim().toLowerCase();
  return value === 'pending' || value.includes('chờ') || value.includes('cho');
};

const buildGuestContactBlock = (name: unknown, phone: unknown, email: unknown): string => {
  const guestName = toNullableString(name);
  const guestPhone = toNullableString(phone);
  const guestEmail = toNullableString(email);

  if (!guestName && !guestPhone && !guestEmail) {
    return '';
  }

  return [
    GUEST_CONTACT_START,
    `name=${guestName || ''}`,
    `phone=${guestPhone || ''}`,
    `email=${guestEmail || ''}`,
    GUEST_CONTACT_END,
    ''
  ].join('\n');
};

const parseGuestContact = (value: unknown): { name: string | null; phone: string | null; email: string | null } => {
  const text = String(value || '');
  const match = text.match(/\[guest_contact\]([\s\S]*?)\[\/guest_contact\]/);

  if (!match) {
    return { name: null, phone: null, email: null };
  }

  const fields = new Map<string, string>();
  match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) return;
      fields.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1).trim());
    });

  return {
    name: toNullableString(fields.get('name')),
    phone: toNullableString(fields.get('phone')),
    email: toNullableString(fields.get('email'))
  };
};

const stripGuestContactBlock = (value: unknown): string => {
  return String(value || '')
    .replace(/\[guest_contact\][\s\S]*?\[\/guest_contact\]\s*/, '')
    .trim();
};

const buildReplyParentBlock = (chatId: unknown): string | null => {
  const parentId = toNullableString(chatId);
  return parentId ? `${REPLY_PARENT_START}${parentId}${REPLY_PARENT_END}` : null;
};

const stripReplyParentBlock = (value: unknown): string => {
  return String(value || '')
    .replace(/\[reply_parent\][\s\S]*?\[\/reply_parent\]\s*/, '')
    .trim();
};

const getVisibleQuestion = (value: unknown): string => {
  return stripReplyParentBlock(stripGuestContactBlock(value));
};

const makeChatImageApiUrl = (chatId: unknown): string | null => {
  const id = toNullableString(chatId);
  return id ? `${CHAT_PUBLIC_BASE_URL}/api/chats/image/${encodeURIComponent(id)}` : null;
};

const getCachedChatData = <T>(key: string): T | null => {
  const entry = chatCache.get(key) as CacheEntry<T> | undefined;

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    chatCache.delete(key);
    return null;
  }

  return entry.data;
};

const setCachedChatData = <T>(key: string, data: T, ttlMs: number): void => {
  chatCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
};

const clearChatCache = (): void => {
  chatCache.clear();
};

// ================================================================
// sendChat — POST /api/chat
// Nhận từ Angular: chatInput, customerId, productId, orderId
// 1. Query SQL lấy context
// 2. Gọi n8n kèm toàn bộ context
// 3. Trả kết quả về Angular
// ================================================================
export const sendChat = async (req: Request, res: Response) => {
  try {
    const { chatInput, customerId, productId, orderId } = req.body;

    if (!chatInput || !chatInput.trim()) {
      return res.status(400).json({ message: 'Thiếu nội dung tin nhắn.' });
    }

    const pool = await connectDB();

    // ----------------------------------------------------------------
    // 1. Lấy thông tin khách hàng (nếu đã đăng nhập)
    // ----------------------------------------------------------------
    let customerInfo = null;


    // ----------------------------------------------------------------
    // 3. Lấy chi tiết đơn hàng gần nhất (hoặc đơn đang xem)
    //    orderId từ URL nếu khách đang ở /order-detail/:id
    //    Fallback: lấy đơn đầu tiên trong orderList
    // ----------------------------------------------------------------
    let orderInfo = null;
    let targetOrderId = orderId;
    if (!targetOrderId && customerId) {

      const newestOrder = await pool.request()
        .input("KHACH_HANG_ID", sql.NVarChar, customerId)
        .query(`
            SELECT TOP 1 DON_HANG_ID
            FROM DON_HANG
            WHERE KHACH_HANG_ID = @KHACH_HANG_ID
            ORDER BY NGAY_TAO DESC
        `);

      targetOrderId = newestOrder.recordset[0]?.DON_HANG_ID ?? null;
    }
    if (targetOrderId) {

      const detailResult = await pool.request()
        .input("DON_HANG_ID", sql.NVarChar, targetOrderId)
        .query(`
                SELECT
                dh.DON_HANG_ID,
                dh.TRANG_THAI,
                dh.NGAY_TAO,
                dh.TONG_TIEN,
                ct.SAN_PHAM_ID

            FROM DON_HANG dh

            JOIN DON_HANG_CHI_TIET ct
                ON dh.DON_HANG_ID = ct.DON_HANG_ID

            JOIN SAN_PHAM sp
                ON sp.SAN_PHAM_ID = ct.SAN_PHAM_ID

            WHERE dh.DON_HANG_ID = @DON_HANG_ID
        `);

      if (detailResult.recordset.length > 0) {

        orderInfo = {

          order: {

            DON_HANG_ID: detailResult.recordset[0].DON_HANG_ID,

            TRANG_THAI: detailResult.recordset[0].TRANG_THAI,

            NGAY_TAO: detailResult.recordset[0].NGAY_TAO,

            TONG_TIEN: detailResult.recordset[0].TONG_TIEN
          },

          items: detailResult.recordset

        };

      }

    }

    // ----------------------------------------------------------------
    // 4. Lấy thông tin sản phẩm (nếu đang ở /product-detail/:id)
    // ----------------------------------------------------------------
    let productInfo = null;
    if (productId) {
      const productResult = await pool.request()
        .input('SAN_PHAM_ID', sql.NVarChar, productId)
        .query(`
          SELECT TOP 1
            SAN_PHAM_ID,
            TEN_SAN_PHAM,
            GIA,
            GIA_KHUYEN_MAI,
            MO_TA
        FROM SAN_PHAM
        WHERE SAN_PHAM_ID=@SAN_PHAM_ID
        `);
      productInfo = productResult.recordset[0] ?? null;
    }

    // ----------------------------------------------------------------
    // 5. Gọi n8n kèm toàn bộ context đã query
    // ----------------------------------------------------------------
    const n8nPayload = {

      chatInput,
      customerId,
      productId,
      orderId,
      customerInfo,
      productInfo,
      orderInfo

    };

    console.log('[CHAT] Gọi n8n với payload:', JSON.stringify(n8nPayload, null, 2));
    console.log("===== PAYLOAD =====");
    console.log(JSON.stringify(n8nPayload, null, 2));
    const n8nRes = await axios.post(N8N_WEBHOOK_URL, n8nPayload, {
      // AI/image workflows can take longer than 30 seconds to finish.
      timeout: 120000
    });

    return res.status(200).json(n8nRes.data);

  } 
  catch (error: any) {

  console.error("========== CHAT ERROR ==========");

  console.error(error);

  console.error("MESSAGE:");
  console.error(error.message);

  console.error("RESPONSE:");
  console.error(error.response?.data);

  console.error("===============================");

  return res.status(500).json({
    output: 'Xin lỗi, hệ thống đang gặp sự cố. Bạn thử lại nhé! 🌸'
  });
}
};

import {getActiveBom,makeBomSnapshot} from './inventory/bom.service.js';
import {getDesign,isDesignProduct,designFutureDay} from './design3d.service.js';
import { classifyDeliverySchedule } from './delivery-policy.service.js';
import { availableOf, ceilQty, finishedAvailableOf, roundQty } from './inventory/helpers.js';
import { MATERIAL_STATUS } from './inventory/constants.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { InventoryError, withTransaction } from './inventory/helpers.js';
import { INVENTORY_CONFIG, RESERVATION_STATUS } from './inventory/constants.js';
import { reserveProducts, reserveMaterialNeeds, sweepExpiredReservations } from './inventory/stock.service.js';
import { requestWorkflow } from './request-workflow.js';
import { requestByVerifiedPhone, createRequestAccess, lookupAccess } from './order-access.service.js';
import { emitAdminNotification } from './analytics/notifications.service.js';
import { cleanAddress } from './admin-order.service.js';

/** Checkout boundary check on the actual allocated stock; does not change the inventory schema. */
export async function assertReservedStockUsable(session: ClientSession, orderId: string, deliveryAt: string, salesReviewed = false) {
  const when = new Date(deliveryAt), now = new Date();
  const day = (v: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(v);
  const future = day(when) !== day(now);
  const holds = await (await getCollection<any>('GIU_TON')).find({ DON_HANG_ID: orderId, TRANG_THAI: { $in: [RESERVATION_STATUS.temporary, RESERVATION_STATUS.official] } }, { session }).toArray();
  const productIds = [...new Set(holds.filter(hold => hold.LOAI_DOI_TUONG === 'THANH_PHAM').map(hold => hold.SAN_PHAM_ID).filter(Boolean))];
  const materialIds = [...new Set(holds.filter(hold => hold.LOAI_DOI_TUONG !== 'THANH_PHAM').map(hold => hold.NGUYEN_VAT_LIEU_ID).filter(Boolean))];
  const receiptIds = [...new Set(holds.map(hold => hold.PHIEU_NHAP_NGUON).filter(Boolean))];
  const [products, materials, sources] = await Promise.all([
    productIds.length ? (await getCollection<any>('SAN_PHAM')).find({ SAN_PHAM_ID: { $in: productIds } }, { session }).toArray() : [],
    materialIds.length ? (await getCollection<any>('NGUYEN_VAT_LIEU')).find({ NGUYEN_VAT_LIEU_ID: { $in: materialIds } }, { session }).toArray() : [],
    receiptIds.length && materialIds.length ? (await getCollection<any>('CHI_TIET_PHIEU_NHAP_NVL')).find({
      PHIEU_NHAP_ID: { $in: receiptIds }, NGUYEN_VAT_LIEU_ID: { $in: materialIds }, LA_NGUON_NHAP: true,
    }, { session }).toArray() : [],
  ]);
  const productById = new Map(products.map(row => [row.SAN_PHAM_ID, row]));
  const materialById = new Map(materials.map(row => [row.NGUYEN_VAT_LIEU_ID, row]));
  const sourceByKey = new Map(sources.map(row => [`${row.PHIEU_NHAP_ID}:${row.NGUYEN_VAT_LIEU_ID}`, row]));
  for (const hold of holds) {
    const product = hold.LOAI_DOI_TUONG === 'THANH_PHAM';
    const item: any = product ? productById.get(hold.SAN_PHAM_ID) : materialById.get(hold.NGUYEN_VAT_LIEU_ID);
    const source: any = hold.PHIEU_NHAP_NGUON ? sourceByKey.get(`${hold.PHIEU_NHAP_NGUON}:${hold.NGUYEN_VAT_LIEU_ID}`) : item;
    if (!item || /ngừng|ngưng|khóa|hỏng/i.test(String(item.TRANG_THAI || ''))) throw new InventoryError(409, 'Thành phẩm hoặc nguyên liệu không còn đủ điều kiện sử dụng.');
    const expiration = source?.NGAY_HET_HAN || source?.HAN_SU_DUNG_DEN || source?.expiresAt;
    const expires = expiration ? new Date(expiration) : null;
    if (expires && (!Number.isFinite(expires.getTime()) || expires <= now || expires < when)) throw new InventoryError(409, 'Hàng đã hết hạn hoặc không bảo đảm hạn dùng tới lịch giao.');
    // The inventory module treats shelf days as a quality-review threshold, not a disposal date.
    const shelfDays = Number(item.SO_NGAY_BAO_QUAN || 0);
    const received = source?.THOI_DIEM_NHAN ? new Date(source.THOI_DIEM_NHAN).getTime() : NaN;
    const qualityUntil = Number.isFinite(received) && shelfDays > 0 ? received + shelfDays * 86400000 : NaN;
    // Số ngày bảo quản là cờ rà soát cho đơn tương lai, không phải ngày hết hạn
    // cứng. Đơn cùng ngày đã đủ tồn và giữ được nguồn thực tế thì đi tiếp.
    if (future && !product && item.NHOM_NVL === 'DE_HU' && !salesReviewed &&
      (!Number.isFinite(qualityUntil) || qualityUntil <= Math.max(now.getTime(), when.getTime()))) {
      throw new InventoryError(409, 'Nguồn hoa cần Sales xác minh chất lượng theo thời điểm nhận và số ngày bảo quản trước khi nhận cọc.');
    }
    if (future && !salesReviewed && !expires && (product || item.NHOM_NVL === 'DE_HU' && !Number.isFinite(qualityUntil))) throw new InventoryError(409, 'Đơn tương lai cần Sales xác minh hạn dùng, nguồn hoa và lịch chuẩn bị trước khi nhận cọc.');
  }
}

export const REQUESTS = 'YEU_CAU_DAT_HANG';
const CHECKOUTS = 'PHIEN_DAT_HANG';
export const REQUEST_STATUS = { waiting: 'Chờ xử lý', processing: 'Sales đang xử lý', quoted: 'Chờ khách xác nhận', accepted: 'Khách đã đồng ý',
  pendingPayment: 'Chờ khách thanh toán', converted: 'Đã lên đơn', rejected: 'Đã từ chối', closed: 'Đã tư vấn', cancelled: 'Khách đã hủy', expired: 'Hết hạn thanh toán' } as const;
/** Bản ghi cũ trên Atlas còn dùng tên trạng thái trước đây; đọc như "Chờ xử lý", không migrate dữ liệu. */
export const LEGACY_WAITING_STATUS = 'Chờ Sales tiếp nhận';
export const WAITING_STATUSES: string[] = [REQUEST_STATUS.waiting, LEGACY_WAITING_STATUS];
export const normalizeRequestStatus = (status: unknown) => status === LEGACY_WAITING_STATUS ? REQUEST_STATUS.waiting : String(status || '');
/** Đơn tạo từ yêu cầu sau khi Sales xác nhận, chờ khách thanh toán trong hạn. */
export const SALES_CONFIRMED_ORDER_STATUS = 'Đã xác nhận đơn hàng';

export const REQUEST_REASON = {
  custom: 'CUSTOM_DESIGN',
  materialShortage: 'MATERIAL_SHORTAGE_UNDER_24H',
  dataIncomplete: 'INVENTORY_DATA_INCOMPLETE',
} as const;
const REASON_TEXT: Record<string, string> = {
  [REQUEST_REASON.custom]: 'Bó hoa thiết kế riêng cần nhân viên xác nhận khả năng thực hiện, nguyên liệu, giá và lịch giao.',
  [REQUEST_REASON.materialShortage]: 'Lịch giao trong vòng 24 giờ nhưng shop chưa đủ hoa và nguyên liệu cho số lượng bạn chọn.',
  [REQUEST_REASON.dataIncomplete]: 'Shop cần kiểm tra lại công thức hoặc nguồn hoa của mẫu trước khi xác nhận.',
};
export const customerReasonText = (codes: string[]) => codes.map(code => REASON_TEXT[code]).filter(Boolean);

type CheckoutLine = { productId: string; quantity: number };

/**
 * Quyết định một lần Checkout đi thẳng thanh toán hay thành Yêu cầu đặt hàng.
 * Chỉ ĐỌC dữ liệu, không giữ tồn. Thời gian giao không hợp lệ/dưới 4 giờ sẽ ném lỗi 400.
 *  A. Còn dưới 24 giờ và NVL khả dụng không đủ cho phần phải cắm (sau khi dùng thành phẩm có sẵn).
 *  B. Có sản phẩm thiết kế riêng.
 *  C. Còn lại: thanh toán thẳng. Từ 24 giờ: không giữ tạm, lập nhu cầu NVL theo T sau khi thanh toán.
 * Một đơn thỏa nhiều điều kiện vẫn chỉ tạo MỘT yêu cầu, lưu đủ mọi nguyên nhân.
 */
export async function evaluateCheckoutFulfillment(lines: CheckoutLine[], delivery: { deliveryAt: string; deliveryStartAt?: string }, now = new Date(), session?: ClientSession) {
  const routing = classifyDeliverySchedule(delivery.deliveryAt, now, delivery.deliveryStartAt);
  const under24h = routing.scheduleClass === 'UNDER_24H';
  const merged = new Map<string, number>();
  for (const line of lines) merged.set(line.productId, (merged.get(line.productId) || 0) + Number(line.quantity || 0));
  const reasonCodes = new Set<string>();
  const dataIssues: string[] = [];
  const customItems: any[] = [];
  for (const [productId, quantity] of merged) {
    if (!isDesignProduct(productId)) continue;
    const design = await getDesign(productId, session);
    reasonCodes.add(REQUEST_REASON.custom);
    customItems.push({ productId, designId: design.designId, name: design.name, image: design.image || '', quantity,
      arrangement: design.arrangement, price: design.price, designFee: design.designFee, extraFee: design.extraFee,
      notes: design.badges, materials: design.materials.map((m: any) => ({ materialId: m.materialId, name: m.name, unit: m.unit,
        perUnit: m.quantity, required: roundQty(m.quantity * quantity), available: m.available, colors: m.colors || null })) });
  }
  const catalogIds = [...merged.keys()].filter(id => !isDesignProduct(id));
  const products = catalogIds.length ? await (await getCollection<any>('SAN_PHAM')).find({ SAN_PHAM_ID: { $in: catalogIds } }, { session }).toArray() : [];
  const productById = new Map(products.map(product => [String(product.SAN_PHAM_ID), product]));
  const needs = new Map<string, { required: number; usedBy: string[]; unit: string }>();
  const checkedLines: any[] = [];
  for (const productId of catalogIds) {
    const quantity = merged.get(productId)!;
    const product = productById.get(productId);
    if (!product) throw new InventoryError(404, 'Có sản phẩm không còn tồn tại. Vui lòng tải lại giỏ hàng.');
    const finishedAvailable = Math.max(0, Math.floor(finishedAvailableOf(product)));
    const toMake = Math.max(0, quantity - finishedAvailable);
    const { bom, lines: bomLines } = await getActiveBom(productId, session);
    const line: any = { productId, name: product.TEN_SAN_PHAM || productId, quantity, finishedAvailable, toMake,
      bom: bom ? { bomId: bom.BOM_ID, version: bom.PHIEN_BAN } : null,
      materials: bomLines.map(l => ({ materialId: l.NGUYEN_VAT_LIEU_ID, perUnit: Number(l.DINH_LUONG || 0), unit: l.DON_VI_TINH || '', required: ceilQty(Number(l.DINH_LUONG || 0) * toMake) })) };
    checkedLines.push(line);
    // Đủ thành phẩm để giao thì không cần xét BOM của sản phẩm đó.
    if (!toMake) continue;
    if (!bomLines.length) {
      reasonCodes.add(REQUEST_REASON.dataIncomplete);
      dataIssues.push(`${line.name}: chưa có BOM hiệu lực để tính NVL cho ${toMake} bó phải cắm.`);
      continue;
    }
    for (const material of line.materials) {
      if (!material.required) continue;
      const need = needs.get(material.materialId) || { required: 0, usedBy: [] as string[], unit: material.unit };
      need.required = roundQty(need.required + material.required);
      need.usedBy.push(productId);
      needs.set(material.materialId, need);
    }
  }
  const materialRows = needs.size ? await (await getCollection<any>('NGUYEN_VAT_LIEU')).find({ NGUYEN_VAT_LIEU_ID: { $in: [...needs.keys()] } }, { session }).toArray() : [];
  const materialById = new Map(materialRows.map(row => [String(row.NGUYEN_VAT_LIEU_ID), row]));
  const materialNeeds = [...needs.entries()].map(([materialId, need]) => {
    const material = materialById.get(materialId);
    const available = availableOf(material);
    return { materialId, name: material?.TEN_NGUYEN_VAT_LIEU || materialId, unit: material?.DON_VI_TINH || need.unit,
      required: need.required, available, missing: Math.max(0, roundQty(need.required - available)), usedBy: need.usedBy,
      inactive: !material || material.TRANG_THAI === MATERIAL_STATUS.hidden };
  });
  for (const need of materialNeeds) if (need.inactive) {
    reasonCodes.add(REQUEST_REASON.dataIncomplete);
    dataIssues.push(`${need.name}: NVL trong BOM không còn sử dụng.`);
  }
  // Điều kiện A chỉ áp dụng cho lịch giao dưới 24 giờ. Nhu cầu NVL dùng chung đã cộng dồn giữa các dòng.
  const shortages = under24h ? materialNeeds.filter(need => need.missing > 0) : [];
  if (shortages.length) reasonCodes.add(REQUEST_REASON.materialShortage);
  const codes = [...reasonCodes];
  return {
    mode: codes.length ? 'request' as const : 'direct' as const,
    inventoryMode: under24h ? 'HOLD_NOW' as const : 'FUTURE_DEMAND' as const,
    routing: { ...routing, requiresSales: codes.length > 0, reasonCodes: codes, reasons: customerReasonText(codes) },
    reasonCodes: codes,
    customerReasons: customerReasonText(codes),
    materialCheck: { evaluatedAt: now.toISOString(), under24h, lines: checkedLines, materials: materialNeeds, shortages },
    customItems,
    dataIssues,
  };
}

/** The browser keeps this key through retries. A persisted outcome never reserves twice. */
export async function routeCheckout(
  key: string,
  payload: any,
  items: { productId: string; quantity: number }[],
  create: (session: ClientSession, orderId: string, prepared?: any) => Promise<any>,
  prepare?: (session: ClientSession) => Promise<any>,
  options: { staffCreated?: boolean } = {},
) {
  if (!/^[\w-]{16,100}$/.test(key)) throw new InventoryError(400, 'Thiếu mã phiên đặt hàng hợp lệ. Vui lòng tải lại trang.');
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const sessions = await getCollection<any>(CHECKOUTS);
  const existingOutcome = async () => {
    const existing = await sessions.findOne({ _id: key });
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) throw new InventoryError(409, 'Phiên này đã gửi nội dung khác. Vui lòng bắt đầu lần đặt hàng mới.');
    return existing.result;
  };
  const old = await existingOutcome();
  if (old) return old;
  // Inventory cleanup already runs every 60 seconds. Triggering it here is only
  // a best-effort safety net and must never make a customer wait behind up to
  // 200 expired reservations and their transactions.
  void sweepExpiredReservations().catch(error => console.error('[checkout] Không quét được giữ tồn hết hạn', error));
  // Unique order ID: scanning max(existing)+1 races between different buyers.
  const orderId = `YEN${randomBytes(8).toString('hex').toUpperCase()}`;
  let shortage: InventoryError | undefined;
  let evaluation: Awaited<ReturnType<typeof evaluateCheckoutFulfillment>> | undefined;
  let prepared = payload;
  try {
    return await withTransaction(async session => {
      await sessions.insertOne({ _id: key, fingerprint, createdAt: new Date() }, { session });
      if (prepare) prepared = await prepare(session);
      const delivery = prepared.delivery || {};
      if (!delivery.deliveryAt) throw new InventoryError(400, 'Cần ngày và giờ giao hợp lệ.');
      // Thời gian giao ngoài 08:00–22:00, đã qua hoặc dưới 4 giờ: lỗi 400, không tạo yêu cầu.
      evaluation = await evaluateCheckoutFulfillment(items, delivery, new Date(), session);
      // Nhân viên (Sales/Admin) tạo đơn: đã tự kiểm tra tồn với khách nên tạo THẲNG đơn hàng, không qua Yêu cầu đặt hàng.
      // Thiếu NVL thì không giữ tạm; sau thanh toán hệ thống lập nhu cầu NVL như đơn giao xa.
      if (options.staffCreated && evaluation.mode === 'request') {
        prepared = { ...prepared, inventoryMode: 'FUTURE_DEMAND', staffOverride: { reasonCodes: evaluation.reasonCodes, reasons: evaluation.customerReasons } };
        const result = { kind: 'order', ...await create(session, orderId, prepared) };
        await sessions.updateOne({ _id: key }, { $set: { result } }, { session });
        return result;
      }
      try {
        if (evaluation.mode === 'request') throw new InventoryError(409, evaluation.customerReasons.join(' '), { evaluation });
        if (evaluation.inventoryMode === 'HOLD_NOW') {
          // Dưới 24 giờ: giữ tạm thành phẩm + NVL ngay khi tạo QR. Thiếu do tranh chấp → vẫn chuyển thành yêu cầu.
          await reserveProducts(items, {
            orderId, paymentSessionId: key, status: RESERVATION_STATUS.temporary,
            actor: { id: payload.customerId || null, role: 'customer' },
          }, session);
          await assertReservedStockUsable(session, orderId, delivery.deliveryAt);
        } else {
          // Từ 24 giờ: không giữ tạm. Thanh toán hợp lệ mới lập nhu cầu NVL theo T.
          prepared = { ...prepared, inventoryMode: 'FUTURE_DEMAND' };
        }
      } catch (error) {
        if (error instanceof InventoryError && error.status === 409) shortage = error;
        throw error;
      }
      const result = { kind: 'order', ...await create(session, orderId, prepared) };
      await sessions.updateOne({ _id: key }, { $set: { result } }, { session });
      return result;
    });
  } catch (error: any) {
    // A double click can race before the first transaction commits.
    if (error.code === 11000) {
      const old = await existingOutcome();
      if (old) return old;
    }
    if (error !== shortage) throw error;
    // Đơn nhân viên tạo không bao giờ đổi thành Yêu cầu đặt hàng: báo lỗi giữ tồn để nhân viên xử lý.
    if (options.staffCreated) throw new InventoryError(409, `Không giữ được tồn kho: ${shortage?.message || 'thiếu hàng'} Vui lòng kiểm tra tồn rồi tạo lại.`);
  }
  // Reservation transaction has rolled back ALL lines. A request creates no order, payment or stock movement.
  const requestId = `YC${randomBytes(8).toString('hex').toUpperCase()}`;
  const details: any = shortage?.details || {};
  const checked = details.evaluation || evaluation;
  const reasonCodes: string[] = [...(checked?.reasonCodes || [])];
  // Giữ tồn thất bại dù kiểm tra trước đó đủ (đơn khác vừa giữ, hoặc nguồn hoa cần xác minh hạn dùng).
  if (!details.evaluation) reasonCodes.push(/xác minh/i.test(String(shortage?.message)) ? REQUEST_REASON.dataIncomplete : REQUEST_REASON.materialShortage);
  const codes = [...new Set(reasonCodes)];
  const reviewReason = customerReasonText(codes).join(' ');
  const routing = { ...(checked?.routing || {}), requiresSales: true, reasonCodes: codes, reasons: customerReasonText(codes) };
  const result: any = { kind: 'sales_request', requestId, status: REQUEST_STATUS.waiting, reasonCodes: codes, reasons: customerReasonText(codes),
    message: `${reviewReason} Shop đã tiếp nhận Yêu cầu đặt hàng ${requestId}. Đây chưa phải đơn đã xác nhận; bạn chưa cần thanh toán.` };
  try {
    return await withTransaction(async session => {
      if (!payload.customerId) {
        const access = await createRequestAccess(requestId, session);
        Object.assign(result, { requestAccessToken: access.accessToken, requestAccessExpiresAt: access.expiresAt,
          requestUrl: `/order-request/${requestId}#access=${access.accessToken}` });
      }
      await sessions.insertOne({ _id: key, fingerprint, result, createdAt: new Date() }, { session });
      const products = await getCollection<any>('SAN_PHAM');
      // Fetch every product in one round trip. The old per-line findOne loop
      // made a Sales request increasingly slow for a cart with many flowers.
      const productRows = await products.find({ SAN_PHAM_ID: { $in: items.map(item => item.productId) } }, { session }).toArray();
      const productById = new Map(productRows.map(product => [String(product.SAN_PHAM_ID), product]));
      const customById = new Map((checked?.customItems || []).map((item: any) => [String(item.productId), item]));
      const snapshot = items.map(item => {
        const product = productById.get(item.productId);
        const custom: any = customById.get(item.productId);
        const priced = prepared.items?.find((line: any) => line.id === item.productId);
        return { ...item, name: priced?.name || custom?.name || product?.TEN_SAN_PHAM || item.productId,
          price: Number(priced?.price ?? custom?.price ?? product?.GIA ?? 0), image: priced?.image || custom?.image || '',
          ...(custom ? { custom: true, designId: custom.designId } : {}) };
      });
      const requestDocument = {
        _id: requestId, requestId,
        status: REQUEST_STATUS.waiting, assignedTo: null, assignedName: null,
        sender: payload.sender, receiver: payload.receiver ? { ...payload.receiver, address: cleanAddress(payload.receiver.address) } : payload.receiver, delivery: { ...payload.delivery, deliveryAt: prepared.delivery?.deliveryAt, deliveryStartAt: prepared.delivery?.deliveryStartAt },
        flags: payload.flags || {}, giftCard: prepared.giftCard || null, originalSummary: prepared.summary || {},
        customerId: payload.customerId || null, items: snapshot,
        reason: shortage!.message, shortages: details.evaluation ? null : details,
        requestReason: codes[0] || REQUEST_REASON.materialShortage, reasonCodes: codes, reviewReason, routing,
        // Căn cứ cho Sales: tồn thành phẩm, BOM, nhu cầu NVL gộp, phần thiếu, thiết kế riêng.
        materialCheck: checked?.materialCheck || null, customDesigns: checked?.customItems || [], dataIssues: [...(checked?.dataIssues || []), ...(details.evaluation ? [] : [String(shortage!.message)])],
        createdAt: new Date(), updatedAt: new Date(), version: 0,
        history: [{ id: randomUUID(), at: new Date(), action: `Tạo yêu cầu: ${customerReasonText(codes).join(' ') || 'cần Sales xem xét'}` }],
      };
      await (await getCollection<any>(REQUESTS)).insertOne(requestDocument, { session });
      if (requestDocument.customerId) {
        const { orderEvent } = await import('./admin-order.service.js');
        await orderEvent(session, `${requestId}:created`, requestDocument.customerId, null, 'Shop đã nhận yêu cầu đặt hoa', `Yêu cầu ${requestId} đang chờ nhân viên xử lý.`, `/order-request/${requestId}`);
      }
      const workflow = requestWorkflow(requestDocument);
      await emitAdminNotification({
        key: `SALES_REQUEST_NEW:${requestId}`, type: 'SALES_REQUEST_NEW', group: 'Đơn hàng', priority: 'Cao',
        module: 'orders', stateful: true, entityId: requestId,
        title: `Yêu cầu đặt hàng mới — ${requestId}`,
        message: `${workflow.priorityLabel} · ${workflow.totalQuantity} bó · ${workflow.priorityReasons.join('; ') || 'Sales kiểm tra và tiếp nhận'}`,
        link: '/orders/requests', queryParams: { requestId },
      }, session);
      return result;
    });
  } catch (error: any) {
    if (error.code === 11000) {
      const old = await existingOutcome();
      if (old) return old;
    }
    throw error;
  }
}

export function publicRequest(row: any) {
  const hasProposal = !!row.quote;
  const requestUpdatedByProposal = hasProposal && row.acceptance?.via !== 'sales_direct_confirmation';
  const displayedItems = hasProposal ? row.quote.items.map((item: any) => ({
    productId: item.id, name: item.name, quantity: item.qty, price: item.price, image: item.image,
    custom: !!item.custom, bom: item.bom || null, description: item.description || '',
  })) : row.items;
  return { requestId: row.requestId, status: normalizeRequestStatus(row.status), items: displayedItems, delivery: hasProposal ? row.quote.delivery : row.delivery,
    giftCard: hasProposal ? row.quote.giftCard ?? row.giftCard ?? null : row.giftCard ?? null,
    originalItems: hasProposal ? row.items : null, originalDelivery: hasProposal ? row.delivery : null,
    requestUpdatedByProposal,
    requestReason: row.requestReason || null, routing: row.routing ? { scheduleClass: row.routing.scheduleClass, deliveryAt: row.routing.deliveryAt, minutesUntilDelivery: row.routing.minutesUntilDelivery } : null,
    reasons: customerReasonText(row.reasonCodes || []),
    reviewReason: row.reviewReason || (row.requestReason === 'future_delivery'
      ? 'Bạn chọn lịch giao ở ngày tương lai. Shop cần xác minh nguồn hoa, lịch chuẩn bị và khả năng giao trước khi xác nhận đơn.'
      : 'Tồn thành phẩm hiện không đủ; phần còn lại cũng chưa đủ nguyên vật liệu trong BOM để đáp ứng toàn bộ yêu cầu.'),
    createdAt: row.createdAt, updatedAt: row.updatedAt, customerAcceptedAt: row.customerAcceptedAt || row.acceptedAt || null,
    paymentDeadlineAt: row.paymentDeadlineAt || null, customerMessage: row.customerMessage || '',
    assignedName: row.assignedName || null, originalTotal: row.originalSummary?.total ?? null, quote: row.quote || null, acceptedQuoteId: row.acceptedQuoteId || null,
    workflow: requestWorkflow(row), orderSummary: row.orderSummary || null,
    orderResult: row.orderResult || null, checkoutData: row.checkoutData || null };
}

export async function getPublicRequest(id: string, token: string) {
  const row = await requestByVerifiedPhone(id, token);
  if (!row) throw new InventoryError(404, 'Không tìm thấy yêu cầu.');
  if (row.orderId) {
    const order = await (await getCollection<any>('DON_HANG')).findOne({ DON_HANG_ID: row.orderId });
    const payment = await (await getCollection<any>('THANH_TOAN')).find({ DON_HANG_ID: row.orderId }).sort({ NGAY_THANH_TOAN: -1 }).limit(1).next();
    row.orderSummary = { status: order?.TRANG_THAI || 'Đã tạo đơn', paymentStatus: payment?.TRANG_THAI_THANH_TOAN || 'Chưa ghi nhận',
      hasPaid: ['Thành công','Đã thanh toán','Đã cọc','Thanh toán thành công'].includes(payment?.TRANG_THAI_THANH_TOAN) };
    if (payment && row.orderResult) row.orderResult = { ...row.orderResult, paymentId: payment.THANH_TOAN_ID, transactionCode: payment.MA_GIAO_DICH,
      paymentAmount: payment.SO_TIEN, paymentStatus: payment.TRANG_THAI_THANH_TOAN,
      paymentDeadline: row.paymentDeadlineAt ? new Date(row.paymentDeadlineAt).toISOString()
        : payment.HET_HAN_LUC ? new Date(payment.HET_HAN_LUC).toISOString()
        : new Date(new Date(payment.NGAY_THANH_TOAN).getTime() + INVENTORY_CONFIG.holdMinutes * 60000).toISOString() };
  }
  return publicRequest(row);
}

export async function updateSalesRequest(id: string, body: any, employee: any) {
  if (!Number.isInteger(body.version)) throw new InventoryError(400, 'Thiếu phiên bản yêu cầu.');
  const requests = await getCollection<any>(REQUESTS);
  const row = await requests.findOne({ _id: id });
  if (!row) throw new InventoryError(404, 'Không tìm thấy yêu cầu.');
  const rowVersion = Number.isInteger(row.version) ? row.version : 0;
  if (rowVersion !== body.version) throw new InventoryError(409, 'Yêu cầu vừa thay đổi. Vui lòng tải lại.');
  const claim = body.action === 'claim';
  const editable = [REQUEST_STATUS.processing, REQUEST_STATUS.quoted, REQUEST_STATUS.accepted];
  if (claim ? !WAITING_STATUSES.includes(row.status) : !editable.includes(row.status) || row.assignedTo !== employee.NHAN_VIEN_ID) {
    throw new InventoryError(409, 'Yêu cầu đã được tiếp nhận hoặc không thuộc phần xử lý của bạn.');
  }
  if (!['claim', 'note', 'reject', 'close'].includes(body.action)) throw new InventoryError(400, 'Thao tác không hợp lệ.');
  if (body.action === 'close' && row.status !== REQUEST_STATUS.processing) throw new InventoryError(409, 'Phương án đang xử lý phải được lên đơn hoặc từ chối kèm lý do.');
  const note = String(body.note || '').trim();
  if (!claim && (!note || note.length > 2000)) throw new InventoryError(400, 'Nhập nội dung xử lý từ 1–2000 ký tự.');
  const status = claim ? REQUEST_STATUS.processing : body.action === 'reject' ? REQUEST_STATUS.rejected : body.action === 'close' ? REQUEST_STATUS.closed : row.status;
  const versionFilter = Number.isInteger(row.version) ? { version: row.version } : { $or: [{ version: { $exists: false } }, { version: null }] };
  const updated = await requests.findOneAndUpdate({ _id: id, status: row.status, ...versionFilter }, {
    $set: { status, updatedAt: new Date(), ...(body.action === 'reject' ? { acceptedQuoteId: null } : {}), ...(claim ? { assignedTo: employee.NHAN_VIEN_ID, assignedName: employee.HO_TEN || employee.TEN || employee.NHAN_VIEN_ID } : { customerMessage: note }) },
    $inc: { version: 1 },
    $push: { history: { id: randomUUID(), actor: employee.NHAN_VIEN_ID, at: new Date(), action: body.action, note } },
  } as any, { returnDocument: 'after', includeResultMetadata: false });
  if (!updated) throw new InventoryError(409, 'Có nhân viên khác vừa cập nhật. Vui lòng tải lại.');
  if (claim || body.action === 'reject') {
    const { orderEvent } = await import('./admin-order.service.js');
    await orderEvent(undefined, `${id}:${body.action}:${updated.version}`, updated.customerId || null, null,
      claim ? 'Sales đã tiếp nhận yêu cầu' : 'Shop đã từ chối yêu cầu',
      claim ? 'Nhân viên đang kiểm tra khả năng đáp ứng và sẽ liên hệ với bạn.' : note,
      `/order-request/${id}`);
  }
  return updated;
}

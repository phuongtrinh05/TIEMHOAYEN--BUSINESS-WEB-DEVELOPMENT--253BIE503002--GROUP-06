import { ObjectId } from 'mongodb';
import { COLLECTIONS, DOC_STATUS, EXPORT_TYPES, IMPORT_TYPES, PO_STATUS, ITEM_KIND, MOVEMENT_TYPES, RESERVATION_STATUS, DEMAND_STATUS } from './constants.js';
import { col, InventoryError, roundQty, withTransaction, type Actor } from './helpers.js';
import { applyMaterialDelta, applyFinishedDelta } from './ledger.js';

/** Reverse a mistaken posting with linked PO/return bookkeeping in the same transaction. */
export const reverseInventoryDocument = async (kind: 'import' | 'export', id: string, body: any, actor: Actor) => {
  const reason = String(body.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) throw new InventoryError(400, 'Nhập lý do đảo phiếu từ 5–1000 ký tự.');
  if (body.physicallyVerified !== true) throw new InventoryError(400, 'Cần xác nhận đã kiểm tra tồn thực tế và đây là ghi nhận sai, không phải hoàn hàng.');
  return withTransaction(async session => {
    const documents = await col(kind === 'import' ? COLLECTIONS.importSlip : COLLECTIONS.exportSlip);
    const field = kind === 'import' ? 'PHIEU_NHAP_ID' : 'PHIEU_XUAT_ID';
    const original = await documents.findOne({ [field]: id }, { session });
    if (!original) throw new InventoryError(404, 'Không tìm thấy phiếu gốc.');
    const corrections = await col('DIEU_CHINH_KHO');
    const prior = await corrections.findOne({ _id: `${kind}:${id}` as any }, { session });
    if (prior) return { correction: prior, alreadyReversed: true };
    if (original.DA_DAO) throw new InventoryError(409, 'Phiếu đã đảo; cần kiểm tra chứng từ đảo đã lưu.');
    if (original.TRANG_THAI !== DOC_STATUS.posted) throw new InventoryError(409, 'Chỉ đảo phiếu đã ghi nhận theo nghiệp vụ kho mới.');
    if (kind === 'import') {
      const postedAt = new Date(original.NGAY_XAC_NHAN).getTime();
      if (!original.NGAY_XAC_NHAN || !Number.isFinite(postedAt) || postedAt > Date.now()) throw new InventoryError(409, 'Thiếu hoặc sai thời điểm ghi nhận PN; cần đối soát trước khi đảo.');
      if (Date.now() >= postedAt + 24 * 60 * 60 * 1000) throw new InventoryError(409, 'Đã quá hạn đảo phiếu nhập (24 giờ từ lúc ghi nhận). Hãy lập điều chỉnh chênh lệch có lý do.');
    }
    if (original.DIEU_CHINH?.length) throw new InventoryError(409, 'Phiếu đã có điều chỉnh; tiếp tục lập điều chỉnh chênh lệch thay vì đảo toàn phiếu.');
    const linkedOrder = kind === 'export' && original.LOAI_XUAT === EXPORT_TYPES.order && original.DON_HANG_ID;
    const production = kind === 'export' && original.LOAI_XUAT === EXPORT_TYPES.readyMade;
    if (original.DON_HANG_ID && !linkedOrder) throw new InventoryError(409, 'Loại phiếu không khớp nghiệp vụ đơn hàng.');
    let order: any = null;
    if (linkedOrder) {
      order = await (await col(COLLECTIONS.order)).findOne({DON_HANG_ID: original.DON_HANG_ID}, {session});
      if (!order || !['Chờ xử lý', 'Đang xử lý', 'Đang chuẩn bị hàng', 'Đang chuẩn bị', 'Đang cắm'].includes(order.TRANG_THAI)
        || order.PHIEU_XUAT_NVL_ID !== id) throw new InventoryError(409, 'Đơn hàng đã chuyển bước/giao/hủy hoặc liên kết PX đã đổi; cần đối soát riêng.');
    }
    const details = await (await col(kind === 'import' ? COLLECTIONS.importDetail : COLLECTIONS.exportDetail)).find({ [field]: id }, { session }).toArray();
    if (!details.length) throw new InventoryError(409, 'Phiếu thiếu chi tiết gốc, không thể đảo.');
    if (kind === 'import') {
      for (const d of details) {
        if (!d.LA_NGUON_NHAP || Number(d.SL_DANG_GIU || 0) || Number(d.SL_HONG || 0)
          || Number(d.SL_DA_XUAT || 0) || Number(d.SL_DA_HUY || 0)
          || roundQty(d.SL_CON_LAI) !== roundQty(d.SL_DAT)) {
          throw new InventoryError(409, `Nguồn ${id}/${d.NGUYEN_VAT_LIEU_ID} đã được dùng, giữ hoặc điều chỉnh; không thể đảo toàn phiếu.`);
        }
      }
    } else if (details.some(d => (d.PHAN_BO || []).some((a: any) => Number(a.SL_DA_HOAN || 0) > 0))) {
      throw new InventoryError(409, 'Phiếu xuất đã có nhập hoàn; cần đối soát phiếu hoàn trước.');
    }
    const movements = await (await col(COLLECTIONS.movement)).find({ CHUNG_TU_ID: id, LOAI_CHUNG_TU: kind === 'import' ? 'PN' : 'PX' }, { session }).sort({ THOI_DIEM: -1, _id: -1 }).toArray();
    const materialMoves = movements.filter(m => m.LOAI_DOI_TUONG === ITEM_KIND.material);
    const finishedMoves = movements.filter(m => m.LOAI_DOI_TUONG === ITEM_KIND.finishedGood);
    if ((kind === 'export' && !movements.length) || movements.some(m => ![ITEM_KIND.material, ITEM_KIND.finishedGood].includes(m.LOAI_DOI_TUONG))
      || (!production && finishedMoves.length) || materialMoves.some(m => Number(m.DELTA_DANG_GIU || 0) && (!linkedOrder || m.LOAI !== MOVEMENT_TYPES.endReservation || Number(m.DELTA_DANG_GIU) > 0))) {
      throw new InventoryError(409, 'Không có đủ sổ kho độc lập để đảo phiếu an toàn.');
    }
    if (kind === 'import' && (details.some(d => roundQty(movements.filter(m => m.NGUYEN_VAT_LIEU_ID === d.NGUYEN_VAT_LIEU_ID && m.PHIEU_NHAP_NGUON === id).reduce((n, m) => n + Number(m.DELTA_TON_THUC || 0), 0)) !== roundQty(d.SL_DAT))
      || movements.some(m => m.PHIEU_NHAP_NGUON !== id || !details.some(d => d.NGUYEN_VAT_LIEU_ID === m.NGUYEN_VAT_LIEU_ID)))) {
      throw new InventoryError(409, 'Sổ kho không khớp chi tiết nhập gốc; cần đối soát trước khi đảo.');
    }
    if (kind === 'import' && original.PO_ID) {
      const pos = await col(COLLECTIONS.purchaseOrder);
      const po = await pos.findOne({ PO_ID: original.PO_ID }, { session });
      if (!po) throw new InventoryError(409, 'Không tìm thấy PO gốc để đối soát.');
      const lines = (po.CHI_TIET || []).map((line: any) => {
        const d = details.find(d => d.NGUYEN_VAT_LIEU_ID === line.NGUYEN_VAT_LIEU_ID);
        if (!d) return line;
        const received = roundQty(Number(line.SL_DA_NHAN || 0) - Number(d.SL_THUC_NHAN || 0));
        const accepted = roundQty(Number(line.SL_DAT_DA_NHAN || 0) - Number(d.SL_DAT || 0));
        if (received < 0 || accepted < 0) throw new InventoryError(409, 'Số đã nhận của PO không khớp phiếu nhập gốc.');
        return { ...line, SL_DA_NHAN: received, SL_DAT_DA_NHAN: accepted };
      });
      if (details.some(d => !lines.some((l: any) => l.NGUYEN_VAT_LIEU_ID === d.NGUYEN_VAT_LIEU_ID))) throw new InventoryError(409, 'Dòng PN không khớp PO gốc.');
      const reopen = po.TRANG_THAI === PO_STATUS.done && lines.some((l: any) => l.SL_DA_NHAN < l.SL_DAT);
      await pos.updateOne({ _id: po._id }, { $set: { CHI_TIET: lines,
        ...(reopen ? { TRANG_THAI: po.TRANG_THAI_TRUOC_HOAN_TAT || original.PO_TRANG_THAI_TRUOC_NHAN || PO_STATUS.shipping } : {}),
        NGUOI_CAP_NHAT: actor.id, NGAY_CAP_NHAT: new Date() }, ...(reopen ? { $unset: { NGAY_HOAN_TAT: '' } } : {}) }, { session });
    }
    if (kind === 'import' && original.LOAI_NHAP === IMPORT_TYPES.return) {
      const exports = await col(COLLECTIONS.exportDetail);
      const parent = await (await col(COLLECTIONS.exportSlip)).findOne({ PHIEU_XUAT_ID: original.PX_GOC_ID, TRANG_THAI: DOC_STATUS.posted, DA_DAO: { $ne: true } }, { session });
      if (!parent) throw new InventoryError(409, 'Phiếu xuất gốc không còn hợp lệ để đảo nhập hoàn.');
      for (const d of details) {
        const line = await exports.findOne({ PHIEU_XUAT_ID: original.PX_GOC_ID, NGUYEN_VAT_LIEU_ID: d.NGUYEN_VAT_LIEU_ID }, { session });
        if (!line || !d.PHAN_BO_NGUON_GOC?.length) throw new InventoryError(409, 'Thiếu phân bổ nguồn gốc của phiếu hoàn.');
        const allocations = (line.PHAN_BO || []).map((a: any) => ({ ...a }));
        for (const returned of d.PHAN_BO_NGUON_GOC) {
          let rest = Number(returned.SO_LUONG);
          for (const a of allocations) {
            if (a.PHIEU_NHAP_ID !== returned.PHIEU_NHAP_ID || Number(a.DON_GIA_VON) !== Number(returned.DON_GIA_VON)) continue;
            const take = Math.min(rest, Number(a.SL_DA_HOAN || 0));
            a.SL_DA_HOAN = roundQty(Number(a.SL_DA_HOAN || 0) - take); rest = roundQty(rest - take);
          }
          if (rest > 0) throw new InventoryError(409, 'Lượng đã hoàn trên PX không khớp PN gốc.');
        }
        await exports.updateOne({ _id: line._id }, { $set: { PHAN_BO: allocations } }, { session });
      }
    }
    if (kind === 'export' && details.some(d => roundQty(-materialMoves.filter(m => m.NGUYEN_VAT_LIEU_ID === d.NGUYEN_VAT_LIEU_ID).reduce((n,m) => n + Number(m.DELTA_TON_THUC || 0),0)) !== roundQty(d.SO_LUONG_XUAT))) throw new InventoryError(409, 'Sổ kho không khớp chi tiết xuất gốc.');
    const correctionId = `DC${new ObjectId().toHexString().toUpperCase()}`;
    await documents.updateOne({ [field]: id }, { $set: { DA_DAO: true, ...(linkedOrder ? {TRANG_THAI: DOC_STATUS.reversed} : {}), DIEU_CHINH_ID: correctionId, NGUOI_DAO: actor.id, NGAY_DAO: new Date(), LY_DO_DAO: reason } }, { session });
    if (production) {
      if (finishedMoves.length !== 1 || finishedMoves[0].SAN_PHAM_ID !== original.SAN_PHAM_ID || Number(finishedMoves[0].DELTA_TON_THUC) !== Number(original.SO_BO)) throw new InventoryError(409, 'Thiếu sổ nhập thành phẩm để đảo sản xuất.');
      const products = await col(COLLECTIONS.product);
      const product = await products.findOne({SAN_PHAM_ID: original.SAN_PHAM_ID}, {session});
      if (!product) throw new InventoryError(409, 'Không tìm thấy thành phẩm.');
      const after = Number(product.TON_THANH_PHAM || 0) - Number(original.SO_BO);
      const value = Number(product.TON_THANH_PHAM || 0) * Number(product.GIA_VON_THANH_PHAM || 0) - Number(original.SO_BO) * Number(finishedMoves[0].DON_GIA_VON || 0);
      if (after > 0 && value < -1) throw new InventoryError(409, 'Giá trị thành phẩm không đủ để đảo.');
      await applyFinishedDelta(session, {productId: original.SAN_PHAM_ID, dOnHand: -Number(original.SO_BO), type: 'DAO_CAM_SAN', docType: 'DIEU_CHINH', docId: correctionId, unitCost: finishedMoves[0].DON_GIA_VON, note: `${reason} · PX gốc ${id}`, actor});
      await products.updateOne({_id: product._id}, {$set: {GIA_VON_THANH_PHAM: after > 0 ? Math.max(0, Math.round(value / after)) : 0}}, {session});
    }
    for (const m of materialMoves.filter(m => Number(m.DELTA_TON_THUC || 0) || Number(m.DELTA_KHONG_DAT || 0))) {
      const delta = -Number(m.DELTA_TON_THUC || 0);
      const materials = await col(COLLECTIONS.material);
      const material = await materials.findOne({ NGUYEN_VAT_LIEU_ID: m.NGUYEN_VAT_LIEU_ID }, { session });
      const qty = Number(material?.TON_THUC || 0);
      const remaining = roundQty(qty + delta);
      const value = qty * Number(material?.GIA_VON_BQ || 0) + delta * Number(m.DON_GIA_VON || 0);
      if (remaining > 0 && value < -1) throw new InventoryError(409, 'Giá trị tồn đã thay đổi, cần đối soát giá vốn trước khi đảo.');
      await applyMaterialDelta(session, {
        materialId: m.NGUYEN_VAT_LIEU_ID, sourceId: m.PHIEU_NHAP_NGUON,
        dOnHand: delta, dDamaged: -Number(m.DELTA_KHONG_DAT || 0),
        type: kind === 'import' ? 'DAO_NHAP' : 'DAO_XUAT', docType: 'DIEU_CHINH', docId: correctionId,
        unitCost: m.DON_GIA_VON, note: `${reason} · Phiếu gốc ${id}`, actor,
        sourceExtraInc: kind === 'export' ? (original.LOAI_XUAT === EXPORT_TYPES.quarantineDisposal ? { SL_DA_HUY: -delta } : { SL_DA_XUAT: -delta }) : undefined,
      });
      await materials.updateOne({ NGUYEN_VAT_LIEU_ID: m.NGUYEN_VAT_LIEU_ID }, { $set: { GIA_VON_BQ: remaining > 0 ? Math.max(0, Math.round(value / remaining)) : 0 } }, { session });
    }
    if (linkedOrder) {
      const reservations = await col(COLLECTIONS.reservation);
      const ended = await reservations.find({PHIEU_XUAT_ID: id, DON_HANG_ID: original.DON_HANG_ID, TRANG_THAI: RESERVATION_STATUS.finished, LOAI_DOI_TUONG: ITEM_KIND.material}, {session}).toArray();
      const holdMoves = materialMoves.filter(m => Number(m.DELTA_DANG_GIU || 0));
      if (holdMoves.length !== ended.length || ended.some(r => !holdMoves.some(m => m.MA_GIU_TON === r.MA_GIU_TON && -Number(m.DELTA_DANG_GIU) === Number(r.SO_LUONG)))) throw new InventoryError(409, 'Sổ kết thúc giữ không khớp; cần đối soát trước khi đảo.');
      let restored = 0;
      for (const r of ended) {
        const temporary = !r.XAC_NHAN_LUC && !!r.HET_HAN_LUC;
        const expired = temporary && new Date(r.HET_HAN_LUC).getTime() <= Date.now();
        if (!expired) {
          await applyMaterialDelta(session, {materialId: r.NGUYEN_VAT_LIEU_ID, sourceId: r.PHIEU_NHAP_NGUON || null, dReserved: Number(r.SO_LUONG), type: 'KHOI_PHUC_GIU', docType: 'DIEU_CHINH', docId: correctionId, orderId: original.DON_HANG_ID, reservationId: r.MA_GIU_TON, note: `${reason} · Đảo PX ${id}`, actor});
          restored++;
        }
        await reservations.updateOne({_id: r._id}, {$set: {TRANG_THAI: expired ? RESERVATION_STATUS.released : temporary ? RESERVATION_STATUS.temporary : RESERVATION_STATUS.official, DIEU_CHINH_ID: correctionId}, $unset: {PHIEU_XUAT_ID: '', KET_THUC_LUC: ''}}, {session});
      }
      await (await col(COLLECTIONS.demand)).updateMany({DON_HANG_ID: original.DON_HANG_ID, PHIEU_XUAT_ID: id, TRANG_THAI: DEMAND_STATUS.issued}, {$set: {TRANG_THAI: restored ? DEMAND_STATUS.reserved : DEMAND_STATUS.waiting}, $unset: {PHIEU_XUAT_ID: ''}}, {session});
      await (await col(COLLECTIONS.order)).updateOne({_id: order._id}, {$set: {DA_XUAT_NVL: false, DIEU_CHINH_XUAT_NVL_ID: correctionId}, $unset: {PHIEU_XUAT_NVL_ID: '', NGAY_XUAT_NVL: ''}}, {session});
    }
    const correction = { _id: `${kind}:${id}`, DIEU_CHINH_ID: correctionId, LOAI: kind === 'import' ? 'Đảo phiếu nhập' : 'Đảo phiếu xuất', PHIEU_GOC_ID: id, PO_ID: original.PO_ID || null, PX_GOC_ID: original.PX_GOC_ID || null,
      LY_DO: reason, XAC_NHAN_THUC_TE: true, NGUOI_XAC_NHAN: actor.id, NGAY_XAC_NHAN: new Date(), TRANG_THAI: DOC_STATUS.posted };
    await corrections.insertOne(correction as any, { session });
    return { correction, alreadyReversed: false };
  });
};

/** Physical count correction: immutable signed deltas, no changes to original accepted/PO quantities. */
export const adjustImportDocument = async (id: string, body: any, actor: Actor) => {
  const reason = String(body.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000 || body.physicallyVerified !== true) throw new InventoryError(400, 'Cần lý do 5–1000 ký tự và xác nhận kiểm tra tồn thực tế.');
  const requestId = String(body.requestId || '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new InventoryError(400, 'Mã yêu cầu điều chỉnh không hợp lệ.');
  if (!Array.isArray(body.details) || !body.details.length || body.details.length > 100) throw new InventoryError(400, 'Chọn từ 1–100 dòng điều chỉnh.');
  const lines = body.details.map((d: any) => {
    const quantity = Number(d.quantity);
    if (!Number.isFinite(quantity) || !quantity || Math.abs(quantity) > 1e9 || roundQty(quantity) !== quantity) throw new InventoryError(400, 'Chênh lệch phải khác 0, hữu hạn và tối đa 3 số thập phân.');
    return { materialId: String(d.materialId || ''), quantity };
  }).sort((a: any, b: any) => a.materialId.localeCompare(b.materialId));
  if (new Set(lines.map((d: any) => d.materialId)).size !== lines.length) throw new InventoryError(400, 'Không lặp NVL trong phiếu điều chỉnh.');
  const fingerprint = JSON.stringify({ id, reason, lines });
  return withTransaction(async session => {
    const corrections = await col('DIEU_CHINH_KHO');
    const key = `adjust:${id}:${requestId}`;
    const prior = await corrections.findOne({ _id: key as any }, { session });
    if (prior) {
      if (prior.FINGERPRINT !== fingerprint) throw new InventoryError(409, 'Mã yêu cầu đã dùng với nội dung khác.');
      return { correction: prior, alreadyPosted: true };
    }
    const imports = await col(COLLECTIONS.importSlip);
    const original = await imports.findOne({ PHIEU_NHAP_ID: id }, { session });
    if (!original || original.TRANG_THAI !== DOC_STATUS.posted || original.DA_DAO) throw new InventoryError(409, 'Chỉ điều chỉnh PN đã ghi nhận và chưa đảo.');
    // Serialize corrections and reversals of the same original, including positive adjustments.
    await imports.updateOne({ _id: original._id }, { $inc: { PHIEN_BAN_DIEU_CHINH: 1 } }, { session });
    const correctionId = `DC${new ObjectId().toHexString().toUpperCase()}`;
    const details = [];
    for (const line of lines) {
      const sources = await col(COLLECTIONS.importDetail);
      const source = await sources.findOne({ PHIEU_NHAP_ID: id, NGUYEN_VAT_LIEU_ID: line.materialId, LA_NGUON_NHAP: true }, { session });
      if (!source) throw new InventoryError(409, `NVL ${line.materialId} không có nguồn trên PN gốc.`);
      const materials = await col(COLLECTIONS.material);
      const material = await materials.findOne({ NGUYEN_VAT_LIEU_ID: line.materialId }, { session });
      if (!material) throw new InventoryError(409, 'Không tìm thấy danh mục NVL.');
      const cost = Number(source.DON_GIA_VON);
      if (!Number.isFinite(cost) || cost < 0) throw new InventoryError(409, 'Nguồn nhập thiếu giá vốn hợp lệ.');
      const before = Number(material.TON_THUC || 0), after = roundQty(before + line.quantity);
      const value = before * Number(material.GIA_VON_BQ || 0) + line.quantity * cost;
      if (after > 0 && value < -1) throw new InventoryError(409, 'Giá trị tồn không đủ để giảm theo giá vốn nguồn.');
      await applyMaterialDelta(session, { materialId: line.materialId, sourceId: id, dOnHand: line.quantity,
        type: 'DIEU_CHINH_NHAP', docType: 'DIEU_CHINH', docId: correctionId, unitCost: cost,
        note: `${reason} · PN gốc ${id}`, actor, sourceExtraInc: { SL_DIEU_CHINH: line.quantity } });
      await materials.updateOne({ _id: material._id }, { $set: { GIA_VON_BQ: after > 0 ? Math.max(0, Math.round(value / after)) : 0 } }, { session });
      details.push({ NGUYEN_VAT_LIEU_ID: line.materialId, CHENH_LECH: line.quantity, DON_GIA_VON: cost, PHIEU_NHAP_NGUON: id });
    }
    const correction = { _id: key, DIEU_CHINH_ID: correctionId, LOAI: 'Điều chỉnh tồn theo PN', PHIEU_GOC_ID: id,
      LY_DO: reason, CHI_TIET: details, NGUOI_XAC_NHAN: actor.id, NGAY_XAC_NHAN: new Date(), XAC_NHAN_THUC_TE: true,
      TRANG_THAI: DOC_STATUS.posted, FINGERPRINT: fingerprint };
    await corrections.insertOne(correction as any, { session });
    await imports.updateOne({ _id: original._id }, { $push: { DIEU_CHINH: { DIEU_CHINH_ID: correctionId, LY_DO: reason, CHI_TIET: details, NGUOI_XAC_NHAN: actor.id, NGAY_XAC_NHAN: correction.NGAY_XAC_NHAN } } as any }, { session });
    return { correction, alreadyPosted: false };
  });
};

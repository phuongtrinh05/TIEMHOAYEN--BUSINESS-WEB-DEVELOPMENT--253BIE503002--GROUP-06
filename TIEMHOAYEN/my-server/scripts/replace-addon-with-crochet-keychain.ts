import { getDb, getMongoClient } from '../mongo.js';
import { nextCode, withTransaction } from '../services/inventory/helpers.js';
import { BOM_STATUS, COLLECTIONS, MATERIAL_STATUS } from '../services/inventory/constants.js';

const productId = 'SPM145';
const image = 'assets/images/cart-moc-khoa-len-bouquet.png';
const price = 80000;
const description = 'Móc khóa bó hoa len thủ công gồm ba bông tulip đỏ burgundy, hồng và kem, lá xanh, giấy gói len viền lượn sóng, nơ và charm ngọc trai. Nhóm quà tặng nhỏ xinh để gửi kèm hoa. Nhóm: SẢN PHẨM MUA KÈM.';

async function main() {
  const db = await getDb();
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ productId, name: 'Móc khóa len', price, image, openingStock: 0 }));
    return;
  }
  const materialId = await nextCode(COLLECTIONS.material, 'NGUYEN_VAT_LIEU_ID', 'NVL', 3);
  const bomId = await nextCode(COLLECTIONS.bom, 'BOM_ID', 'BOM', 5);
  await withTransaction(async session => {
    const products = db.collection<any>(COLLECTIONS.product);
    const product = await products.findOne({ SAN_PHAM_ID: productId }, { session });
    if (!product || !['Thiệp', 'Socola', 'Móc khóa len'].includes(product.TEN_SAN_PHAM)) {
      throw new Error('SPM145 không còn là sản phẩm dự kiến thay thế.');
    }
    const alreadyApplied = product.TEN_SAN_PHAM === 'Móc khóa len';
    const now = new Date();
    if (!alreadyApplied) {
      const activeBoms = await db.collection<any>(COLLECTIONS.bom)
        .find({ SAN_PHAM_ID: productId, TRANG_THAI: BOM_STATUS.active }, { session }).toArray();
      const previousLines = await db.collection<any>(COLLECTIONS.bomLine).find({
        BOM_ID: { $in: activeBoms.map(b => b.BOM_ID) },
      }, { session }).toArray();
      await db.collection<any>(COLLECTIONS.material).updateMany({
        NGUYEN_VAT_LIEU_ID: { $in: previousLines.map(line => line.NGUYEN_VAT_LIEU_ID) },
        TEN_NGUYEN_VAT_LIEU: 'Hộp socola 9 viên', TON_THUC: 0, TON_DANG_GIU: 0,
      }, { $set: { TRANG_THAI: MATERIAL_STATUS.hidden } }, { session });
      await db.collection<any>(COLLECTIONS.material).insertOne({
        _id: materialId, NGUYEN_VAT_LIEU_ID: materialId, TEN_NGUYEN_VAT_LIEU: 'Móc khóa bó hoa tulip len',
        DON_VI_TINH: 'Chiếc', LOAI_NVL: 'Quà tặng kèm', NHOM_NVL: 'IT_HU',
        TRANG_THAI: MATERIAL_STATUS.active, GIA_BAN: price, GIA_NHAP: 0, GIA_VON_BQ: 0,
        SO_LUONG_TON: 0, TON_THUC: 0, TON_DANG_GIU: 0, TON_KHONG_DAT: 0,
        NGUONG_CANH_BAO: 5, NGUONG_TOI_DA: 20, URL_HINH_ANH: image,
        MO_TA: 'Quà tặng mua kèm. Nhập kho và giá vốn theo chứng từ thực tế.', NGAY_TAO: now,
      }, { session });
      await db.collection<any>(COLLECTIONS.bom).updateMany(
        { SAN_PHAM_ID: productId, TRANG_THAI: BOM_STATUS.active },
        { $set: { TRANG_THAI: BOM_STATUS.retired, HIEU_LUC_DEN: now } }, { session });
      await db.collection<any>(COLLECTIONS.bom).insertOne({
        _id: bomId, BOM_ID: bomId, SAN_PHAM_ID: productId,
        PHIEN_BAN: Math.max(0, ...activeBoms.map(b => Number(b.PHIEN_BAN || 0))) + 1,
        TRANG_THAI: BOM_STATUS.active, CHO_THAY_THE_NVL: false, CAN_RA_SOAT: false,
        HIEU_LUC_TU: now, HIEU_LUC_DEN: null, NGAY_TAO: now,
        GHI_CHU: 'Thay sản phẩm mua kèm bằng Móc khóa len. Tồn kho móc khóa len được quản lý riêng.',
      }, { session });
      await db.collection<any>(COLLECTIONS.bomLine).insertOne({
        _id: bomId + ':' + materialId, BOM_ID: bomId, NGUYEN_VAT_LIEU_ID: materialId,
        DINH_LUONG: 1, DON_VI_TINH: 'Chiếc', VAI_TRO: 'Chính', DS_THAY_THE: [],
        BAT_BUOC: true, CHO_PHEP_THAY_THE: false, QUY_TAC_THAY_THE: [], GHI_CHU: 'Một chiếc / sản phẩm',
      }, { session });
      await db.collection<any>(COLLECTIONS.legacyRecipe).deleteMany({ SAN_PHAM_ID: productId }, { session });
      await db.collection<any>(COLLECTIONS.legacyRecipe).insertOne({
        _id: productId + ':' + materialId, SAN_PHAM_ID: productId, NGUYEN_VAT_LIEU_ID: materialId,
        SO_LUONG_CAN: 1, DON_VI_TINH: 'Chiếc', GHI_CHU: 'Một móc khóa hoa tulip len',
      }, { session });
    }
    if (alreadyApplied) {
      const activeBom = await db.collection<any>(COLLECTIONS.bom).findOne({
        SAN_PHAM_ID: productId, TRANG_THAI: BOM_STATUS.active,
      }, { session });
      if (!activeBom) throw new Error('Sản phẩm móc khóa len thiếu BOM đang hiệu lực.');
      const lines = await db.collection<any>(COLLECTIONS.bomLine).find({
        BOM_ID: activeBom.BOM_ID,
      }, { session }).toArray();
      const materialIds = lines.map(line => line.NGUYEN_VAT_LIEU_ID);
      await db.collection<any>(COLLECTIONS.material).updateMany({
        NGUYEN_VAT_LIEU_ID: { $in: materialIds },
      }, { $set: { TEN_NGUYEN_VAT_LIEU: 'Móc khóa bó hoa tulip len', GIA_BAN: price,
        URL_HINH_ANH: image } }, { session });
    }
    await products.updateOne({ SAN_PHAM_ID: productId }, { $set: {
      TEN_SAN_PHAM: 'Móc khóa len', MO_TA: description, GIA: price, GIA_KHUYEN_MAI: null,
      KIEU_DANG: 'Sản phẩm mua kèm', TRANG_THAI: 'Đang bán',
      ...(!alreadyApplied ? { SO_LUONG: 0, TON_THANH_PHAM: 0, TP_DANG_GIU: 0 } : {}),
    } }, { session });
    await db.collection<any>('HINH_ANH_SAN_PHAM').updateMany(
      { SAN_PHAM_ID: productId }, { $set: { URL: image } }, { session });
  });
  console.log(JSON.stringify(await db.collection(COLLECTIONS.product).findOne({ SAN_PHAM_ID: productId })));
  console.log(JSON.stringify(await db.collection('HINH_ANH_SAN_PHAM').find({ SAN_PHAM_ID: productId }).toArray()));
}

main().then(async () => { await (await getMongoClient()).close(); })
  .catch(error => { console.error(error.message); process.exit(1); });

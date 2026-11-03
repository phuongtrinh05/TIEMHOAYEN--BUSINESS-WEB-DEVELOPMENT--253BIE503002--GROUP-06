import { getCollection } from '../mongo.js';

const themes = [
  ['SN', 'Sinh nhật'], ['TY', 'Tình yêu'], ['KN', 'Kỷ niệm'], ['CO', 'Cảm ơn'],
  ['CM', 'Chúc mừng'], ['KT', 'Khai trương'], ['XL', 'Xin lỗi'], ['SK', 'Chúc sức khỏe'],
  ['83', '8/3'], ['2010', '20/10'], ['NOEL', 'Noel'], ['TET', 'Tết'],
] as const;

const generatedRaster = new Set(['SN', 'TY', 'CO', 'CM', 'KT', 'TET']);
const paidFees: Record<string, number> = {
  KN: 15000,
  XL: 10000,
  SK: 15000,
  NOEL: 20000,
  TET: 20000,
};

async function main() {
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ dryRun: true, collection: 'CARD_TEMPLATE', count: themes.length, note: 'Chạy lại với --apply sau khi được duyệt.' }, null, 2));
    return;
  }
  const collection = await getCollection<any>('CARD_TEMPLATE');
  for (const [code, theme] of themes) {
    const id = `CARD_${code}`;
    const imageExtension = generatedRaster.has(code) ? 'png' : 'svg';
    await collection.updateOne(
      { CARD_TEMPLATE_ID: id },
      {
        $set: { MA_THIEP: code, TEN_THIEP: `Thiệp ${theme}`, CHU_DE: theme, LOAI: paidFees[code] ? 'Cao cấp' : 'Cơ bản', HINH_ANH: `/assets/cards/${code.toLowerCase()}.${imageExtension}`, PHU_PHI: paidFees[code] || 0, TRANG_THAI: 'active', THU_TU: themes.findIndex(x => x[0] === code) + 1 },
        $setOnInsert: { _id: id, CARD_TEMPLATE_ID: id, NGAY_TAO: new Date() },
      },
      { upsert: true },
    );
  }
  console.log(`Đã đồng bộ ${themes.length} mẫu thiệp theo mã, không tạo bản ghi trùng.`);
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

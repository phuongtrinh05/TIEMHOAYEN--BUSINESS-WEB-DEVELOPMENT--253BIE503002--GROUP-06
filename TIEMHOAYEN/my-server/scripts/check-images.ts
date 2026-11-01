import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

// Tự động nạp URI từ .env nếu chưa có trong environment
let uri = process.env['MONGO_URI'];
if (!uri) {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^MONGO_URI=(.*)$/m);
    if (match) {
      uri = match[1].trim();
    }
  }
}

if (!uri) {
  console.error('Không tìm thấy MONGO_URI trong môi trường hoặc file .env');
  process.exit(1);
}

const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const db = client.db('TIEM_HOA_YEN');
  const col = db.collection('HINH_ANH_SAN_PHAM');

  const total = await col.countDocuments();
  console.log('=== THỐNG KÊ HÌNH ẢNH SẢN PHẨM ===');
  console.log('Tổng số hình ảnh trong DB:', total);

  // Phân loại URL
  const allUrls = await col.find({}).project({ URL: 1 }).toArray();
  let base64 = 0, absolute = 0, relative = 0, empty = 0, other = 0;
  for (const doc of allUrls) {
    const url = String(doc.URL || '');
    if (!url) empty++;
    else if (url.startsWith('data:')) base64++;
    else if (/^https?:\/\//i.test(url)) absolute++;
    else if (url.startsWith('/')) relative++;
    else other++;
  }
  console.log(`Phân loại URL: Absolute(HTTP/S)=${absolute}, Base64=${base64}, Relative=${relative}, Rỗng=${empty}, Khác=${other}\n`);

  // Xem mẫu 3 ảnh bất kỳ
  console.log('=== MẪU 3 ẢNH BẤT KỲ TRONG DB ===');
  const samples = await col.find({}).limit(3).toArray();
  for (const s of samples) {
    const url = String(s.URL || '');
    const preview = url.length > 80 ? url.slice(0, 80) + '...' : url;
    console.log(`- ID: ${s.HINH_ANH_ID} | Sản phẩm: ${s.SAN_PHAM_ID} | Ảnh chính: ${Boolean(s.LA_ANH_CHINH)}`);
    console.log(`  Preview URL: ${preview}`);
  }

  // Xem chi tiết cách map ảnh của một sản phẩm mẫu (ví dụ SP0166 hoặc sản phẩm đầu tiên có ảnh)
  const targetProductId = samples[0]?.SAN_PHAM_ID || 'SP0166';
  console.log(`\n=== ẢNH CỦA SẢN PHẨM MẪU (${targetProductId}) KHI SERVER MAP ===`);
  const productImages = await col.find({ SAN_PHAM_ID: targetProductId }).toArray();
  const mapped = productImages.map((img: any, index: number) => ({
    url: img.URL,
    isPrimary: Boolean(img.LA_ANH_CHINH),
    sortOrder: Number(img.THU_TU ?? index)
  }));
  console.log(JSON.stringify(mapped, null, 2));

  await client.close();
}

main().catch(console.error);

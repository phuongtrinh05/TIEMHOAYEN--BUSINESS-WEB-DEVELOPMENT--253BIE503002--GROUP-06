# Chuyen Du Lieu BACPAC Sang MongoDB Rieng

Backend hien tai chay bang MongoDB. Du lieu khong nam trong source code; app chi doc connection string tu bien moi truong.

## Cau hinh database cho app

Tao file `.env` khi chay local, hoac khai bao cac bien nay tren hosting khi deploy:

```env
PORT=3000
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net
MONGO_DATABASE=TIEM_HOA_YEN
CORS_ORIGINS=https://your-frontend-domain.com
PUBLIC_BASE_URL=https://your-backend-domain.com
PASSWORD_HASH_ROUNDS=12
```

Khong commit `.env` len Git. File `.gitignore` da chan `.env`, `mongo-seed*/` va cac file `.bcp` tam.

## Import tu file BACPAC len MongoDB

Script `scripts/bacpac-to-mongodb.ts` doc truc tiep file `.bacpac` va ghi vao MongoDB. Khong can SQL Server trung gian.

Co the tao file `.env.atlas` tren may ca nhan de luu thong tin import cloud:

```env
BACPAC_PATH=C:\duong-dan\toi\TIEM_HOA_YEN.bacpac
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net
MONGO_DATABASE=TIEM_HOA_YEN
```

File `.env.atlas` bi ignore boi Git, nen khong bi dua len source.

Import len MongoDB Atlas Free M0:

```powershell
npm run bacpac:seed -- --env-file=.env.atlas
```

Kiem tra database sau khi import:

```powershell
npm run mongodb:check -- --env-file=.env.atlas
```

Hoac truyen truc tiep bang tham so:

```powershell
npm run bacpac:seed -- `
  --bacpac="C:\duong-dan\toi\TIEM_HOA_YEN.bacpac" `
  --mongo-uri="mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net" `
  --mongo-db=TIEM_HOA_YEN
```

Neu muon export ra file JSON tam truoc:

```powershell
npm run bacpac:export -- `
  --bacpac="C:\duong-dan\toi\TIEM_HOA_YEN.bacpac" `
  --out-dir=mongo-seed
```

Thu muc `mongo-seed` chi la du lieu tam de import/kiem tra, khong nen dua len Git hay deploy cung source code.

## Cau hinh hosting sau khi import

Tren noi deploy backend, them cac environment variables:

```env
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net
MONGO_DATABASE=TIEM_HOA_YEN
```

Sau do redeploy backend. Source code khong can chua du lieu MongoDB; server se tu ket noi vao database rieng qua `MONGO_URI`.

## Cach mapping sang MongoDB

- Bang SQL `SAN_PHAM` thanh collection MongoDB `SAN_PHAM`.
- Ten cot duoc giu nguyen, vi du `SAN_PHAM_ID`, `TEN_SAN_PHAM`, `GIA`.
- Bang co khoa chinh 1 cot: `_id` cua MongoDB la gia tri khoa chinh.
- Bang co khoa chinh nhieu cot: `_id` la object gom cac cot khoa chinh.
- Cac cot khoa ngoai van duoc giu lai dang reference field de backend co the join bang query MongoDB.

Sau khi import, co the xem database `TIEM_HOA_YEN` bang MongoDB Atlas UI, MongoDB Compass, hoac `mongosh`.

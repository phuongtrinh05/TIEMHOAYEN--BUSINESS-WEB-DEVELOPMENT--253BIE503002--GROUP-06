// Share the legacy blog covers with Admin without duplicating source images.
const fs = require('node:fs');
const path = require('node:path');
const source = path.resolve(__dirname, '../../my-client/src/assets/images/blog');
const target = path.resolve(__dirname, '../public/assets/images/blog');
if (fs.existsSync(source)) {
  fs.mkdirSync(target, {recursive: true});
  for (const name of fs.readdirSync(source)) {
    if (/\.(jpe?g|png|webp)$/i.test(name)) fs.copyFileSync(path.join(source, name), path.join(target, name));
  }
}

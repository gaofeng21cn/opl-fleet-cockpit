import fs from 'node:fs';
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error('Invalid product version');
const file = 'android-kiosk/product-build.json';
const build = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Number.isSafeInteger(build.versionCode) || build.versionCode < 23) throw Error('Invalid Android build counter');
if (build.version !== version) {
  build.version = version;
  build.versionCode += 1;
  fs.writeFileSync(file, JSON.stringify(build, null, 2) + '\n');
}

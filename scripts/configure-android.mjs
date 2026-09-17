import { readFile, writeFile } from 'node:fs/promises';

const buildGradlePath = 'android/app/build.gradle';
let text = await readFile(buildGradlePath, 'utf8');

const versionName = process.env.APP_VERSION_NAME || '0.0.0-dev';
const versionCode = Number(process.env.APP_VERSION_CODE || '1');

if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) {
  throw new Error(`APP_VERSION_CODE must be an integer from 1 to 2100000000, got: ${process.env.APP_VERSION_CODE}`);
}

if (!/^[-0-9A-Za-z.]+$/.test(versionName)) {
  throw new Error(`APP_VERSION_NAME contains unsupported characters: ${versionName}`);
}

text = text.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
text = text.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);

const signingMarker = '// CI_RELEASE_SIGNING';
if (!text.includes(signingMarker)) {
  text = text.replace(
    'android {',
    `def releaseKeystorePath = System.getenv("ANDROID_KEYSTORE_PATH")\n\nandroid {\n    ${signingMarker}\n    signingConfigs {\n        release {\n            if (releaseKeystorePath) {\n                storeFile file(releaseKeystorePath)\n                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")\n                keyAlias System.getenv("ANDROID_KEY_ALIAS")\n                keyPassword System.getenv("ANDROID_KEY_PASSWORD")\n            }\n        }\n    }`,
  );

  text = text.replace(
    /buildTypes\s*\{\s*release\s*\{/,
    `buildTypes {\n        release {\n            if (releaseKeystorePath) {\n                signingConfig signingConfigs.release\n            }`,
  );
}

await writeFile(buildGradlePath, text, 'utf8');
console.log(`Configured Android versionName=${versionName}, versionCode=${versionCode}`);
console.log(`Release signing: ${process.env.ANDROID_KEYSTORE_PATH ? 'enabled' : 'not configured'}`);

#!/usr/bin/env node
/**
 * bump-version.mjs — release sürüm artırıcı (tek kaynak: version.properties)
 *
 * Kullanım:
 *   npm run release:bump            → VERSION_CODE +1 (versionName aynı kalır)
 *   npm run release:bump 1.1.0     → VERSION_CODE +1 + VERSION_NAME=1.1.0
 *
 * Yaptıkları:
 *   1. version.properties: VERSION_CODE'u +1 artırır, istenirse VERSION_NAME'i günceller.
 *   2. package.json "version" alanını VERSION_NAME ile senkronlar.
 *   3. CHANGELOG.md'de [Unreleased] bölümü boşsa uyarır (release notu disiplini).
 *
 * android/app/build.gradle bu dosyayı build sırasında okur — gradle dosyasına dokunmaz.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const propsPath = join(root, 'version.properties');
const pkgPath = join(root, 'package.json');
const changelogPath = join(root, 'CHANGELOG.md');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const raw = readFileSync(propsPath, 'utf8');
const codeMatch = raw.match(/^VERSION_CODE=(\d+)$/m);
const nameMatch = raw.match(/^VERSION_NAME=(.+)$/m);
if (!codeMatch || !nameMatch) {
  console.error('HATA: version.properties içinde VERSION_CODE/VERSION_NAME bulunamadı.');
  process.exit(1);
}

const newCode = parseInt(codeMatch[1], 10) + 1;
const argName = process.argv[2];
if (argName && !SEMVER_RE.test(argName)) {
  console.error(`HATA: versionName semver olmalı (x.y.z), verilen: "${argName}"`);
  process.exit(1);
}
const newName = argName ?? nameMatch[1].trim();

let out = raw.replace(/^VERSION_CODE=\d+$/m, `VERSION_CODE=${newCode}`);
out = out.replace(/^VERSION_NAME=.+$/m, `VERSION_NAME=${newName}`);
writeFileSync(propsPath, out, 'utf8');

// package.json "version" senkronu
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = newName;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// CHANGELOG disiplin uyarısı (bloklamaz, hatırlatır)
if (existsSync(changelogPath)) {
  const cl = readFileSync(changelogPath, 'utf8');
  const unreleased = cl.split(/^## /m).find((s) => s.startsWith('[Unreleased]')) ?? '';
  const hasEntry = /^- /m.test(unreleased);
  if (!hasEntry) {
    console.warn('UYARI: CHANGELOG.md [Unreleased] bölümü boş — release notunu yazmayı unutma.');
  }
}

console.log(`OK: versionCode ${codeMatch[1]} → ${newCode}, versionName ${nameMatch[1].trim()} → ${newName}`);
console.log('Sonraki adımlar: CHANGELOG.md [Unreleased] → sürüm başlığına taşı, commit + git tag v' + newName);

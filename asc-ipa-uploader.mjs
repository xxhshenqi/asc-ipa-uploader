#!/usr/bin/env node
// asc-ipa-uploader — 通过 App Store Connect 官方 Build Uploads API 上传 IPA
// 零依赖，Node.js >= 18
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

// ---------- 命令行参数 ----------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = process.argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
}

const cfg = {
  keyPath: args.key || process.env.ASC_KEY_PATH,
  keyId: args.keyId || args['key-id'] || process.env.ASC_KEY_ID,
  issuer: args.issuer || process.env.ASC_ISSUER,
  appId: args.app || process.env.ASC_APP_ID,
  ipaPath: args.ipa,
  version: args.version,
  build: args.build,
  release: !!args.release,
  listApps: !!args['list-apps'],
};

if (args.help || args.h) {
  console.log(`用法:
  node asc-ipa-uploader.mjs --key <p8路径> --key-id <密钥ID> --issuer <ISSUER_ID> [选项]

必选(上传):
  --ipa <path>       IPA 文件路径
  --app <id>         App 的数字 ID
  --version <x.y.z>  App 版本号 (CFBundleShortVersionString)
  --build <n>        build 号 (CFBundleVersion)

其他:
  --list-apps        列出团队所有 App 及 ID 后退出
  --release          上传后自动创建版本记录并关联 build
  --help             显示本帮助

环境变量: ASC_KEY_PATH / ASC_KEY_ID / ASC_ISSUER / ASC_APP_ID`);
  process.exit(0);
}

const missing = [];
if (!cfg.keyPath) missing.push('--key (.p8 私钥路径)');
if (!cfg.keyId) missing.push('--key-id');
if (!cfg.issuer) missing.push('--issuer');
if (missing.length) {
  console.error('缺少参数: ' + missing.join(', ') + '\n用 --help 查看用法');
  process.exit(2);
}

// ---------- JWT (ES256) ----------
const b64u = (b) => Buffer.from(b).toString('base64url');

async function makeJwt() {
  const pem = await fs.readFile(cfg.keyPath, 'utf8');
  const header = b64u(JSON.stringify({ alg: 'ES256', kid: cfg.keyId, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ iss: cfg.issuer, iat: now - 30, exp: now + 20 * 60, aud: 'appstoreconnect-v1' }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const der = signer.sign(pem);
  // DER -> R||S 原始 64 字节 (ES256 要求)
  const rLen = der[3], sLen = der[5 + rLen];
  const r = der.subarray(4, 4 + rLen), s = der.subarray(6 + rLen, 6 + rLen + sLen);
  const fix = (b) => b.length === 32 ? b : b.length > 32 ? b.subarray(b.length - 32) : Buffer.concat([Buffer.alloc(32 - b.length), b]);
  return `${header}.${payload}.${b64u(Buffer.concat([fix(r), fix(s)]))}`;
}

// ---------- API 调用(内置瞬时401重试) ----------
const API = 'https://api.appstoreconnect.apple.com';

async function api(method, path, body) {
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: { Authorization: `Bearer ${await makeJwt()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      // 新建的密钥在 Apple 后端同步完全前会偶发 401, 重试即可
      if (res.status === 401 && attempt < 6) {
        await new Promise((r) => setTimeout(r, 4000));
        lastErr = new Error(`HTTP 401: ${text.slice(0, 300)}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
      if (!text.trim()) return null; // 204
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt === 6 || !/fetch failed|network|ECONN/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  throw lastErr;
}

function die(msg) { console.error('失败: ' + msg); process.exit(1); }

// ---------- 主流程 ----------
async function main() {
  // 列出 App 模式
  if (cfg.listApps) {
    const j = await api('GET', '/v1/apps?limit=50&fields[apps]=name,bundleId');
    console.log('团队 App 列表:');
    for (const a of j.data || []) {
      console.log(`  ${a.id}  ${a.attributes.name}  (${a.attributes.bundleId})`);
    }
    return;
  }

  // 上传模式参数检查
  for (const [k, v] of [['--app', cfg.appId], ['--ipa', cfg.ipaPath], ['--version', cfg.version], ['--build', cfg.build]]) {
    if (!v) die(`缺少参数 ${k}（或用 --list-apps / --help）`);
  }

  const stat = await fs.stat(cfg.ipaPath).catch(() => die(`IPA 文件不存在: ${cfg.ipaPath}`));
  console.log(`[1/6] ${cfg.ipaPath} (${stat.size} 字节), 版本 ${cfg.version} build ${cfg.build}`);

  // 上传前检查同版本 build 是否已存在
  const existed = await api('GET', `/v1/builds?filter[app]=${cfg.appId}&filter[version]=${cfg.build}&limit=1`);
  if (existed.data?.length) {
    const b = existed.data[0].attributes;
    die(`build ${cfg.build} 已存在(状态 ${b.processingState}, 上传于 ${b.uploadedDate})。Apple 不允许重复 build 号, 请升 build 号后重试。`);
  }

  // 登记构建上传
  const bu = await api('POST', '/v1/buildUploads', {
    data: {
      type: 'buildUploads',
      attributes: { cfBundleShortVersionString: cfg.version, cfBundleVersion: cfg.build, platform: 'IOS' },
      relationships: { app: { data: { id: String(cfg.appId), type: 'apps' } } },
    },
  });
  const buId = bu.data.id;
  console.log(`[2/6] buildUpload 已创建 (${buId})`);

  // 登记文件(整个 ipa 作为一个 ASSET)
  const fileName = cfg.ipaPath.replace(/[\\/]/g, '/').split('/').pop();
  const fileRec = await api('POST', '/v1/buildUploadFiles', {
    data: {
      type: 'buildUploadFiles',
      attributes: { assetType: 'ASSET', fileName, fileSize: stat.size, uti: 'com.apple.ipa' },
      relationships: { buildUpload: { data: { id: buId, type: 'buildUploads' } } },
    },
  });
  const fileId = fileRec.data.id;
  const ops = fileRec.data.attributes.uploadOperations || [];
  console.log(`[3/6] 获取到 ${ops.length} 个分块上传指令`);

  // 分块上传
  const fh = await fs.open(cfg.ipaPath, 'r');
  let sent = 0;
  const t0 = Date.now();
  for (const [i, op] of ops.entries()) {
    const buf = Buffer.alloc(op.length);
    await fh.read(buf, 0, op.length, op.offset);
    const headers = {};
    for (const h of op.requestHeaders || []) headers[h.name] = h.value;
    let ok = false;
    for (let a = 1; a <= 3 && !ok; a++) {
      const res = await fetch(op.url, { method: op.method || 'PUT', headers, body: buf }).catch((e) => ({ status: 0, text: async () => e.message }));
      if (res.status < 300) ok = true;
      else if (a === 3) { await fh.close(); die(`分块 ${op.partNumber ?? i + 1} 上传失败 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); }
      else await new Promise((r) => setTimeout(r, 3000));
    }
    sent += op.length;
    const speed = (sent / 1024 / 1024 / ((Date.now() - t0) / 1000)).toFixed(2);
    process.stdout.write(`\r[4/6] 进度 ${((sent / stat.size) * 100).toFixed(1)}%  (${sent}/${stat.size} 字节, ${speed} MB/s)  `);
  }
  process.stdout.write('\n');
  await fh.close();

  // 标记完成
  await api('PATCH', `/v1/buildUploadFiles/${fileId}`, {
    data: { type: 'buildUploadFiles', id: fileId, attributes: { uploaded: true } },
  });
  console.log('[5/6] 已标记上传完成, 等待 Apple 处理...');

  // 轮询 build 出现
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const b = await api('GET', `/v1/builds?filter[app]=${cfg.appId}&filter[version]=${cfg.build}&limit=1`);
    if (b.data?.length) {
      const st = b.data[0].attributes.processingState;
      console.log(`[6/6] build ${cfg.build} 已出现, 状态: ${st}`);
      if (st === 'VALID') {
        if (cfg.release) await attachToVersion(b.data[0].id);
        console.log('完成 ✅  可在 App Store Connect 后台提审 / TestFlight 使用。');
        return;
      }
      if (st === 'INVALID' || st === 'FAILED') {
        console.error('Apple 处理失败, 请检查 IPA 签名/证书后重试(需新 build 号)。');
        process.exit(1);
      }
      // PROCESSING 则继续等
    } else {
      console.log(`      处理中... (${i + 1}/20)`);
    }
  }
  console.log('等待超时(仍在处理中), 可稍后在后台查看, 或用 --list-apps 同款密钥调用 /v1/builds 查询。');
}

// 可选: 创建版本记录并关联 build
async function attachToVersion(buildId) {
  try {
    let ver;
    try {
      ver = await api('POST', '/v1/appStoreVersions', {
        data: {
          type: 'appStoreVersions',
          attributes: { platform: 'IOS', versionString: cfg.version },
          relationships: { app: { data: { id: String(cfg.appId), type: 'apps' } } },
        },
      });
    } catch {
      const list = await api('GET', `/v1/apps/${cfg.appId}/appStoreVersions?filter[versionString]=${cfg.version}`);
      if (!list.data?.length) throw new Error('版本记录创建失败且不存在');
      ver = list;
    }
    const verId = ver.data.id || ver.data[0].id;
    await api('PATCH', `/v1/appStoreVersions/${verId}/relationships/build`, {
      data: { id: buildId, type: 'builds' },
    });
    console.log(`      已创建/关联版本 ${cfg.version} → build ${cfg.build} (PREPARE_FOR_SUBMISSION, 去后台填更新说明后提审)`);
  } catch (e) {
    console.log(`      版本关联跳过: ${e.message.slice(0, 150)}`);
  }
}

main().catch((e) => die(e.message));

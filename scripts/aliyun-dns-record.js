#!/usr/bin/env node
/**
 * 阿里云 DNS 解析管理（签名走官方 AccessKey 规范）
 *
 * 通用：list / add A / add TXT / delete / delete-by-name
 *
 * 用法：
 *   ALI_AK=<id> ALI_SK=<secret> node scripts/aliyun-dns.js list
 *   ALI_AK=<id> ALI_SK=<secret> node scripts/aliyun-dns.js add A    wb 8.130.181.74
 *   ALI_AK=<id> ALI_SK=<secret> node scripts/aliyun-dns.js add TXT  _acme-challenge "<token>"
 *   ALI_AK=<id> ALI_SK=<secret> node scripts/aliyun-dns.js delete <RecordId>
 *   ALI_AK=<id> ALI_SK=<secret> node scripts/aliyun-dns.js delete-by-name A _acme-challenge
 *
 * 用途：在 certbot --manual 的 auth-hook/cleanup-hook 里调用，自动化 ACME DNS-01 校验。
 */

const https = require('https');
const crypto = require('crypto');

const AK = (() => {
  if (process.env.ALI_AK) return process.env.ALI_AK;
  try { return require('fs').readFileSync(__dirname + '/.aliyun-ak', 'utf8').split('\n')[0].trim(); } catch {}
  return '';
})();
const SK = (() => {
  if (process.env.ALI_SK) return process.env.ALI_SK;
  try { return require('fs').readFileSync(__dirname + '/.aliyun-ak', 'utf8').split('\n')[1].trim(); } catch {}
  return '';
})();
const ENDPOINT = 'alidns.aliyuncs.com';
const DOMAIN = process.env.DOMAIN || 'lwai.work';

if (!AK || !SK) {
  console.error('缺少 ALI_AK / ALI_SK');
  process.exit(1);
}

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function callApi(params) {
  const common = {
    Format: 'JSON',
    Version: '2015-01-09',
    AccessKeyId: AK,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomBytes(16).toString('hex'),
  };
  const all = { ...common, ...params };
  const sorted = Object.keys(all).sort();
  const canonical = sorted.map((k) => `${percentEncode(k)}=${percentEncode(all[k])}`).join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;
  const signature = crypto.createHmac('sha1', `${SK}&`).update(stringToSign).digest('base64');
  const query = `${canonical}&Signature=${percentEncode(signature)}`;

  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: ENDPOINT, path: `/?${query}`, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        if (res.statusCode === 200 && json && !json.Code) resolve(json);
        else reject(new Error(`API 错误: ${json ? json.Code + ' - ' + json.Message : data.slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function listRecords() {
  const r = await callApi({ Action: 'DescribeDomainRecords', DomainName: DOMAIN });
  const list = (r.DomainRecords && r.DomainRecords.Record) || [];
  console.log(`域名 ${DOMAIN} 现有解析记录 ${list.length} 条：`);
  list.forEach((x) => console.log(`  ${x.RR.padEnd(22)} ${x.Type.padEnd(6)} -> ${x.Value}  (RecordId: ${x.RecordId})`));
  return list;
}

async function addRecord(type, rr, value) {
  const existing = await listRecords();
  const dup = existing.find((x) => x.RR === rr && x.Type === type);
  if (dup && type === 'A') {
    console.log(`跳过 ${rr}（已有 A 记录 -> ${dup.Value}，不重复添加）`);
    return dup.RecordId;
  }
  const r = await callApi({
    Action: 'AddDomainRecord',
    DomainName: DOMAIN,
    RR: rr,
    Type: type,
    Value: value,
    TTL: '600',
  });
  console.log(`新增成功 ${rr} ${type} -> ${value}  (RecordId: ${r.RecordId})`);
  return r.RecordId;
}

async function deleteRecord(recordId) {
  await callApi({ Action: 'DeleteDomainRecord', RecordId: recordId });
  console.log(`已删除 RecordId ${recordId}`);
}

async function deleteByName(type, rr) {
  const existing = await listRecords();
  const targets = existing.filter((x) => x.RR === rr && x.Type === type);
  for (const t of targets) await deleteRecord(t.RecordId);
}

// ---------------------------------------------------------------------------
// certbot hooks 入口
//
// certbot 调用方式：
//   --manual-auth-hook    "/usr/bin/node scripts/aliyun-dns.js auth-hook"
//   --manual-cleanup-hook "/usr/bin/node scripts/aliyun-dns.js cleanup-hook"
//
// certbot 会传入：
//   CERTBOT_DOMAIN   e.g. wb.lwai.work
//   CERTBOT_VALIDATION e.g. <token>
//   CERTBOT_TOKEN    同上
// ---------------------------------------------------------------------------
async function authHook() {
  const domain = process.env.CERTBOT_DOMAIN;
  const validation = process.env.CERTBOT_VALIDATION;
  if (!domain || !validation) {
    console.error('缺少 CERTBOT_DOMAIN / CERTBOT_VALIDATION 环境变量');
    process.exit(1);
  }
  // 子域名（含 _acme-challenge.）作为 RR
  const rr = `_acme-challenge.${domain.replace(`.${DOMAIN}`, '')}`;
  const id = await addRecord('TXT', rr, validation);
  // 给 DNS 传播留时间（公网 DNS 通常 30-60s）
  console.log(`等待 60s 让 DNS 传播...`);
  await new Promise((r) => setTimeout(r, 60000));
  console.log(`HOOK_OK ${id}`);
}

async function cleanupHook() {
  const domain = process.env.CERTBOT_DOMAIN;
  if (!domain) return;
  const rr = `_acme-challenge.${domain.replace(`.${DOMAIN}`, '')}`;
  await deleteByName('TXT', rr);
  console.log('清理完成');
}

// ---------------------------------------------------------------------------
(async () => {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'list';
  try {
    if (cmd === 'list') await listRecords();
    else if (cmd === 'add') {
      const [type, rr, value] = args.slice(1);
      if (!type || !rr || !value) throw new Error('用法: add <TYPE> <RR> <VALUE>');
      await addRecord(type, rr, value);
    } else if (cmd === 'delete') {
      const [id] = args.slice(1);
      if (!id) throw new Error('用法: delete <RecordId>');
      await deleteRecord(id);
    } else if (cmd === 'delete-by-name') {
      const [type, rr] = args.slice(1);
      if (!type || !rr) throw new Error('用法: delete-by-name <TYPE> <RR>');
      await deleteByName(type, rr);
    } else if (cmd === 'auth-hook') await authHook();
    else if (cmd === 'cleanup-hook') await cleanupHook();
    else throw new Error('未知命令: ' + cmd);
  } catch (e) {
    console.error('执行失败:', e.message);
    process.exit(1);
  }
})();

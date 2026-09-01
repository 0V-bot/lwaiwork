#!/usr/bin/env node
/**
 * 阿里云 DNS 解析管理（签名走官方 AccessKey 规范）
 *
 * 用途：为 lwaiwork 添加 wb.lwai.work / api.wb.lwai.work 两条 A 记录。
 * 只做新增，不修改或删除任何已有记录（尤其不动 fufu.lwai.work）。
 *
 * 用法：
 *   ALI_AK=<id> ALI_SK=<secret> node scripts/aliyun-dns.js list
 *   ALI_AK=<id> ALI_SK=<secret> node scripts/aliyun-dns.js add
 */

const https = require('https');
const crypto = require('crypto');

const AK = process.env.ALI_AK;
const SK = process.env.ALI_SK;
const ENDPOINT = 'alidns.aliyuncs.com';
const DOMAIN = 'lwaiwork.cn'.replace('lwaiwork.cn', 'lwai.work'); // 目标域名
const TARGET_DOMAIN = 'lwai.work';
const ECS_IP = '8.130.181.74';

if (!AK || !SK) {
  console.error('缺少 ALI_AK / ALI_SK 环境变量');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// URL 编码（阿里云要求：/ 编码为 %2F，空格编码为 %20，需用 RFC3986 风格）
// ---------------------------------------------------------------------------
function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

// ---------------------------------------------------------------------------
// 构造签名并发起请求
// ---------------------------------------------------------------------------
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

  // 1) 按参数名排序
  const sorted = Object.keys(all).sort();
  // 2) 拼规范化查询串
  const canonical = sorted.map((k) => `${percentEncode(k)}=${percentEncode(all[k])}`).join('&');
  // 3) StringToSign
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;
  // 4) HMAC-SHA1 签名
  const signature = crypto
    .createHmac('sha1', `${SK}&`)
    .update(stringToSign)
    .digest('base64');

  const query = `${canonical}&Signature=${percentEncode(signature)}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: ENDPOINT, path: `/?${query}`, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch {}
          if (res.statusCode === 200 && json && !json.Code) resolve(json);
          else reject(new Error(`API 错误: ${json ? json.Code + ' - ' + json.Message : data.slice(0, 300)}`));
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 列出已有解析记录
// ---------------------------------------------------------------------------
async function listRecords() {
  const r = await callApi({
    Action: 'DescribeDomainRecords',
    DomainName: TARGET_DOMAIN,
  });
  const list = (r.DomainRecords && r.DomainRecords.Record) || [];
  console.log(`域名 ${TARGET_DOMAIN} 现有解析记录 ${list.length} 条：`);
  list.forEach((x) => {
    console.log(`  ${x.RR.padEnd(15)} ${x.Type.padEnd(6)} -> ${x.Value}`);
  });
  return list;
}

// ---------------------------------------------------------------------------
// 添加 A 记录（若已存在则跳过，绝不覆盖）
// ---------------------------------------------------------------------------
async function addRecords() {
  const existing = await listRecords();
  console.log('');

  const targets = [
    { RR: 'wb', desc: '工作台前端' },
    { RR: 'api', desc: '工作台后端 API' },
  ];

  for (const t of targets) {
    const found = existing.find((x) => x.RR === t.RR && x.Type === 'A');
    if (found) {
      console.log(`跳过 ${t.RR}.${TARGET_DOMAIN}（已存在 -> ${found.Value}）`);
      continue;
    }
    try {
      const r = await callApi({
        Action: 'AddDomainRecord',
        DomainName: TARGET_DOMAIN,
        RR: t.RR,
        Type: 'A',
        Value: ECS_IP,
        TTL: '600',
      });
      console.log(`新增成功 ${t.RR}.${TARGET_DOMAIN} -> ${ECS_IP}  (RecordId: ${r.RecordId})`);
    } catch (e) {
      console.error(`新增失败 ${t.RR}.${TARGET_DOMAIN}: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
(async () => {
  const cmd = process.argv[2] || 'list';
  if (cmd === 'add') await addRecords();
  else await listRecords();
})().catch((e) => {
  console.error('执行失败:', e.message);
  process.exit(1);
});

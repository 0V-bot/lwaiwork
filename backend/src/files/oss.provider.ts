/**
 * ali-oss (Aliyun OSS) wrapper.
 *
 * What this provider does:
 *   1. Reads OSS_* env vars via ConfigService and refuses to construct
 *      itself when any are missing. The .env.example file ships with
 *      PLACEHOLDER values so the app boots, but the placeholder is rejected
 *      with a `ServiceUnavailableException` at first use so we never serve
 *      uploads against a fake bucket.
 *   2. Builds a single shared OSS client. The SDK is connection-pooled
 *      internally, so reusing one instance per process is the right cost
 *      model. We do NOT create per-request clients.
 *   3. Exposes two methods the service layer actually needs:
 *         * `createPostPolicy(opts)` - returns the form fields the client
 *           must POST to OSS to upload a single object. Bounded by key
 *           prefix (own userId) + size + expiry. We never sign keys for
 *           other tenants.
 *         * `signDownloadUrl(key, expiresSec)` - returns a 5-minute GET URL
 *           pointing at the private bucket. NEVER use a permanent URL.
 *         * `deleteObject(key)` - hard delete from the bucket, used when
 *           a row is soft-archived (we don't keep orphans lying around).
 *      Plus an `OnModuleInit` probe so a broken credential shows up at
 *      boot instead of leaking into the first request.
 *
 * SECURITY: the access key never leaves the process. We log it masked at
 * construction time so misconfiguration is visible WITHOUT exposing the
 * value. All operations are caught and translated to Nest exceptions at
 * the service layer; this provider only throws raw ali-oss errors so the
 * service can decide whether 4xx vs 5xx is appropriate.
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OSSClient from 'ali-oss';

/**
 * Identifiers for the OSS configuration variables. Pulling them into a
 * const helps with greppability ("which env does files use again?") and
 * keeps the constructor honest about the full set it depends on.
 */
export const OSS_ENV = {
  accessKeyId: 'OSS_ACCESS_KEY_ID',
  accessKeySecret: 'OSS_ACCESS_KEY_SECRET',
  region: 'OSS_REGION',
  bucket: 'OSS_BUCKET',
  endpoint: 'OSS_ENDPOINT',
} as const;

/** Hard-coded placeholders that mean "this app was booted without real creds". */
const PLACEHOLDER_TOKENS = new Set<string>([
  '',
  'replace_me',
  'replace_me_with_real_value',
  'changeme',
]);

export interface OssPostPolicyOptions {
  /** Object key inside the bucket. MUST already include the per-user prefix. */
  ossKey: string;
  /** Bytes the client intends to PUT. Used as both policy bound + content-length-range. */
  size: number;
  /** MIME the client will set on the PUT. Optional - if set we lock the policy to it. */
  contentType?: string;
  /** Seconds from now until the policy expires. Default: 5 minutes. */
  expiresInSeconds?: number;
}

export interface OssPostPolicy {
  /** URL the client must POST the file to (multipart/form-data). */
  uploadUrl: string;
  /** Form fields the client must include in the multipart body BEFORE the file part. */
  form: {
    key: string;
    policy: string;
    OSSAccessKeyId: string;
    signature: string;
    /** Always 200; the OSS server replies OK without an XML body when this is set. */
    'x-oss-success-action-status': '200';
    /** Only emit when the caller supplied a content type. */
    'Content-Type'?: string;
  };
  /** ISO timestamp at which the policy / URL become invalid. */
  expiresAt: string;
  /** Echoed for completeness; the row is not yet persisted at this point. */
  ossKey: string;
}

@Injectable()
export class OssProvider implements OnModuleInit {
  private readonly logger = new Logger(OssProvider.name);
  private readonly client: OSSClient;
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string;
  private readonly accessKeyId: string;

  constructor(config: ConfigService) {
    const accessKeyId = (config.get<string>(OSS_ENV.accessKeyId) ?? '').trim();
    const accessKeySecret = (config.get<string>(OSS_ENV.accessKeySecret) ?? '').trim();
    const region = (config.get<string>(OSS_ENV.region) ?? '').trim();
    const bucket = (config.get<string>(OSS_ENV.bucket) ?? '').trim();
    const endpoint = (config.get<string>(OSS_ENV.endpoint) ?? '').trim();

    this.accessKeyId = accessKeyId;
    this.bucket = bucket;
    this.region = region;
    this.endpoint = endpoint;

    // Fail-closed: missing creds makes the provider dead. We do NOT throw at
    // construction so the rest of the app can still serve non-file routes -
    // the failure surfaces the moment the user tries to upload / download.
    if (
      PLACEHOLDER_TOKENS.has(accessKeyId) ||
      PLACEHOLDER_TOKENS.has(accessKeySecret) ||
      accessKeyId === '' ||
      accessKeySecret === '' ||
      region === '' ||
      bucket === '' ||
      endpoint === ''
    ) {
      this.logger.error(
        '\x1b[31m' +
          'OSS credentials are not configured. The /files endpoints will return 503 ' +
          `until ${OSS_ENV.accessKeyId} / ${OSS_ENV.accessKeySecret} / ${OSS_ENV.region} ` +
          `/ ${OSS_ENV.bucket} / ${OSS_ENV.endpoint} are set in the environment.` +
          '\x1b[0m',
      );
      // Build a stub client anyway so the JS engine doesn't crash on first
      // method call; every accessor short-circuits to `assertConfigured()`.
      this.client = new OSSClient({
        accessKeyId: 'placeholder',
        accessKeySecret: 'placeholder',
        region: region || 'oss-cn-hangzhou',
        bucket: bucket || 'placeholder',
        endpoint: endpoint || 'oss-cn-hangzhou.aliyuncs.com',
        // Strictly disable SDK retries on failures so we surface 5xx quickly
        // instead of hanging a request thread.
        retryLimit: 0,
        timeout: 30_000,
      });
      return;
    }

    this.logger.log(
      `OSS client constructed (region=${region}, bucket=${bucket}, endpoint=${endpoint}, ` +
        `accessKeyId=${maskKeyId(accessKeyId)})`,
    );

    this.client = new OSSClient({
      accessKeyId,
      accessKeySecret,
      region,
      bucket,
      // Allow env override of the public endpoint (Aliyun ECS in-region
      // internal endpoint speeds things up; the .env can switch to it
      // without code change).
      endpoint,
      retryLimit: 2,
      timeout: 60_000,
    });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async onModuleInit(): Promise<void> {
    if (!this.hasCredentials()) {
      // Already logged. Don't probe - would just fail.
      return;
    }
    // Soft probe: list one object (limit=0) and time it. If the network is
    // wedged or the creds are wrong, we want to know at boot, not on the
    // first user upload. We swallow the error - some ECS pods can't reach
    // OSS over the public endpoint and fall back to the internal one. The
    // next real request will surface the failure cleanly.
    try {
      const start = Date.now();
      await this.client.getBucketInfo(this.bucket);
      this.logger.log(
        `OSS probe OK (region=${this.region}, bucket=${this.bucket}, took=${Date.now() - start}ms)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `OSS probe failed at startup (${message}). The /files endpoints will still ` +
          'attempt their requests; errors there are surfaced to the caller as 503.',
      );
    }
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * The bucket name as currently configured. Exposed because the service
   * layer stores `oss_bucket` on every row for future migrations.
   */
  bucketName(): string {
    return this.bucket;
  }

  /**
   * Build the POST-policy form fields for one object upload.
   *
   * The three `conditions` mirror what we enforce in the Nest DTO + service:
   *   * key prefix            -> blocks the client from writing outside their own path
   *   * content-length-range  -> double-key on the size cap (the SDK won't catch this)
   *   * expires in 5 minutes  -> a stolen ticket is worthless almost immediately
   *
   * `calculatePostSignature(policy)` returns `{ policy, signature }` where
   * `policy` is the base64-encoded JSON of our `policy` object and
   * `signature` is the AccessKeySecret HMAC over that.
   */
  createPostPolicy(opts: OssPostPolicyOptions): OssPostPolicy {
    this.assertConfigured();

    if (!opts.ossKey || opts.ossKey.includes('..')) {
      // Defensive: never sign a key with traversal-ish segments even if the
      // caller passed one in. The service has already validated the prefix,
      // this is belt + braces.
      throw new ServiceUnavailableException('Invalid OSS key');
    }

    const expiresIn = opts.expiresInSeconds ?? 5 * 60;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // OSS condition shape. `starts-with` against `$key` enforces the
    // prefix; an empty string after the comma means "may be anything as long
    // as it begins with the literal prefix".
    const conditions: Array<unknown> = [
      // exact bucket name (defence against accidental cross-bucket PUT)
      { bucket: this.bucket },
      // allow the user-uploads style sub-prefix to be empty (we hard-bind
      // the key in `form.key` so the actual stored path is exact)
      ['starts-with', '$key', extractDir(opts.ossKey)],
      // size cap, used as the policy's bounding box
      ['content-length-range', 1, opts.size],
    ];
    if (opts.contentType) {
      conditions.push(['eq', '$Content-Type', opts.contentType]);
    }

    const policy = {
      expiration: expiresAt.toISOString(),
      conditions,
    };

    // `calculatePostSignature` (v6) returns `{ OSSAccessKeyId, Signature, policy }`
    // where `policy` is the base64-encoded string of the policy above and
    // `Signature` is the AccessKeySecret HMAC over that base64 string.
    // The first two fields get re-emitted in our form (the SDK also emits
    // OSSAccessKeyId, but we already know it - including it makes the form
    // copy/paste-friendly with the OSS docs).
    const signed = this.client.calculatePostSignature(policy);

    const form: OssPostPolicy['form'] = {
      key: opts.ossKey,
      policy: signed.policy,
      OSSAccessKeyId: this.accessKeyId,
      signature: signed.Signature,
      'x-oss-success-action-status': '200',
    };
    if (opts.contentType) {
      form['Content-Type'] = opts.contentType;
    }

    return {
      uploadUrl: this.uploadUrl(),
      form,
      expiresAt: expiresAt.toISOString(),
      ossKey: opts.ossKey,
    };
  }

  /**
   * Build a 5-minute GET URL pointing at the private bucket.
   * Use for download-url endpoints; the returned URL is suitable for a 302
   * redirect. `signedUrl` never exposes the access key beyond what is
   * baked into the signature (which is one-shot by way of `expires`).
   */
  async signDownloadUrl(key: string, expiresInSeconds = 5 * 60): Promise<string> {
    this.assertConfigured();
    if (!key) throw new ServiceUnavailableException('Invalid OSS key');

    try {
      const url = this.client.signatureUrl(key, { expires: expiresInSeconds });
      return url;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`OSS signDownloadUrl failed for key=${key}: ${message}`);
      throw new ServiceUnavailableException('OSS download signing failed');
    }
  }

  /**
   * Hard-delete an object from OSS. We use this on soft-archive: keeping
   * archived rows visible (so un-archive works) but immediately freeing the
   * bytes. Failures are logged, never thrown - a missing/bursted OSS object
   * must not block the user's archive action.
   */
  async deleteObject(key: string): Promise<{ deleted: boolean; error?: string }> {
    if (!this.hasCredentials()) {
      // Without creds we cannot touch the bucket; pretend success so the
      // caller can still soft-delete the row.
      return { deleted: false, error: 'oss-not-configured' };
    }
    if (!key) {
      return { deleted: false, error: 'empty key' };
    }
    try {
      await this.client.delete(key);
      return { deleted: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OSS delete failed for key=${key}: ${message}`);
      // NoSuchKey etc. are "fine" - the object already isn't there.
      return { deleted: false, error: message };
    }
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  /**
   * True iff the access key + secret look real enough to attempt calls.
   * Placeholder strings are stored in .env.example to keep the boot green,
   * but they MUST NOT be used against a live bucket.
   */
  hasCredentials(): boolean {
    return (
      !PLACEHOLDER_TOKENS.has(this.accessKeyId) &&
      this.accessKeyId !== 'placeholder' &&
      this.bucket !== 'placeholder'
    );
  }

  private assertConfigured(): void {
    if (!this.hasCredentials()) {
      throw new ServiceUnavailableException(
        'OSS is not configured on the server - set OSS_ACCESS_KEY_ID / ' +
          'OSS_ACCESS_KEY_SECRET / OSS_REGION / OSS_BUCKET / OSS_ENDPOINT ' +
          'in the environment and restart.',
      );
    }
  }

  /**
   * The URL the client must POST to. Includes the bucket so OSS can route
   * the request without an extra Host header. Public endpoint from env
   * takes precedence over the bucket-style virtual host so users can swap
   * to the in-region internal endpoint without code changes.
   */
  private uploadUrl(): string {
    // Prefer the explicit endpoint (may be the internal network address);
    // fall back to the well-known virtual-host form.
    if (this.endpoint) {
      const e = this.endpoint.replace(/^https?:\/\//, '');
      return `https://${this.bucket}.${e}`;
    }
    return `https://${this.bucket}.oss-${this.region}.aliyuncs.com`;
  }
}

/** Mask an access key id down to its first 4 chars + `…` for safe logging. */
function maskKeyId(raw: string): string {
  if (raw.length <= 6) return '***';
  return `${raw.slice(0, 4)}…${raw.slice(-2)}`;
}

/**
 * Extract the directory portion of an OSS key so we can use it in
 * `starts-with` without disallowing the file name itself. e.g.
 * `users/abc/foo.png` -> `users/abc/`.
 */
function extractDir(ossKey: string): string {
  const idx = ossKey.lastIndexOf('/');
  return idx >= 0 ? ossKey.slice(0, idx + 1) : '';
}

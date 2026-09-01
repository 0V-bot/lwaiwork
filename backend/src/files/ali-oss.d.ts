/**
 * Local type declarations for `ali-oss` v6.
 *
 * Why this file exists:
 *   The published `ali-oss` package (6.23.0) does NOT ship its own .d.ts
 *   entry (the `main` field points at `./lib/client.js`), so TypeScript
 *   reports `TS7016 Could not find a declaration file for module 'ali-oss'`.
 *
 *   `@types/ali-oss` would normally fix this, but the npm registry here is
 *   intermittently blocked by a Windows lock on `_cacache/index-v5/...`,
 *   so we ship a hand-curated, narrow declaration covering ONLY the surface
 *   `OssProvider` actually uses:
 *
 *     * `new OSS(options)`                  - constructor
 *     * `client.calculatePostSignature(p)`   - returns OSS PostObject policy+signature
 *     * `client.signatureUrl(name, opts)`   - GET signed URL
 *     * `client.delete(name)`               - hard-delete an object
 *     * `client.getBucketInfo(name)`        - lightweight probe at boot
 *     * `client.options.accessKeyId/Secret` - SDK exposes the creds on options
 *
 *   Anything else is `any`-equivalent and gets surfaced at the call site;
 *   if we add a new method, declare it here too.
 *
 * Once npm registry access stabilises we should `npm i -D @types/ali-oss`
 * and delete this file.
 */
declare module 'ali-oss' {
  export interface OSSOptions {
    accessKeyId: string;
    accessKeySecret: string;
    /** Region id e.g. "oss-cn-hangzhou". Required by the SDK even though the endpoint carries it. */
    region: string;
    /** Bucket name. */
    bucket: string;
    /** Optional: override the SDK's inferred endpoint (public or internal address). */
    endpoint?: string;
    /** Retry count for SDK-internal transient errors. */
    retryLimit?: number;
    /** Per-request timeout in ms. */
    timeout?: number;
    /** STS refresh hook. We don't use it (we sign with the master AK), so declared optional. */
    refreshSTSToken?: unknown;
    /** STSToken companion. Same as above - declared so other SDK options don't trip TS. */
    stsToken?: unknown;
  }

  export interface OSSPostSignaturePolicy {
    expiration: string;
    conditions: Array<unknown>;
  }

  export interface OSSPostSignatureResult {
    /** AccessKeyId that the post form must carry (echoes the configured AK id). */
    OSSAccessKeyId: string;
    /** HMAC of the base64 policy, computed with the accessKeySecret. */
    Signature: string;
    /** Base64-encoded JSON form of the policy. */
    policy: string;
  }

  /**
   * Options accepted by `signatureUrl`. The SDK is broader than this; we
   * only declare what we use (5-minute GET expiry).
   */
  export interface OSSSignatureUrlOptions {
    /** Seconds until the URL expires. AliOSS default is 1800. */
    expires?: number;
    /** HTTP method (defaults to GET). */
    method?: 'GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD';
  }

  /**
   * The ali-oss client. We only declare the methods we use; an unknown
   * method call returns `any` at the TypeScript level.
   */
  export class OSS {
    constructor(options: OSSOptions);
    /** SDK exposes resolved options on this field - used to double-check creds at runtime. */
    readonly options: OSSOptions & { bucket: string };
    /** Inspect bucket metadata. Used by OssProvider.onModuleInit health probe. */
    getBucketInfo(name: string): Promise<unknown>;
    /**
     * Compute the signature for an OSS PostObject policy. Returns the three
     * fields that go into the multipart form body.
     */
    calculatePostSignature(policy: OSSPostSignaturePolicy): OSSPostSignatureResult;
    /**
     * Sign a single-object URL. For GET (default) the URL is fine to expose
     * to the browser. For PUT, the caller also passes `Content-Type`.
     */
    signatureUrl(name: string, options?: OSSSignatureUrlOptions): string;
    /** Asynchronous variant of signatureUrl, used when STSToken is enabled. */
    asyncSignatureUrl(name: string, options?: OSSSignatureUrlOptions): Promise<string>;
    /** Hard-delete an object. Missing objects resolve without throwing. */
    delete(name: string): Promise<unknown>;
    /** Head an object. Declared so the provider can probe freshness. */
    head(name: string, options?: unknown): Promise<{ status: number; headers: Record<string, string> }>;
  }

  /**
   * Default-exports the class so `import OSS from 'ali-oss'` works under
   * `esModuleInterop`. The package's runtime export IS the class; the type
   * ship is the constructor.
   */
  export default OSS;
}

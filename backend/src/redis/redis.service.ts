import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { type RedisOptions } from 'ioredis';

/**
 * Thin, failure-tolerant wrapper around ioredis.
 *
 * Design decision: Redis is treated as a *degradation-sensitive* dependency,
 * not a hard one at boot time. The module connects lazily and swallows
 * connection errors into logs so that `npm run start` still works on a machine
 * without Redis. Callers that truly require Redis (refresh-token storage)
 * surface an explicit 503 instead of an unhandled exception.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';

    const options: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times: number) => Math.min(times * 500, 5000),
      connectTimeout: 5000,
    };

    this.client = new Redis(url, options);

    // Without this listener ioredis emits an unhandled 'error' event and
    // crashes the whole Node process.
    this.client.on('error', (err: Error) => {
      this.logger.warn(`Redis error: ${err.message}`);
    });
    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('ready', () => this.logger.log('Redis ready'));
    this.client.on('reconnecting', () => this.logger.warn('Redis reconnecting...'));

    void this.connectSafely();
  }

  private async connectSafely(): Promise<void> {
    try {
      await this.client.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Redis unavailable at boot (${message}). Token revocation will be degraded. ` +
          `Start Redis and it will reconnect automatically.`,
      );
    }
  }

  get isHealthy(): boolean {
    const status = this.client.status;
    return status === 'ready' || status === 'connect';
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  /** SET key value EX ttlSeconds */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const n = await this.client.exists(key);
    return n > 0;
  }

  /** TTL in seconds; -1 = no expiry, -2 = key missing. */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

import axios from 'axios';
import {
  LocationSnapshot,
  RequesterContext,
  toChatbotSafeLocationSnapshot,
  validateLocationSnapshot,
} from './chatbot-data-contract';

export interface LocationScraperStatus {
  enabled: boolean;
  running: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  lastItemCount: number;
  totalUpserts: number;
  lagSeconds: number;
  stale: boolean;
  cursor: string | null;
}

interface ChatbotLocationFeedResponse {
  success: boolean;
  generatedAt?: string;
  nextCursor?: string;
  count?: number;
  items?: LocationSnapshot[];
}

interface ScraperConfig {
  feedUrl: string;
  apiKey: string;
  pollMs: number;
  maxRetries: number;
  retryDelayMs: number;
  requestTimeoutMs: number;
  staleThresholdMs: number;
}

type ChatbotSafeLocationRecord = NonNullable<ReturnType<typeof toChatbotSafeLocationSnapshot>>;

class ChatbotLocationIndex {
  private byEntityId = new Map<string, LocationSnapshot>();

  upsertMany(items: LocationSnapshot[]): number {
    let upserted = 0;

    items.forEach((item) => {
      const current = this.byEntityId.get(item.entityId);
      const currentMs = current ? Date.parse(current.updatedAt) : 0;
      const incomingMs = Date.parse(item.updatedAt);

      if (!current || Number.isNaN(currentMs) || (!Number.isNaN(incomingMs) && incomingMs >= currentMs)) {
        this.byEntityId.set(item.entityId, item);
        upserted += 1;
      }
    });

    return upserted;
  }

  count(): number {
    return this.byEntityId.size;
  }

  searchByName(nameQuery: string, requester: RequesterContext): ChatbotSafeLocationRecord[] {
    const query = String(nameQuery || '').trim().toLowerCase();
    if (!query) return [];

    const matches: ChatbotSafeLocationRecord[] = [];

    this.byEntityId.forEach((snapshot) => {
      const personName = String(snapshot.personName || '').toLowerCase();
      if (!personName.includes(query)) {
        return;
      }

      const safe = toChatbotSafeLocationSnapshot(snapshot, requester);
      if (safe) {
        matches.push(safe);
      }
    });

    return matches.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  }
}

function getDefaultConfig(): ScraperConfig {
  const baseUrl = String(process.env.BASE_URL || 'http://localhost:3000').trim();
  return {
    feedUrl: process.env.CHATBOT_LOCATION_FEED_URL || `${baseUrl}/api/internal/chatbot/location-feed`,
    apiKey: String(process.env.INTERNAL_SCRAPER_API_KEY || ''),
    pollMs: Math.max(5000, parseInt(process.env.CHATBOT_LOCATION_POLL_MS || '15000', 10)),
    maxRetries: Math.max(0, parseInt(process.env.CHATBOT_LOCATION_MAX_RETRIES || '3', 10)),
    retryDelayMs: Math.max(200, parseInt(process.env.CHATBOT_LOCATION_RETRY_DELAY_MS || '1200', 10)),
    requestTimeoutMs: Math.max(1000, parseInt(process.env.CHATBOT_LOCATION_REQUEST_TIMEOUT_MS || '8000', 10)),
    staleThresholdMs: Math.max(10000, parseInt(process.env.CHATBOT_LOCATION_STALE_THRESHOLD_MS || '90000', 10)),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class ChatbotLocationScraper {
  private readonly config: ScraperConfig;
  private readonly index = new ChatbotLocationIndex();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private cursor: string | null = null;
  private lastSuccessAtMs = 0;
  private lastAttemptAtMs = 0;
  private totalUpserts = 0;
  private lastItemCount = 0;
  private lastError: string | null = null;

  constructor(config?: Partial<ScraperConfig>) {
    this.config = {
      ...getDefaultConfig(),
      ...(config || {}),
    };
  }

  start(): boolean {
    if (this.running) return true;

    if (!this.config.apiKey) {
      this.lastError = 'INTERNAL_SCRAPER_API_KEY is required to start location scraper';
      return false;
    }

    this.running = true;
    this.schedule(0);
    return true;
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  searchByName(nameQuery: string, requester: RequesterContext): ChatbotSafeLocationRecord[] {
    return this.index.searchByName(nameQuery, requester);
  }

  getStatus(): LocationScraperStatus {
    const now = Date.now();
    const lagSeconds = this.lastSuccessAtMs > 0
      ? Math.max(0, Math.floor((now - this.lastSuccessAtMs) / 1000))
      : 0;

    return {
      enabled: true,
      running: this.running,
      lastSuccessAt: this.lastSuccessAtMs > 0 ? new Date(this.lastSuccessAtMs).toISOString() : null,
      lastAttemptAt: this.lastAttemptAtMs > 0 ? new Date(this.lastAttemptAtMs).toISOString() : null,
      lastError: this.lastError,
      lastItemCount: this.lastItemCount,
      totalUpserts: this.totalUpserts,
      lagSeconds,
      stale: this.lastSuccessAtMs > 0 ? (now - this.lastSuccessAtMs) > this.config.staleThresholdMs : false,
      cursor: this.cursor,
    };
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;

    this.timer = setTimeout(async () => {
      try {
        await this.pollWithRetry();
      } finally {
        this.schedule(this.config.pollMs);
      }
    }, delayMs);
  }

  private async pollWithRetry(): Promise<void> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= this.config.maxRetries) {
      try {
        await this.pollOnce();
        return;
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error || 'Unknown scraper error');
        lastError = new Error(message);
        attempt += 1;

        if (attempt > this.config.maxRetries) {
          break;
        }

        await sleep(this.config.retryDelayMs * attempt);
      }
    }

    if (lastError) {
      this.lastError = lastError.message;
    }
  }

  private async pollOnce(): Promise<void> {
    this.lastAttemptAtMs = Date.now();

    const params: Record<string, string> = {};
    if (this.cursor) {
      params.since = this.cursor;
    }

    const response = await axios.get<ChatbotLocationFeedResponse>(this.config.feedUrl, {
      params,
      timeout: this.config.requestTimeoutMs,
      headers: {
        'x-internal-api-key': this.config.apiKey,
      },
    });

    const payload = response.data;
    if (!payload || payload.success !== true) {
      throw new Error('Location feed request did not return success=true');
    }

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const validItems = rawItems.filter((item) => validateLocationSnapshot(item).length === 0);

    const upserted = this.index.upsertMany(validItems);
    this.totalUpserts += upserted;
    this.lastItemCount = validItems.length;
    this.lastSuccessAtMs = Date.now();
    this.lastError = null;

    if (typeof payload.nextCursor === 'string' && payload.nextCursor.trim().length > 0) {
      this.cursor = payload.nextCursor;
      return;
    }

    const maxUpdatedAtMs = validItems.reduce((max, item) => {
      const parsed = Date.parse(item.updatedAt);
      if (Number.isNaN(parsed)) return max;
      return parsed > max ? parsed : max;
    }, 0);

    if (maxUpdatedAtMs > 0) {
      this.cursor = new Date(maxUpdatedAtMs).toISOString();
    }
  }
}

const chatbotLocationScraper = new ChatbotLocationScraper();

export function startChatbotLocationScraper(): boolean {
  return chatbotLocationScraper.start();
}

export function stopChatbotLocationScraper(): void {
  chatbotLocationScraper.stop();
}

export function getChatbotLocationScraperStatus(): LocationScraperStatus {
  return chatbotLocationScraper.getStatus();
}

export function queryChatbotLocationByName(nameQuery: string, requester: RequesterContext): ChatbotSafeLocationRecord[] {
  return chatbotLocationScraper.searchByName(nameQuery, requester);
}

export function shouldEnableChatbotLocationScraper(): boolean {
  return String(process.env.ENABLE_CHATBOT_LOCATION_SCRAPER || '').toLowerCase() === 'true';
}

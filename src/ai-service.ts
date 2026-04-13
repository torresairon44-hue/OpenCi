import dotenv from 'dotenv';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Redis from 'ioredis';
import { OPENCI_SYSTEM_PROMPT, OPENCI_ANONYMOUS_KB, OPENCI_AUTHENTICATED_KB, extractMainConcern } from './openci-kb';
import { VectorStore } from './vector-store';
import { OpenCIAPI } from './openci-api';
import { Pool } from 'pg';
import { 
  getAdmins, 
  getFieldmen, 
  getAllUsers, 
  formatUserListForAI, 
  detectsUserListRequest,
  UserListResult 
} from './user-data-service';

dotenv.config();

const apiKey = process.env.GROQ_API_KEY;
const googleAIKey = process.env.GOOGLE_AI_API_KEY;
const AI_RESPONSE_DELAY_MS = parseInt(process.env.AI_RESPONSE_DELAY_MS || '3000', 10);
const GOOGLE_VISION_MODEL = process.env.GOOGLE_VISION_MODEL || 'gemini-1.5-flash';
const GOOGLE_TEXT_MODEL = process.env.GOOGLE_TEXT_MODEL || 'gemini-1.5-flash';
let groqConnected = false;
let availableModel = '';
const googleAIClient = googleAIKey ? new GoogleGenerativeAI(googleAIKey) : null;
const PROVIDER_FAILURE_THRESHOLD = parseInt(process.env.AI_PROVIDER_FAILURE_THRESHOLD || '3', 10);
const PROVIDER_CIRCUIT_OPEN_MS = parseInt(process.env.AI_PROVIDER_CIRCUIT_OPEN_MS || '60000', 10);

type ProviderName = 'groq' | 'google';

interface ProviderCircuitState {
  consecutiveFailures: number;
  openedUntilMs: number;
}

const providerCircuitState: Record<ProviderName, ProviderCircuitState> = {
  groq: { consecutiveFailures: 0, openedUntilMs: 0 },
  google: { consecutiveFailures: 0, openedUntilMs: 0 },
};

const aiRoutingMetrics = {
  requests: 0,
  offTopicBlocked: 0,
  fallbackUsed: 0,
  groqCalls: 0,
  groqFailures: 0,
  googleCalls: 0,
  googleFailures: 0,
  safetyRejections: 0,
};

type QueuedAIJob<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  enqueuedAtMs: number;
};

const AI_MAX_CONCURRENT_REQUESTS = parseInt(process.env.AI_MAX_CONCURRENT_REQUESTS || '8', 10);
const AI_MAX_QUEUED_REQUESTS = parseInt(process.env.AI_MAX_QUEUED_REQUESTS || '60', 10);
const AI_QUEUE_WAIT_TIMEOUT_MS = parseInt(process.env.AI_QUEUE_WAIT_TIMEOUT_MS || '15000', 10);
const AI_DISTRIBUTED_MAX_INFLIGHT = parseInt(process.env.AI_DISTRIBUTED_MAX_INFLIGHT || String(Math.max(8, AI_MAX_CONCURRENT_REQUESTS)), 10);
const AI_DISTRIBUTED_SLOT_TTL_SEC = parseInt(process.env.AI_DISTRIBUTED_SLOT_TTL_SEC || '120', 10);
const AI_DISTRIBUTED_SLOT_RETRY_MS = parseInt(process.env.AI_DISTRIBUTED_SLOT_RETRY_MS || '80', 10);
const REDIS_URL = String(process.env.REDIS_URL || '').trim();
const DISTRIBUTED_INFLIGHT_KEY = String(process.env.AI_DISTRIBUTED_INFLIGHT_KEY || 'openci:ai:inflight').trim();
let aiInFlightRequests = 0;
const aiRequestQueue: Array<QueuedAIJob<any>> = [];
let redisClient: Redis | null = null;

function getRedisClient(): Redis | null {
  if (!REDIS_URL) return null;
  if (redisClient) return redisClient;

  redisClient = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });

  redisClient.on('error', (error) => {
    console.warn('Redis unavailable for distributed AI guard:', error?.message || 'unknown error');
  });

  return redisClient;
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireDistributedAISlot(waitTimeoutMs: number): Promise<() => Promise<void>> {
  const client = getRedisClient();
  if (!client) {
    return async () => {};
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt <= Math.max(500, waitTimeoutMs)) {
    try {
      if (client.status !== 'ready') {
        await client.connect().catch(() => {});
      }

      const inFlight = await client.incr(DISTRIBUTED_INFLIGHT_KEY);
      await client.expire(DISTRIBUTED_INFLIGHT_KEY, Math.max(30, AI_DISTRIBUTED_SLOT_TTL_SEC));
      if (inFlight <= AI_DISTRIBUTED_MAX_INFLIGHT) {
        return async () => {
          try {
            await client.decr(DISTRIBUTED_INFLIGHT_KEY);
          } catch {
            // Best effort release.
          }
        };
      }

      await client.decr(DISTRIBUTED_INFLIGHT_KEY);
    } catch {
      // Fail-open to preserve service availability if Redis is unstable.
      return async () => {};
    }

    await sleepMs(Math.max(20, AI_DISTRIBUTED_SLOT_RETRY_MS));
  }

  throw createAIQueueBusyError();
}

async function runWithDistributedAISlot<T>(run: () => Promise<T>): Promise<T> {
  const release = await acquireDistributedAISlot(AI_QUEUE_WAIT_TIMEOUT_MS);
  try {
    return await run();
  } finally {
    await release();
  }
}

function createAIQueueBusyError(): Error {
  const error: any = new Error('AI_QUEUE_BUSY');
  error.code = 'AI_QUEUE_BUSY';
  return error;
}

function drainAIQueue(): void {
  while (aiInFlightRequests < AI_MAX_CONCURRENT_REQUESTS && aiRequestQueue.length > 0) {
    const nextJob = aiRequestQueue.shift();
    if (!nextJob) {
      return;
    }

    const queueWaitMs = Date.now() - nextJob.enqueuedAtMs;
    if (queueWaitMs > AI_QUEUE_WAIT_TIMEOUT_MS) {
      nextJob.reject(createAIQueueBusyError());
      continue;
    }

    aiInFlightRequests += 1;
    runWithDistributedAISlot(nextJob.run)
      .then(nextJob.resolve)
      .catch(nextJob.reject)
      .finally(() => {
        aiInFlightRequests = Math.max(0, aiInFlightRequests - 1);
        drainAIQueue();
      });
  }
}

async function runQueuedAIRequest<T>(run: () => Promise<T>): Promise<T> {
  if (aiInFlightRequests < AI_MAX_CONCURRENT_REQUESTS && aiRequestQueue.length === 0) {
    aiInFlightRequests += 1;
    try {
      return await runWithDistributedAISlot(run);
    } finally {
      aiInFlightRequests = Math.max(0, aiInFlightRequests - 1);
      drainAIQueue();
    }
  }

  if (aiRequestQueue.length >= AI_MAX_QUEUED_REQUESTS) {
    throw createAIQueueBusyError();
  }

  return await new Promise<T>((resolve, reject) => {
    aiRequestQueue.push({ run, resolve, reject, enqueuedAtMs: Date.now() });
    drainAIQueue();
  });
}

function isProviderCircuitOpen(provider: ProviderName): boolean {
  return Date.now() < providerCircuitState[provider].openedUntilMs;
}

function recordProviderFailure(provider: ProviderName, forceOpen: boolean = false): void {
  const state = providerCircuitState[provider];
  state.consecutiveFailures += 1;
  if (provider === 'groq') aiRoutingMetrics.groqFailures += 1;
  if (provider === 'google') aiRoutingMetrics.googleFailures += 1;
  if (forceOpen || state.consecutiveFailures >= PROVIDER_FAILURE_THRESHOLD) {
    state.openedUntilMs = Date.now() + PROVIDER_CIRCUIT_OPEN_MS;
  }
}

function recordProviderSuccess(provider: ProviderName): void {
  providerCircuitState[provider] = { consecutiveFailures: 0, openedUntilMs: 0 };
}

export class AIProviderLimitError extends Error {
  provider: 'groq' | 'google';
  statusCode?: number;

  constructor(provider: 'groq' | 'google', message: string, statusCode?: number) {
    super(message);
    this.name = 'AIProviderLimitError';
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

function isProviderLimitError(error: any): boolean {
  const status = Number(error?.response?.status || 0);
  const raw = JSON.stringify(error?.response?.data || error?.message || '').toLowerCase();
  if (status === 429) return true;
  if (status === 402) return true;
  if (status === 403 && /(quota|rate.?limit|insufficient_quota|resource_exhausted|resource exhausted|billing)/i.test(raw)) {
    return true;
  }
  return /(quota|rate.?limit|insufficient_quota|resource_exhausted|resource exhausted)/i.test(raw);
}

// OPTION B & C Integration
let vectorStore: VectorStore | null = null;
let openCIAPI: OpenCIAPI | null = null;

if (!apiKey) {
  console.error('❌ GROQ_API_KEY not configured');
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

async function discoverAvailableModels(): Promise<string> {
  if (!apiKey) return 'llama-3.3-70b-versatile';

  try {
    console.log('   Discovering available Groq models...');
    const response = await axios.get(
      'https://api.groq.com/openai/v1/models',
      {
        timeout: 5000,
        headers: { Authorization: `Bearer ${apiKey}` }
      }
    );

    const models: string[] = (response.data?.data || []).map((m: any) => m.id);
    if (models.length > 0) {
      console.log(`   Found ${models.length} available Groq models`);
      const preferred = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'];
      const chosen = preferred.find(p => models.includes(p)) || models[0];
      console.log(`   Using model: ${chosen}`);
      return chosen;
    }
  } catch (error: any) {
    console.log(`   Could not list Groq models: ${error?.response?.status || error.message?.substring(0, 50)}`);
  }

  return 'llama-3.3-70b-versatile';
}

const CORE_KB = `
### 1. Platform Overview
- OpenCI Modules: CI (Credit Investigation), DL (Demand Letters), SC (Skip & Collect), Tele-CI, Form Builder, Workforce Management.
- Banks: TFS, SBF, CBS, BDO, BPI, CSB, ESQ, EWB, FHL, FUSE, HOME CREDIT, HSBC, PNB, RSB, RCBC, PSB, UBP, MANULIFE, MAYA, MBTC, MSB, TALA, AUB.
- Attachments: PDF, JPEG, PNG, JPG, HEIC, HEIF, CSV, XLSX, XLS, DOC, DOCX, TXT, ZIP, RAR.

### 2. Module Workflows
- DL Admin Workflow: GENERATED -> PRINTED -> RELEASED TO OIC -> RELEASED TO FM -> VISITED -> DONE/RETURNED/PULLED_OUT.
- SC Activities: Driving, Skip Tracing, Touch Point, Disposition.
- Live Map: Green (Live), Grey (Stale), Blue (Home/Inactive). 
- Workforce: Timeline (8 AM - 5 PM). "Waiting" is a red gap.

### 3. Technical Troubleshooting
- Lark Issues: Password resets are IT only. Contact IT for login issues.
- App Update: Uninstall/Install via Play Store if button missing. Force Stop in settings.
- Performance: "The developer is currently working on it." Refer to Mr. Brann.
- GPS: Check internet and permissions.

### 4. Critical Rules
- Mandatory Tagging: VRP/OSRM are NOT active. Visibility issues = No Tagging (Refer to Area Coordinator).
- Field Rules: Late reporting/Early out prohibited. Photos must be real-time. 1-hour break.
`;

// Option A: Enhanced system prompt with OpenCI v2 knowledge
const ICIO_V2_SYSTEM_PROMPT = OPENCI_SYSTEM_PROMPT;

const RESPONSE_LOGIC = `
## STEP 1: Mandatory Name Capture
- Rule: If {{user_name}} is NOT provided AND the user is NOT a logged-in Lark user, output ONLY: "Hi! Ano po pangalan mo?"
- Rule: If the user is a logged-in Lark user with a known name, SKIP this step entirely. Do NOT ask for their name. Do NOT change or overwrite their name even if they say a different name. Proceed directly to STEP 2.

## STEP 2: Role Confirmation
- Output: "Thanks {{user_name}}! Ikaw ba ay Fieldman or Admin?"
- If user is logged-in with known name but unknown role, ask: "Hi {{user_name}}! Ikaw ba ay Fieldman or Admin?"

## GUARDRAILS
- Max 2 sentences per response.
- STRICTLY answer ONLY about OpenCI-related topics. If the user asks about ANYTHING not related to OpenCI (e.g., general knowledge, math, coding, recipes, weather, news, personal advice, other software, entertainment, or any non-OpenCI topic), respond ONLY with: "Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?"
- Answer ONLY from KB. If the question is within OpenCI scope but unknown: "I-check ko muna ito with the OpenCI Team."
- **Relevance Rule**: Only mention specific Banks or Modules if the user's query is directly related to them. DO NOT list all banks or modules unless explicitly asked.
- **Name Guardrail for Logged-in Users**: If the user is logged in via Lark and their real name is provided in the user context, NEVER ask for their name and NEVER overwrite it. Always use the Lark-provided name.
- NEVER answer general knowledge questions, even if you know the answer. Your ONLY domain is OpenCI.
`;

const GREENAI_SYSTEM_PROMPT = `
# Icio – OpenCI Intelligent AI Help Desk Assistant v2.0
Role: Technical Support Specialist.
Tone: Modern Taglish (70/30), Chill, Expert Authority. 
Style Rule: Match the user's energy. If the user is short and casual, keep your response short and casual.

${RESPONSE_LOGIC}
${CORE_KB}

## Final Instructions
- **Strictly NO markdown formatting**: Do NOT use asterisks (*), double asterisks (**), or any special characters for bullet points or emphasis. Always use pure plain text. No stars allowed.
- Strictly no hallucination.
- **OFF-TOPIC REJECTION (HIGHEST PRIORITY)**: If the user asks about ANYTHING not related to OpenCI, respond ONLY with: "Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?" Do NOT answer general knowledge, math, coding, recipes, weather, news, personal advice, other software, entertainment, or any non-OpenCI topic under ANY circumstances.
- **No Unsolicited Info**: Do not provide lists of banks, modules, or technical details unless they are directly relevant to the user's specific question.
- Do not ask "What is the next step?". Lead the conversation.
- If user refuses name (anonymous only): "Kailangan ko muna ang pangalan mo bago tayo mag-proceed."
- If user is logged in via Lark with a known name, skip name capture and go straight to role confirmation or help.
`;

// ══════════════════════════════════════════════════════════════
// FALLBACK DEMO RESPONSES (when AI is unavailable)
// ══════════════════════════════════════════════════════════════
const demoResponses: { [key: string]: string[] } = {
  greeting: [
    'Hi! OpenCI concern mo ba ito? Sabihin mo lang ang exact issue.',
    'Hello! I can only help with OpenCI-related concerns. Ano po ang concern mo sa OpenCI?',
    'Hi there! Para sa OpenCI support, pakisabi ang specific module or issue.'
  ],
  help: [
    'I can help with OpenCI modules and troubleshooting only. Ano po ang concern mo sa OpenCI?',
    'OpenCI support lang ang scope ko. Pakibigay ang exact OpenCI issue para ma-guide kita.'
  ],
  default: [
    'Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?',
    'OpenCI-related concerns only. Pakispecify ang issue mo sa OpenCI para ma-assist kita.'
  ]
};

function generateDemoResponse(userMessage: string): string {
  const message = userMessage.toLowerCase();

  // Check for greetings
  if (/^(hi|hello|hey|greetings|hey there|sup|what\'s up)/i.test(message)) {
    return demoResponses.greeting[Math.floor(Math.random() * demoResponses.greeting.length)];
  }

  // Check for help requests
  if (/help|assist|support|how do i|how do you|what (is|are)|explain|tell me about/i.test(message)) {
    return demoResponses.help[Math.floor(Math.random() * demoResponses.help.length)];
  }

  // Default response
  return demoResponses.default[Math.floor(Math.random() * demoResponses.default.length)];
}

// ══════════════════════════════════════════════════════════════
// ROLE DETECTION HELPER
// ══════════════════════════════════════════════════════════════

function detectRoleFromUserMessage(userMessage: string): string | null {
  const message = userMessage.toLowerCase();
  if (/\bfieldman\b|\bfield man\b|\bfield agent\b|\bfa\b/.test(message)) {
    return 'fieldman';
  }
  if (/\badmin\b|\badministrator\b/.test(message)) {
    return 'admin';
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// PRE-FLIGHT OFF-TOPIC DETECTION
// Catches obvious off-topic requests BEFORE sending to AI model
// ══════════════════════════════════════════════════════════════

/**
 * Sanitizes conversation history to remove hallucinated or off-topic content
 * This prevents the AI from "remembering" and repeating bad responses
 */
function sanitizeConversationHistory(history: any[]): any[] {
  if (!Array.isArray(history)) return [];
  
  const offTopicPatterns = [
    // Restaurant/food content
    /\b(jollibee|mcdonalds?|kfc|chowking|chickenjoy|yumburger|burger\s+steak|palabok|spaghetti|menu|food|restaurant|kainan)\b/i,
    // Mall/shopping content
    /\b(sm\s+(city|mall|supermall)|robinsons?|ayala|mall|shopping)\b/i,
    // Color questions about brands
    /\bcolor\s+of\s+(jollibee|mcdonalds?|kfc)\b/i,
    // Fake user data indicators
    /\b(ronald\s+airon\s+torres|juan\s+dela\s+cruz|maria\s+rodriguez|john\s+doe|jane\s+smith)\b/i,
  ];
  
  return history.map(msg => {
    if (msg.role === 'assistant' && msg.content) {
      const content = msg.content.toString();
      
      // Check if the message contains off-topic or hallucinated content
      const containsOffTopic = offTopicPatterns.some(pattern => pattern.test(content));
      
      if (containsOffTopic) {
        // Replace the hallucinated content with a safe rejection
        return {
          ...msg,
          content: 'Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?'
        };
      }
    }
    return msg;
  });
}

function detectOffTopicRequest(message: string): string | null {
  const lower = message.toLowerCase();

  // SUMMARIZE/PREVIOUS CONVERSATION checks - prevent summarizing hallucinated content
  if (/\b(summar|previous|earlier|buod|recap|review)\b/i.test(lower)) {
    // Check if asking to summarize non-OpenCI content
    const hasOffTopicKeywords = /\b(jollibee|mcdonalds?|restaurant|menu|chickenjoy|yumburger|mall|sm\s+city|robinsons?|food|kainan)\b/i.test(lower);
    if (hasOffTopicKeywords) {
      return 'Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?';
    }
  }

  // RESTAURANT/FOOD requests
  if (/\b(restaurant|kainan|food|menu|order|eat|dining|cafe|coffee\s*shop)\b/i.test(lower)) {
    if (/\b(list|give|show|what|where|recommend|suggest|near|around)\b/i.test(lower)) {
      return 'Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?';
    }
  }

  // Specific restaurant brand requests
  if (/\b(jollibee|mcdonalds?|mcdonald's|kfc|chowking|greenwich|andok|mang\s*inasal|bonchon|starbucks|burger\s*king|wendy|subway)\b/i.test(lower)) {
    return 'Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?';
  }

  // Menu requests
  if (/\b(menu|pagkain|ulam|order|price\s*list|meal|combo)\b/i.test(lower) && !/\b(openci|form|module)\b/i.test(lower)) {
    return 'Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?';
  }

  // Shopping/mall requests
  if (/\b(mall|shop|store|buy|purchase|sale|discount|promo)\b/i.test(lower) && !/\b(openci|app|play\s*store)\b/i.test(lower)) {
    return 'Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?';
  }

  // Color/brand characteristic questions (e.g., "what is the color of Jollibee")
  if (/\b(color|kulay|logo|brand)\b/i.test(lower) && /\b(jollibee|mcdonalds?|kfc|chowking)\b/i.test(lower)) {
    return 'Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?';
  }

  // NOTE: User list requests are now handled by fetchRealUserDataIfRequested() 
  // which queries the actual database instead of blocking or hallucinating.

  return null;
}

// ══════════════════════════════════════════════════════════════
// REAL DATA FETCHER FOR USER LIST REQUESTS
// Queries actual database to prevent hallucination
// ══════════════════════════════════════════════════════════════

async function fetchRealUserDataIfRequested(
  message: string,
  isAuthenticated: boolean
): Promise<{ handled: boolean; response: string | null; contextData: string | null }> {
  // Only authenticated users can access user lists
  if (!isAuthenticated) {
    const detection = detectsUserListRequest(message);
    if (detection.isUserListRequest) {
      return {
        handled: true,
        response: 'Para makita ang user list, kailangan mong mag-login muna sa iyong account.',
        contextData: null
      };
    }
    return { handled: false, response: null, contextData: null };
  }

  const detection = detectsUserListRequest(message);
  if (!detection.isUserListRequest) {
    return { handled: false, response: null, contextData: null };
  }

  let result: UserListResult;
  
  switch (detection.requestType) {
    case 'admins':
      result = await getAdmins();
      break;
    case 'fieldmen':
      result = await getFieldmen();
      break;
    case 'all':
      result = await getAllUsers();
      break;
    default:
      return { handled: false, response: null, contextData: null };
  }

  if (!result.success) {
    return {
      handled: true,
      response: 'I-check ko muna ito with the OpenCI Team. May technical issue sa pag-access ng user data.',
      contextData: null
    };
  }

  if (result.data.length === 0) {
    const typeLabel = detection.requestType === 'admins' ? 'admin' 
      : detection.requestType === 'fieldmen' ? 'fieldman' 
      : 'user';
    return {
      handled: true,
      response: `Wala pang registered ${typeLabel}s sa system ngayon.`,
      contextData: null
    };
  }

  // Deterministic grounded response to prevent model-side list blocking/hallucination drift.
  const roleLabel = detection.requestType === 'admins'
    ? 'admins'
    : detection.requestType === 'fieldmen'
      ? 'fieldmen'
      : 'users';
  const names = result.data
    .map((item, index) => {
      const title = item.role === 'admin' ? 'Admin' : item.role === 'fieldman' ? 'Fieldman' : 'User';
      return `${index + 1}. ${item.username} - ${title}`;
    })
    .join('\n');

  return {
    handled: true,
    response: `Ito ang verified list ng ${roleLabel}:\n${names}`,
    contextData: formatUserListForAI(result)
  };
}

export interface UserProfile {
  name?: string;
  role?: string; // 'admin' | 'fieldman' | 'unknown' | undefined
}

export interface ImageAttachment {
  mimeType: string;
  dataBase64: string;
}

export interface GenerateAIResponseOptions {
  suggestedPromptFirstTurn?: boolean;
  imageAttachment?: ImageAttachment;
  imageAttachments?: ImageAttachment[];
  ocrExtractedText?: string;
  hasImageInput?: boolean;
}

function buildRetrievalQueries(userMessage: string, mainConcern: string): string[] {
  const base = sanitizePromptControlContent(userMessage);
  const concern = sanitizePromptControlContent(mainConcern || '');

  const queries: string[] = [];
  if (base) queries.push(base);
  if (concern && concern.length > 2 && concern.toLowerCase() !== base.toLowerCase()) {
    queries.push(`OpenCI ${concern}`);
  }

  return Array.from(new Set(queries));
}

function keywordOverlapScore(query: string, content: string): number {
  const queryTokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);

  if (queryTokens.length === 0) return 0;

  const contentLower = String(content || '').toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (contentLower.includes(token)) hits += 1;
  }

  return hits / queryTokens.length;
}

export function getAIRoutingMetrics() {
  return {
    ...aiRoutingMetrics,
    providerCircuits: {
      groq: {
        open: isProviderCircuitOpen('groq'),
        consecutiveFailures: providerCircuitState.groq.consecutiveFailures,
        openedUntilMs: providerCircuitState.groq.openedUntilMs,
      },
      google: {
        open: isProviderCircuitOpen('google'),
        consecutiveFailures: providerCircuitState.google.consecutiveFailures,
        openedUntilMs: providerCircuitState.google.openedUntilMs,
      },
    },
  };
}

function applyImageInputFallback(text: string, options: GenerateAIResponseOptions): string {
  if (!options.hasImageInput) {
    return text;
  }

  const normalizedText = String(text || '');
  const looksLikeOffTopicRejection = /sorry,?\s*i can only help with openci-related questions/i.test(normalizedText);
  if (!looksLikeOffTopicRejection) {
    return text;
  }

  const ocrText = sanitizePromptControlContent(String(options.ocrExtractedText || ''));
  const seemsLikeLoginScreenshot = /open\s*ci|sign\s*in|login|lark/i.test(ocrText);

  if (seemsLikeLoginScreenshot) {
    return 'Mukhang OpenCI login screen ito. Ano ang specific issue: hindi maka-login, walang access, o hindi gumagana ang Continue with Lark button?';
  }

  return 'Nakita ko na may attached image ka. I can analyze OpenCI screenshots; pakisabi ang specific issue sa image para ma-guide kita step by step.';
}

async function generateAIResponseCore(
  userMessage: string,
  conversationHistory: any[] = [],
  conversationId?: string,
  userProfile?: UserProfile,
  isAuthenticated: boolean = true,
  options: GenerateAIResponseOptions = {}
): Promise<{ text: string; detectedRole: string | null }> {
  aiRoutingMetrics.requests += 1;

  // Keep role detection metadata-only for anonymous UX; never mutate DB role from chat text.
  const detectedRole = isAuthenticated ? null : detectRoleFromUserMessage(userMessage);

  const normalizedUserMessage = sanitizePromptControlContent(userMessage);

  // PRE-FLIGHT OFF-TOPIC DETECTION: Reject obviously off-topic requests before sending to AI
  const earlyRejection = detectOffTopicRequest(normalizedUserMessage);
  if (earlyRejection) {
    aiRoutingMetrics.offTopicBlocked += 1;
    if (AI_RESPONSE_DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, AI_RESPONSE_DELAY_MS));
    }
    return { text: earlyRejection, detectedRole };
  }

  // DATA GROUNDING: Fetch real user data if this is a user list request
  // This prevents hallucination by injecting actual database data
  let realUserDataContext = '';
  const userDataResult = await fetchRealUserDataIfRequested(normalizedUserMessage, isAuthenticated);
  if (userDataResult.handled && userDataResult.response) {
    // Direct response from data service (e.g., no data found, auth required)
    if (AI_RESPONSE_DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, AI_RESPONSE_DELAY_MS));
    }
    return { text: userDataResult.response, detectedRole };
  }
  if (userDataResult.contextData) {
    // Real data to inject into AI context
    realUserDataContext = `\n\n## VERIFIED USER DATA FROM DATABASE (USE THIS EXACTLY - DO NOT INVENT NAMES)\n${userDataResult.contextData}\n- IMPORTANT: Present ONLY the names listed above. Do NOT add, modify, or invent any names.`;
  }

  // Detect user concern from message
  const mainConcern = extractMainConcern(normalizedUserMessage);

  // Option B: Use vector store for semantic search if available
  // Anonymous users only get 'public' access-level documents
  let contextFromVectorStore = '';
  if (vectorStore && conversationId) {
    try {
      // Add embedding for this message
      await vectorStore.addConversationEmbedding(conversationId, normalizedUserMessage);

      // DeepRAG-lite: run multi-query retrieval and lightweight reranking.
      const accessLevel = isAuthenticated ? undefined : 'public';
      const retrievalQueries = buildRetrievalQueries(normalizedUserMessage, mainConcern);
      const candidateMap = new Map<string, any>();

      for (const retrievalQuery of retrievalQueries) {
        const rawResults = await vectorStore.search(retrievalQuery, 5, 0.35, accessLevel);
        for (const item of rawResults) {
          const previous = candidateMap.get(item.id);
          if (!previous || Number(item.similarity || 0) > Number(previous.similarity || 0)) {
            candidateMap.set(item.id, item);
          }
        }
      }

      const searchResults = Array.from(candidateMap.values())
        .map((item) => {
          const similarity = Number(item.similarity || 0);
          const overlap = keywordOverlapScore(normalizedUserMessage, String(item.content || ''));
          const finalScore = similarity * 0.8 + overlap * 0.2;
          return { ...item, finalScore };
        })
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, 4);

      if (searchResults.length > 0) {
        contextFromVectorStore = '\n\nRelevant Knowledge Base:\n' +
          searchResults.map(r => `- [${r.type}] ${r.content.substring(0, 220)}`).join('\n');
      }
    } catch (error) {
      console.log('Vector store search incomplete:', error instanceof Error ? error.message.substring(0, 50) : 'unknown');
    }
  }

  // Option C: Get real-time context from OpenCI API if available
  // Only for authenticated users — anonymous users don't get live operational data
  let contextFromAPI = '';
  if (isAuthenticated && openCIAPI && openCIAPI.isConnected()) {
    try {
      const status = await openCIAPI.getSystemStatus();
      if (status.success && status.data) {
        contextFromAPI = `\n\n[Real-time OpenCI Status]\nActive Agents: ${status.data.activeAgents || 'N/A'}\nPending DLs: ${status.data.pendingDLs || 'N/A'}`;
      }
    } catch (error) {
      // Gracefully handle API unavailability
    }
  }

  // Build system prompt with all context
  // Inject user profile for logged-in users to skip name/role capture
  let userContextBlock = '';
  if (userProfile?.name) {
    userContextBlock += `\n\n## AUTHENTICATED USER CONTEXT\n`;
    userContextBlock += `- User is ALREADY LOGGED IN via Lark. Their verified name is: ${userProfile.name}\n`;
    userContextBlock += `- GUARDRAIL: Do NOT ask for the user's name. NEVER ask "Ano po pangalan mo?" — you already know their name.\n`;
    userContextBlock += `- Always address them by name: ${userProfile.name}\n`;
    if (userProfile.role && userProfile.role !== 'unknown') {
      userContextBlock += `- Their verified role is: ${userProfile.role}. Do NOT ask for their role.\n`;
      userContextBlock += `- SKIP Steps 1 and 2 entirely. Proceed directly to helping them.\n`;
    } else {
      userContextBlock += `- Their role is NOT yet known. SKIP Step 1 (name) but DO ask Step 2: "Hi ${userProfile.name}! Ikaw ba ay Fieldman or Admin?"\n`;
    }
  }

  let trustedInteractionHints = '';
  if (options.suggestedPromptFirstTurn && !isAuthenticated) {
    trustedInteractionHints = `\n\n## SERVER TRUSTED INTERACTION HINT
- This anonymous first-turn message came from a suggested prompt click.
- Answer the OpenCI question in ONE concise sentence first.
- Immediately ask: "Ano po pangalan mo?"
- Do not skip name capture after the one-sentence answer.`;
  }

  if (options.hasImageInput) {
    trustedInteractionHints += `\n\n## SERVER IMAGE ANALYSIS HINT
- The user attached image input for analysis.
- Treat this request as OpenCI-related image analysis unless the image text clearly shows unrelated content.
- If OCR text is partial/noisy, still provide a best-effort OpenCI-focused explanation of visible UI elements.`;
  }

  let ocrContextBlock = '';
  if (options.ocrExtractedText) {
    const normalizedOCRText = sanitizePromptControlContent(String(options.ocrExtractedText)).substring(0, 7000);
    if (normalizedOCRText) {
      ocrContextBlock = `\n\n## OCR CONTEXT FROM ATTACHED IMAGES\n${normalizedOCRText}\n- Treat OCR text as user-provided image transcription that may contain noise; prioritize relevant OpenCI details only.`;
    }
  }

  // Select knowledge tier based on authentication
  // Anonymous users get the stripped-down ANONYMOUS_KB
  // Authenticated users get the full system prompt + authenticated KB
  const basePrompt = isAuthenticated
    ? `${ICIO_V2_SYSTEM_PROMPT}\n${OPENCI_AUTHENTICATED_KB}`
    : OPENCI_ANONYMOUS_KB;

  const systemPrompt = `${basePrompt}
${userContextBlock}
${trustedInteractionHints}
${ocrContextBlock}
${realUserDataContext}
DETECTED CONCERN: ${mainConcern}
${contextFromVectorStore}
${contextFromAPI}

User Profile Context: ${JSON.stringify(conversationHistory[0]?.context || {})}`;

  // Format messages for Groq (OpenAI-compatible format)
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt }
  ];

  // Sanitize conversation history to remove hallucinated/off-topic content
  const sanitizedHistory = sanitizeConversationHistory(conversationHistory);

  for (const m of sanitizedHistory) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = role === 'assistant'
      ? String(m.content)
      : sanitizePromptControlContent(String(m.content));
    messages.push({ role, content });
  }
  messages.push({ role: 'user', content: normalizedUserMessage });

  const imageInputs = Array.isArray(options.imageAttachments) && options.imageAttachments.length > 0
    ? options.imageAttachments
    : (options.imageAttachment ? [options.imageAttachment] : []);
  const providerLimitSignals: Array<'groq' | 'google'> = [];

  if (imageInputs.length > 0 && googleAIClient && !isProviderCircuitOpen('google')) {
    try {
      aiRoutingMetrics.googleCalls += 1;
      const visionModel = googleAIClient.getGenerativeModel({ model: GOOGLE_VISION_MODEL });
      
      // Sanitize conversation history before using it in vision prompt
      const sanitizedHistory = sanitizeConversationHistory(conversationHistory);
      
      const historySummary = sanitizedHistory
        .slice(-6)
        .map((m: any) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${String(m.content).substring(0, 500)}`)
        .join('\n');

      const visionPrompt = `${systemPrompt}

Conversation History:
${historySummary || 'No prior messages.'}

Use the attached image(s) and the latest user message to answer accurately within OpenCI scope.
If multiple images are attached, analyze each image and combine findings before answering.
Latest user message: ${normalizedUserMessage}`;

      const visionParts: any[] = [{ text: visionPrompt }];
      for (const imageInput of imageInputs.slice(0, 3)) {
        visionParts.push({
          inlineData: {
            mimeType: imageInput.mimeType,
            data: imageInput.dataBase64,
          },
        });
      }

      const result = await visionModel.generateContent(visionParts as any);

      const visionText = result.response.text();
      if (visionText) {
        recordProviderSuccess('google');
        const cleanedText = applyImageInputFallback(enforceResponseSafety(visionText), options);
        if (AI_RESPONSE_DELAY_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, AI_RESPONSE_DELAY_MS));
        }
        return { text: cleanedText, detectedRole };
      }
    } catch (error: any) {
      if (isProviderLimitError(error)) {
        providerLimitSignals.push('google');
        recordProviderFailure('google', true);
      } else {
        recordProviderFailure('google');
        console.log(`❌ ${GOOGLE_VISION_MODEL} image processing failed:`, error?.message || error);
      }
    }
  }

  if (availableModel && apiKey && !isProviderCircuitOpen('groq')) {
    try {
      aiRoutingMetrics.groqCalls += 1;
      console.log(`🔗 Using Groq model: ${availableModel} with Icio v2.0 System Prompt...`);
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: availableModel,
          messages,
          max_tokens: 1024,
          temperature: 0.4
        },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          }
        }
      );

      const text = response.data?.choices?.[0]?.message?.content;
      if (text) {
        recordProviderSuccess('groq');
        const cleanedText = applyImageInputFallback(enforceResponseSafety(text), options);
        // Apply artificial delay so AI appears to "think" more thoroughly
        if (AI_RESPONSE_DELAY_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, AI_RESPONSE_DELAY_MS));
        }
        return { text: cleanedText, detectedRole };
      }
    } catch (error: any) {
      if (isProviderLimitError(error)) {
        providerLimitSignals.push('groq');
        recordProviderFailure('groq', true);
      } else {
        recordProviderFailure('groq');
        console.log(`❌ ${availableModel} failed:`, error?.response?.data || error.message);
      }
    }
  }

  // Text failover via Google AI when Groq is degraded or unavailable.
  if (googleAIClient && !isProviderCircuitOpen('google')) {
    try {
      aiRoutingMetrics.googleCalls += 1;
      const textModel = googleAIClient.getGenerativeModel({ model: GOOGLE_TEXT_MODEL });
      const historySummary = sanitizedHistory
        .slice(-8)
        .map((m: any) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${String(m.content).substring(0, 500)}`)
        .join('\n');

      const textPrompt = `${systemPrompt}

Conversation History:
${historySummary || 'No prior messages.'}

Latest user message: ${normalizedUserMessage}`;

      const result = await textModel.generateContent([{ text: textPrompt }] as any);
      const text = result.response.text();
      if (text) {
        recordProviderSuccess('google');
        const cleanedText = applyImageInputFallback(enforceResponseSafety(text), options);
        if (AI_RESPONSE_DELAY_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, AI_RESPONSE_DELAY_MS));
        }
        return { text: cleanedText, detectedRole };
      }
    } catch (error: any) {
      if (isProviderLimitError(error)) {
        providerLimitSignals.push('google');
        recordProviderFailure('google', true);
      } else {
        recordProviderFailure('google');
        console.log(`❌ ${GOOGLE_TEXT_MODEL} text generation failed:`, error?.message || error);
      }
    }
  }

  if (providerLimitSignals.length > 0) {
    const preferredProvider: 'groq' | 'google' = providerLimitSignals.includes('groq') ? 'groq' : 'google';
    throw new AIProviderLimitError(preferredProvider, 'AI provider quota or rate limit reached', 429);
  }

  // Return demo response as fallback
  console.log('📋 Using demo response (real AI unavailable)');
  aiRoutingMetrics.fallbackUsed += 1;
  // Apply delay even for demo responses for consistency
  if (AI_RESPONSE_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, AI_RESPONSE_DELAY_MS));
  }
  return {
    text: applyImageInputFallback(enforceResponseSafety(generateDemoResponse(normalizedUserMessage)), options),
    detectedRole
  };
}

export async function generateAIResponse(
  userMessage: string,
  conversationHistory: any[] = [],
  conversationId?: string,
  userProfile?: UserProfile,
  isAuthenticated: boolean = true,
  options: GenerateAIResponseOptions = {}
): Promise<{ text: string; detectedRole: string | null }> {
  return runQueuedAIRequest(() =>
    generateAIResponseCore(
      userMessage,
      conversationHistory,
      conversationId,
      userProfile,
      isAuthenticated,
      options
    )
  );
}

export function getAIQueueMetrics() {
  const distributedEnabled = Boolean(REDIS_URL);
  return {
    inFlight: aiInFlightRequests,
    queued: aiRequestQueue.length,
    maxConcurrent: AI_MAX_CONCURRENT_REQUESTS,
    maxQueued: AI_MAX_QUEUED_REQUESTS,
    waitTimeoutMs: AI_QUEUE_WAIT_TIMEOUT_MS,
    distributedEnabled,
    distributedMaxInFlight: distributedEnabled ? AI_DISTRIBUTED_MAX_INFLIGHT : null,
  };
}

function sanitizePromptControlContent(text: string): string {
  let normalized = String(text || '');

  // Strip user-supplied role/control wrappers that mimic prompt channels.
  normalized = normalized.replace(/\[\s*(system|developer|assistant|instruction|prompt)\s*(note)?\s*:[^\]]{0,400}\]/gi, '');
  normalized = normalized.replace(/<\s*\/?\s*(system|developer|assistant|instruction|prompt)\s*>/gi, '');

  // Remove explicit instruction-override attempts while preserving user intent text.
  normalized = normalized.replace(/^\s*(ignore|disregard)\s+(all|previous)\s+instructions.*$/gim, '');

  return normalized.trim();
}

function enforceResponseSafety(text: string): string {
  const cleaned = postProcessGuardrail(text);
  
  // Check for system prompt leakage
  const leakagePatterns = [
    /you are\s+icio/i,
    /system\s+prompt/i,
    /authenticated\s+user\s+context/i,
    /server\s+trusted\s+interaction\s+hint/i,
    /groq[_\s-]*api[_\s-]*key/i
  ];

  if (leakagePatterns.some((p) => p.test(cleaned))) {
    aiRoutingMetrics.safetyRejections += 1;
    return 'I-check ko muna ito with the OpenCI Team.';
  }

  // HALLUCINATION DETECTOR: Block fake user data
  // Only block if we DON'T have real data context (realUserDataContext would be in prompt)
  const fakeUserDataPatterns = [
    // Common fake Filipino/generic names that AI invents
    /\b(john\s+doe|jane\s+smith|juan\s+dela\s+cruz|maria\s+rodriguez|mark\s+davis|michael\s+tan)\b/i,
    // Fake user list patterns - "list of admins: 1."
    /\b(list\s+of\s+(admins?|fieldm[ae]n|users?|employees?|agents?))\s*[:]\s*\d+\./i,
    // Fake status patterns with invented names
    /\b(inactive\s+since|last\s+seen|last\s+active)\s+\d+\s+(days?|weeks?|months?)\s+ago\b/i,
    // Numbered lists of people with roles (hallucination pattern)
    /\d+\.\s+[A-Z][a-z]+\s+[A-Z][a-z]+\s*[-–]\s*(Admin|Fieldman|Super\s*Admin)/i,
    // "I've compiled/checked" + user lists (the exact pattern from screenshot)
    /i'?ve\s+(compiled|checked|gathered|retrieved)\s+.*(list|admins?|fieldm[ae]n)/i,
    // "Admins:" or "Fieldmen:" followed by numbered list
    /\b(admins?|fieldm[ae]n)\s*[:]\s*\n?\s*1\./i,
    // Fake Filipino names with locations
    /\b(parañaque|paranaque|makati|taguig|pasay|manila|quezon\s*city|caloocan|valenzuela|malabon|las\s*piñas|las\s*pinas|muntinlupa)\b/i,
    // "complete list" patterns
    /complete\s+list\s+of\s+(admins?|fieldm[ae]n|users?)/i,
    // Summaries that mention non-existent users by name
    /\bwe\s+discussed\s+.*\b(angelo\s+principio|ronald\s+airon|fieldman|fieldmen)\b.*\blist\b/i,
  ];

  // Check if response appears to be listing users WITHOUT verified data marker
  const looksLikeUserList = /\d+\.\s+\w+.*[-–]\s*(Admin|Fieldman|Super\s*Admin)/i.test(cleaned);
  const hasVerifiedDataMarker = /\[VERIFIED DATABASE DATA/i.test(cleaned);
  
  if (looksLikeUserList && !hasVerifiedDataMarker) {
    // This is likely hallucinated user data
    aiRoutingMetrics.safetyRejections += 1;
    return 'I-check ko muna ito with the OpenCI Team. Hindi ko po ma-access ang real-time user data directly.';
  }

  if (fakeUserDataPatterns.some((p) => p.test(cleaned))) {
    aiRoutingMetrics.safetyRejections += 1;
    return 'I-check ko muna ito with the OpenCI Team. Hindi ko po ma-access ang real-time user data directly.';
  }

  // OFF-TOPIC DETECTOR: Block restaurant/food/menu responses
  const offTopicPatterns = [
    // Restaurant names
    /\b(jollibee|mcdonalds?|mcdonald's|kfc|chowking|greenwich|andok'?s|baliwag|mang\s+inasal|bonchon|yellow\s+cab|red\s+ribbon|goldilocks|burger\s+king|wendy'?s|subway|starbucks|tim\s+hortons)\b/i,
    // Food menu items
    /\b(chickenjoy|yumburger|champ\s+burger|palabok|spaghetti|sundae|burger\s+steak|adobo\s+rice|breakfast\s+meal|value\s+meal|fries|mcflurry|big\s+mac|whopper)\b/i,
    // Mall names
    /\b(sm\s+(city|supermall|mall|megamall)|robinsons?\s+(place|mall|galleria)|ayala\s+(mall|center)|glorietta|greenbelt|trinoma|gateway|market\s+market|festival\s+mall)\b/i,
    // Restaurant list patterns
    /here\s+are\s+(some|the)\s+restaurants?\b/i,
    /restaurants?\s+near\s+(the|that)\s+(meeting|location|landmark)/i,
    /list\s+of\s+(menu|food|restaurants?)/i,
    // Color/brand questions
    /\b(color|kulay)\s+of\s+(jollibee|mcdonalds?|kfc)\b/i,
    /\b(red\s+and\s+yellow|yellow\s+and\s+red)\b.*\bjollibee\b/i,
    /\bjollibee\b.*\b(red\s+and\s+yellow|yellow\s+and\s+red)\b/i,
    // Summarize patterns with off-topic content
    /\b(summar|discussed|previous\s+conversation)\b.*\b(jollibee|menu|restaurant|chickenjoy|color\s+of)\b/i,
    /\b(jollibee|menu|restaurant|chickenjoy)\b.*\b(summar|discussed|previous\s+conversation)\b/i,
  ];

  if (offTopicPatterns.some((p) => p.test(cleaned))) {
    aiRoutingMetrics.safetyRejections += 1;
    return 'Sorry, I can only help with OpenCI-related questions. Ano po ang concern mo sa OpenCI?';
  }

  return cleaned;
}

/**
 * Post-processing guardrail: cleans AI output to enforce formatting rules.
 * - Strips markdown (**, *, `, ```, #, etc.)
 * - Removes code blocks
 * - Trims excessive whitespace
 */
function postProcessGuardrail(text: string): string {
  let cleaned = text;

  // Remove code blocks (```...```)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');

  // Remove inline code (`...`)
  cleaned = cleaned.replace(/`([^`]*)`/g, '$1');

  // Remove bold/italic markers (**, *, __, _)
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');

  // Remove markdown headers (# ## ### etc.)
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // Remove markdown bullet points (- or *)
  cleaned = cleaned.replace(/^[\s]*[-*]\s+/gm, '');

  // Collapse multiple newlines into max 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

export async function extractProblemTitle(conversationHistory: any[]): Promise<string | null> {
  if (!apiKey || !availableModel || isProviderCircuitOpen('groq')) return null;
  try {
    const recentMessages = conversationHistory.slice(-8);
    const msgs = [
      {
        role: 'system',
        content: 'You are a concise assistant. Given the conversation below, if the user has clearly stated a specific problem, issue, or request, respond with only a short descriptive title (max 50 characters). If no clear problem is stated yet, respond with exactly: NONE'
      },
      ...recentMessages.map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content).substring(0, 500)
      }))
    ];
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: availableModel, messages: msgs, max_tokens: 60, temperature: 0.2 },
      { timeout: 10000, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } }
    );
    const title = response.data?.choices?.[0]?.message?.content?.trim();
    if (!title || title.toUpperCase() === 'NONE') return null;
    return title.length > 60 ? title.substring(0, 57) + '...' : title;
  } catch (error: any) {
    if (isProviderLimitError(error)) {
      recordProviderFailure('groq', true);
    } else {
      recordProviderFailure('groq');
    }
    return null;
  }
}

export async function testConnection(): Promise<boolean> {
  if (!apiKey) {
    console.error('❌ GROQ_API_KEY not configured');
    return false;
  }

  console.log('🔍 Testing Groq AI connection with your API key...');

  // Discover available models first
  availableModel = await discoverAvailableModels();

  if (availableModel) {
    try {
      console.log(`   Testing with model: ${availableModel}...`);
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: availableModel,
          messages: [{ role: 'user', content: 'Say hello!' }],
          max_tokens: 10
        },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          }
        }
      );

      if (response.data?.choices?.length > 0) {
        groqConnected = true;
        console.log(`✅ Groq AI Connected successfully with ${availableModel}!`);
        return true;
      }
    } catch (error: any) {
      const statusCode = error?.response?.status;
      const statusText = error?.response?.statusText;
      const errorData = error?.response?.data;
      if (isProviderLimitError(error)) {
        recordProviderFailure('groq', true);
      } else {
        recordProviderFailure('groq');
      }
      console.log(`   ❌ API Error: ${statusCode} ${statusText || ''}`);
      if (errorData) {
        console.log(`      Message: ${JSON.stringify(errorData).substring(0, 150)}`);
      }
    }
  }

  console.error('❌ Could not connect to Groq AI with provided API key');
  console.error('   Possible solutions:');
  console.error('   1. Verify API key is correct at https://console.groq.com');
  console.error('   2. Check Groq API rate limits or quota');
  console.error('   3. Ensure the key starts with gsk_');
  groqConnected = false;
  return false;
}

export function isGoogleAIConnected(): boolean {
  return groqConnected;
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTION B: Vector Store Initialization
// ═══════════════════════════════════════════════════════════════════════════
export async function initializeVectorStore(pool: Pool): Promise<void> {
  try {
    vectorStore = new VectorStore(pool);
    await vectorStore.initialize();

    const stats = await vectorStore.getStats();
    console.log(`✓ Vector Store initialized. Total documents: ${stats.total}`);
  } catch (error) {
    console.error('Error initializing vector store:', error instanceof Error ? error.message : 'Unknown error');
    vectorStore = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTION C: OpenCI API Initialization
// ═══════════════════════════════════════════════════════════════════════════
export async function initializeOpenCIAPI(): Promise<void> {
  try {
    openCIAPI = new OpenCIAPI();
    const isConnected = await openCIAPI.authenticate();

    if (isConnected) {
      console.log('✓ OpenCI API initialized and authenticated');
    } else {
      console.log('⚠ OpenCI API initialized in template mode (API key may be missing)');
    }
  } catch (error) {
    console.error('Error initializing OpenCI API:', error instanceof Error ? error.message : 'Unknown error');
    openCIAPI = null;
  }
}

// Get vector store instance
export function getVectorStore(): VectorStore | null {
  return vectorStore;
}

// Get OpenCI API instance
export function getOpenCIAPI(): OpenCIAPI | null {
  return openCIAPI;
}

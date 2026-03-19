import dotenv from 'dotenv';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { OPENCI_SYSTEM_PROMPT, OPENCI_ANONYMOUS_KB, OPENCI_AUTHENTICATED_KB, extractMainConcern } from './openci-kb';
import { VectorStore } from './vector-store';
import { OpenCIAPI } from './openci-api';
import { runQuery, executeQuery } from './database';
import { Pool } from 'pg';

dotenv.config();

const apiKey = process.env.GROQ_API_KEY;
const googleAIKey = process.env.GOOGLE_AI_API_KEY;
const AI_RESPONSE_DELAY_MS = parseInt(process.env.AI_RESPONSE_DELAY_MS || '3000', 10);
const GOOGLE_VISION_MODEL = process.env.GOOGLE_VISION_MODEL || 'gemini-1.5-flash';
let groqConnected = false;
let availableModel = '';
const googleAIClient = googleAIKey ? new GoogleGenerativeAI(googleAIKey) : null;

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
    'Hi there! How can I help you today?',
    'Hello! What can I assist you with?',
    'Hey! What\'s on your mind?'
  ],
  help: [
    'I\'m here to help! You can ask me questions about OpenCI, troubleshoot issues, or just chat. What would you like to know?',
    'I can assist with OpenCI modules, technical support, or general questions. What do you need help with?'
  ],
  default: [
    'That\'s interesting! Tell me more about what you\'re working on.',
    'I understand. How can I help you with that?',
    'Got it. What else would you like to know?',
    'Thanks for sharing. Is there anything specific I can help with?'
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
// ROLE DETECTION & UPDATE HELPER
// ══════════════════════════════════════════════════════════════

async function detectAndUpdateUserRole(userMessage: string, conversationId?: string): Promise<string | null> {
  if (!conversationId) return null;

  try {
    // Get the conversation to find user_id
    const conversations = await runQuery<any>(
      `SELECT user_id FROM conversations WHERE id = ?`,
      [conversationId]
    );

    if (!conversations || conversations.length === 0) return null;

    const userId = conversations[0].user_id;
    if (!userId) return null;

    // Detect role from user message
    const message = userMessage.toLowerCase();
    let detectedRole: string | null = null;

    // Check for role keywords (case-insensitive, handles variations)
    if (/\bfieldman\b|\bfield man\b|\bfield agent\b|\bfa\b/.test(message)) {
      detectedRole = 'fieldman';
    } else if (/\badmin\b|\badministrator\b/.test(message)) {
      detectedRole = 'admin';
    }

    // Update user role if detected
    if (detectedRole) {
      await executeQuery(
        `UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [detectedRole, userId]
      );
      console.log(`✓ User role updated to: ${detectedRole}`);
    }

    return detectedRole;
  } catch (error) {
    console.error('Role detection error (non-critical):', error instanceof Error ? error.message.substring(0, 50) : 'unknown');
    // Don't throw - this is a non-critical operation
    return null;
  }
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

export async function generateAIResponse(
  userMessage: string,
  conversationHistory: any[] = [],
  conversationId?: string,
  userProfile?: UserProfile,
  isAuthenticated: boolean = true,
  options: GenerateAIResponseOptions = {}
): Promise<{ text: string; detectedRole: string | null }> {
  // Detect and update user role if provided in message
  const detectedRole = await detectAndUpdateUserRole(userMessage, conversationId);

  const normalizedUserMessage = sanitizePromptControlContent(userMessage);

  // Option B: Use vector store for semantic search if available
  // Anonymous users only get 'public' access-level documents
  let contextFromVectorStore = '';
  if (vectorStore && conversationId) {
    try {
      // Add embedding for this message
      await vectorStore.addConversationEmbedding(conversationId, normalizedUserMessage);

      // Search for similar knowledge documents (filtered by access level)
      const accessLevel = isAuthenticated ? undefined : 'public';
      const searchResults = await vectorStore.search(normalizedUserMessage, 3, 0.5, accessLevel);
      if (searchResults.length > 0) {
        contextFromVectorStore = '\n\nRelevant Knowledge Base:\n' +
          searchResults.map(r => `- [${r.type}] ${r.content.substring(0, 200)}`).join('\n');
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

  // Detect user concern from message
  const mainConcern = extractMainConcern(normalizedUserMessage);

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
DETECTED CONCERN: ${mainConcern}
${contextFromVectorStore}
${contextFromAPI}

User Profile Context: ${JSON.stringify(conversationHistory[0]?.context || {})}`;

  // Format messages for Groq (OpenAI-compatible format)
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt }
  ];

  for (const m of conversationHistory) {
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

  if (imageInputs.length > 0 && googleAIClient) {
    try {
      const visionModel = googleAIClient.getGenerativeModel({ model: GOOGLE_VISION_MODEL });
      const historySummary = conversationHistory
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
        const cleanedText = applyImageInputFallback(enforceResponseSafety(visionText), options);
        if (AI_RESPONSE_DELAY_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, AI_RESPONSE_DELAY_MS));
        }
        return { text: cleanedText, detectedRole };
      }
    } catch (error: any) {
      console.log(`❌ ${GOOGLE_VISION_MODEL} image processing failed:`, error?.message || error);
    }
  }

  if (availableModel && apiKey) {
    try {
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
        const cleanedText = applyImageInputFallback(enforceResponseSafety(text), options);
        // Apply artificial delay so AI appears to "think" more thoroughly
        if (AI_RESPONSE_DELAY_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, AI_RESPONSE_DELAY_MS));
        }
        return { text: cleanedText, detectedRole };
      }
    } catch (error: any) {
      console.log(`❌ ${availableModel} failed:`, error?.response?.data || error.message);
    }
  }

  // Return demo response as fallback
  console.log('📋 Using demo response (real AI unavailable)');
  // Apply delay even for demo responses for consistency
  if (AI_RESPONSE_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, AI_RESPONSE_DELAY_MS));
  }
  return {
    text: applyImageInputFallback(enforceResponseSafety(generateDemoResponse(normalizedUserMessage)), options),
    detectedRole
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
  const leakagePatterns = [
    /you are\s+icio/i,
    /system\s+prompt/i,
    /authenticated\s+user\s+context/i,
    /server\s+trusted\s+interaction\s+hint/i,
    /groq[_\s-]*api[_\s-]*key/i
  ];

  if (leakagePatterns.some((p) => p.test(cleaned))) {
    return 'I-check ko muna ito with the OpenCI Team.';
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
  if (!apiKey || !availableModel) return null;
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
  } catch {
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

# OpenCI ChatBot v2.0 - Quick Start Guide

## What's New (v2.0)

Your ChatAI ChatBot has been upgraded to **Icio v2.0** with three powerful features:

1. **Option A: Enhanced System Prompt** 
   - Wider OpenCI knowledge base
   - Better conversation flow
   - Smarter concern detection
   
2. **Option B: Vector Database (pgvector)**
   - Semantic search over OpenCI docs
   - Intelligent context retrieval
   - Conversation similarity matching

3. **Option C: OpenCI API Integration**
   - Real-time platform data
   - Field agent tracking
   - Demand letter status updates

---

## Installation & Setup

### 1. Install Dependencies (if needed)
```bash
npm install
```

### 2. Configure Environment
Create/update `.env`:
```env
# Essential
GOOGLE_AI_API_KEY=your_key_here
NODE_ENV=development
PORT=3000

# For Vector Database (Option B)
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=chatai_db
DB_PORT=5432

# For OpenCI API (Option C) - Optional
OPENCI_API_URL=https://api.openci.spmadrid.com
OPENCI_API_KEY=your_key_here
```

### 3. Setup PostgreSQL with pgvector (for Option B)

**Linux/macOS:**
```bash
# Install PostgreSQL
brew install postgresql  # macOS
# or use your system's package manager

# Enable pgvector
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

**Windows:**
```bash
# Install PostgreSQL from https://www.postgresql.org/download/windows/
# Then enable pgvector:
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 4. Build & Run
```bash
# Development
npm run dev

# Production
npm run build
npm start
```

---

## Testing the v2.0 Features

### Test Option A (System Prompt)
```bash
curl -X POST http://localhost:3000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Conversation"}'

# Try a message
curl -X POST http://localhost:3000/api/conversations/{conversationId}/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Hi, I can'\''t log into Lark"}'
```

### Test Option B (Vector Store)
```typescript
// In your code
const vectorStore = getVectorStore();
if (vectorStore) {
  const results = await vectorStore.search("DL workflow status");
  console.log("Found relevant docs:", results.length);
}
```

### Test Option C (OpenCI API)
```typescript
// In your code
const api = getOpenCIAPI();
if (api && api.isConnected()) {
  const status = await api.getSystemStatus();
  console.log("System status:", status);
}
```

---

## Files Overview

```
src/
├── openci-kb.ts           # Option A: Enhanced knowledge base
├── vector-store.ts        # Option B: pgvector service
├── openci-api.ts          # Option C: API integration
├── ai-service.ts          # Updated with all 3 options
├── index.ts               # Updated initialization
├── routes.ts              # Updated with conversationId
└── database.ts            # Updated with getPool()

OPENCI_V2_IMPLEMENTATION.md  # Detailed documentation
```

---

## Conversation Flow

```
User: "I can't update my app"
  ↓
Option A: System prompt recognizes "App Update Issue"
  ↓
Option B: Vector store searches for "update install" docs
  ↓
Option C: API checks if Play Store is online
  ↓
Combined Response: "Try uninstalling and reinstalling from Play Store..."
```

---

## Startup Output

When your server starts, you should see:
```
✅ Database initialized successfully
✅ Google Generative AI connected successfully
✓ pgvector extension enabled
✓ Vector store initialized. Total documents: X
✓ OpenCI API initialized and authenticated

🚀 Server is running at http://localhost:3000
✨ Version: OpenCI ChatBot v2.0 (Icio) with enhanced capabilities
```

If you see warnings like:
```
⚠ Vector Store: PostgreSQL not available (in-memory mode)
⚠ OpenCI API initialized in template mode (API key may be missing)
```

These are fine! The system gracefully degrades:
- Works with just Option A (system prompt)
- Vector store will use in-memory fallback
- API works in template mode showing structure

---

## Common Questions

**Q: Do I need all three options?**
A: No! Option A (system prompt) works standalone. Options B & C are enhancements.

**Q: Can I use without PostgreSQL?**
A: Yes! Option B will skip, but Options A & C continue working.

**Q: Do I need OpenCI API key?**
A: No! The API will work in template mode showing what it would return with a real key.

**Q: How do I populate the vector store?**
A: Load documents programmatically:
```typescript
import { getVectorStore } from './src/ai-service';
const vectorStore = getVectorStore();
if (vectorStore) {
  await vectorStore.addDocument({
    id: 'doc1',
    content: 'DL workflow...',
    type: 'workflow',
    source: 'openci_docs'
  });
}
```

**Q: What if a service fails?**
A: The system continues working! It gracefully handles failures in any component.

---

## Performance Tips

1. **Vector Search:** Slower on first query (builds index), faster on subsequent queries
2. **API Calls:** Cache responses when possible, use pagination
3. **Conversation History:** Trim old messages to keep context focused

---

## Next Steps

1. ✅ Code is ready - just configure `.env`
2. Start the server: `npm run dev`
3. Test with a few conversations
4. Load your OpenCI documentation into vector store
5. Obtain OpenCI API credentials (optional but recommended)
6. Monitor logs for any issues

---

## Support

- Check `OPENCI_V2_IMPLEMENTATION.md` for detailed documentation
- Review error messages in console output
- Verify all `.env` variables are set correctly

---

**Happy chatting! 🚀**

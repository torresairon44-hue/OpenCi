# Demo API Testing Guide - OpenCI ChatBot v2.0

## Overview

Demo endpoints have been added to test all three v2.0 features without needing the frontend. These endpoints showcase:

- **Option A** - Concern detection & knowledge base
- **Option B** - Vector store semantic search  
- **Option C** - OpenCI API integration

---

## Getting Started

### 1. Start the Server
```bash
npm run dev
```

You should see:
```
✅ Database initialized successfully
✅ Google Generative AI connected successfully
✓ Vector store initialized with 13 documents
✓ OpenCI API initialized and authenticated

🚀 Server is running at http://localhost:3000
✨ Version: OpenCI ChatBot v2.0 (Icio) with enhanced capabilities
```

### 2. Test Demo Endpoints

All endpoints start with `/api/demo/`

---

## Demo Endpoints

### 1. Health Check
**Endpoint:** `GET /api/demo/health`

Check if all services are operational.

**Example:**
```bash
curl http://localhost:3000/api/demo/health
```

**Response:**
```json
{
  "healthy": true,
  "timestamp": "2026-03-06T10:30:00Z",
  "services": {
    "vectorStore": {
      "status": "ok",
      "message": "13 documents loaded"
    },
    "openCIAPI": {
      "status": "ok",
      "message": "Template mode (no API key)"
    }
  }
}
```

---

### 2. Test Concern Detection (Option A)
**Endpoint:** `POST /api/demo/test-concern-detection`

Test the intelligent concern detection system (12 categories).

**Example:**
```bash
curl -X POST http://localhost:3000/api/demo/test-concern-detection \
  -H "Content-Type: application/json" \
  -d '{"message": "I can'\''t update my app from Play Store"}'
```

**Test Cases:**
```bash
# Update issue
curl -X POST http://localhost:3000/api/demo/test-concern-detection \
  -H "Content-Type: application/json" \
  -d '{"message": "Update button missing"}'

# Lark access
curl -X POST http://localhost:3000/api/demo/test-concern-detection \
  -H "Content-Type: application/json" \
  -d '{"message": "Can'\''t login to Lark"}'

# DL workflow
curl -X POST http://localhost:3000/api/demo/test-concern-detection \
  -H "Content-Type: application/json" \
  -d '{"message": "What'\''s the DL status flow?"}'

# GPS issue
curl -X POST http://localhost:3000/api/demo/test-concern-detection \
  -H "Content-Type: application/json" \
  -d '{"message": "GPS not working on my phone"}'
```

**Expected Detections:**
- "update install" → App Update Issue
- "lark login" → Lark Access Issue  
- "dl demand" → Demand Letter Workflow
- "gps location" → GPS/Map Concern
- (12 categories total)

---

### 3. Knowledge Base Lookup (Option A)
**Endpoint:** `POST /api/demo/knowledge-lookup`

Search the static knowledge base for banks, modules, formats, etc.

**Examples:**
```bash
# Search for modules
curl -X POST http://localhost:3000/api/demo/knowledge-lookup \
  -H "Content-Type: application/json" \
  -d '{"query": "demand letter"}'

# Search for banks
curl -X POST http://localhost:3000/api/demo/knowledge-lookup \
  -H "Content-Type: application/json" \
  -d '{"query": "BDO"}'

# Search for formats
curl -X POST http://localhost:3000/api/demo/knowledge-lookup \
  -H "Content-Type: application/json" \
  -d '{"query": "PDF"}'

# Search for hours
curl -X POST http://localhost:3000/api/demo/knowledge-lookup \
  -H "Content-Type: application/json" \
  -d '{"query": "8 AM"}'
```

**Available Data:**
- 6 modules: CI, DL, SC, Tele-CI, Form Builder, Workforce Management
- 22 banks: TFS, BDO, BPI, CSB, HSBC, HOME CREDIT, etc.
- 11 file formats: PDF, JPEG, PNG, XLSX, DOCX, etc.
- Standard hours: 8 AM - 5 PM

---

### 4. Vector Search (Option B)
**Endpoint:** `POST /api/demo/vector-search`

Search 13 sample documents using semantic similarity.

**Examples:**
```bash
# Search for Lark troubleshooting
curl -X POST http://localhost:3000/api/demo/vector-search \
  -H "Content-Type: application/json" \
  -d '{"query": "Lark password reset login"}'

# Search for DL workflow
curl -X POST http://localhost:3000/api/demo/vector-search \
  -H "Content-Type: application/json" \
  -d '{"query": "demand letter generation status flow"}'

# Search for GPS issues
curl -X POST http://localhost:3000/api/demo/vector-search \
  -H "Content-Type: application/json" \
  -d '{"query": "GPS location not updating"}'

# Search with custom threshold (0-1, default 0.5)
curl -X POST http://localhost:3000/api/demo/vector-search \
  -H "Content-Type: application/json" \
  -d '{"query": "field agent activity", "threshold": 0.3, "limit": 5}'
```

**Response:**
```json
{
  "success": true,
  "query": "demand letter workflow",
  "results_found": 3,
  "results": [
    {
      "id": "module-dl",
      "type": "module",
      "source": "openci_modules",
      "similarity_score": "92.5%",
      "preview": "Demand Letter (DL) Module..."
    }
  ]
}
```

**Sample Documents Included:**
- 5 module docs (CI, DL, SC, Workforce, Forms)
- 5 troubleshooting guides (Lark, GPS, App Update, Forms)
- 2 procedures (DL Generation, Field Check-in)
- 1 FAQ about banks
- Total: ~8,000 words

---

### 5. Vector Store Stats (Option B)
**Endpoint:** `GET /api/demo/vector-stats`

Get statistics about the vector store.

**Example:**
```bash
curl http://localhost:3000/api/demo/vector-stats
```

**Response:**
```json
{
  "available": true,
  "total_documents": 13,
  "by_type": [
    {"type": "module", "count": 5},
    {"type": "troubleshooting", "count": 5},
    {"type": "procedure", "count": 2},
    {"type": "faq", "count": 1}
  ],
  "indexing": {
    "type": "IVFFlat",
    "dimensions": 384,
    "model": "Google embedding-001"
  }
}
```

---

### 6. OpenCI API Status (Option C)
**Endpoint:** `GET /api/demo/api-status`

Check OpenCI API connection and available methods.

**Example:**
```bash
curl http://localhost:3000/api/demo/api-status
```

**Response (with API key):**
```json
{
  "success": true,
  "initialized": true,
  "connected": true,
  "mode": "authenticated",
  "configuration": {
    "baseURL": "https://api.openci.spmadrid.com",
    "timeout": 10000
  },
  "available_methods": {
    "authentication": ["authenticate()"],
    "system": ["getSystemStatus()"],
    "agents": ["getAgentActivities()", "..."],
    "demand_letters": ["getDemandLetterStatus()", "..."],
    "clients": ["searchClients()", "..."],
    "forms": ["getAvailableForms()", "..."]
  }
}
```

**Response (without API key - template mode):**
```json
{
  "success": true,
  "initialized": true,
  "connected": false,
  "mode": "template",
  "configuration": {
    "baseURL": "https://api.openci.spmadrid.com",
    "timeout": 10000
  },
  "available_methods": { ... }
}
```

---

### 7. API Method Call (Option C)
**Endpoint:** `POST /api/demo/api-call`

Call OpenCI API methods (template mode shows structure).

**Examples:**
```bash
# Get system status
curl -X POST http://localhost:3000/api/demo/api-call \
  -H "Content-Type: application/json" \
  -d '{"method": "getSystemStatus"}'

# Get agent activities
curl -X POST http://localhost:3000/api/demo/api-call \
  -H "Content-Type: application/json" \
  -d '{"method": "getAgentActivities", "params": {"agentId": "agent-001"}}'

# Search clients
curl -X POST http://localhost:3000/api/demo/api-call \
  -H "Content-Type: application/json" \
  -d '{"method": "searchClients", "params": {"query": "Juan", "bank": "BDO"}}'

# Get demand letter status
curl -X POST http://localhost:3000/api/demo/api-call \
  -H "Content-Type: application/json" \
  -d '{"method": "getDemandLetterStatus", "params": {"dlId": "DL-2026-001"}}'

# Get forms for module
curl -X POST http://localhost:3000/api/demo/api-call \
  -H "Content-Type: application/json" \
  -d '{"method": "getAvailableForms", "params": {"moduleCode": "DL"}}'
```

**Available Methods:**
- `getSystemStatus()` - System overview
- `getAgentActivities(agentId, limit?)` - Agent history
- `getDemandLetterStatus(dlId)` - DL workflow status
- `searchClients(query, bank?)` - Search clients
- `getAvailableForms(moduleCode)` - Module forms

---

### 8. Full Context Gathering (All Options)
**Endpoint:** `POST /api/demo/full-context`

See how all three options work together to gather context for a message.

**Example:**
```bash
curl -X POST http://localhost:3000/api/demo/full-context \
  -H "Content-Type: application/json" \
  -d '{"message": "Can'\''t login to Lark"}'
```

**Response:**
```json
{
  "success": true,
  "user_message": "Can't login to Lark",
  "context_gathered": {
    "option_a_concern_detection": "Lark Access Issue",
    "option_b_vector_search": {
      "enabled": true,
      "results_found": 2,
      "results": [
        {
          "type": "troubleshooting",
          "similarity": "89.3%",
          "preview": "Lark Access Issues - Troubleshooting Guide..."
        }
      ]
    },
    "option_c_api_context": {
      "enabled": true,
      "connected": false,
      "data": null
    }
  },
  "message_ready_for_ai": "Yes - all context prepared",
  "total_context_size": "1234 bytes"
}
```

---

### 9. Run All Tests (Option B)
**Endpoint:** `GET /api/demo/test-all`

Run all feature tests and see results in server logs.

**Example:**
```bash
curl http://localhost:3000/api/demo/test-all
```

**Check server console for test results:**
```
🧪 Running v2.0 Feature Tests...

Test 1: Concern Detection (Option A)
  "Can't log into Lark" → Lark Access Issue
  ...

Test 2: Vector Store Search (Option B)
  "password reset lark" → Found 2 documents
  ...

Test 3: OpenCI API Methods (Option C)
  API Status: ✅ Connected
  ...

✅ Feature tests complete!
```

---

### 10. System Configuration
**Endpoint:** `GET /api/demo/config`

Get overall system configuration and all available endpoints.

**Example:**
```bash
curl http://localhost:3000/api/demo/config
```

**Response:**
```json
{
  "success": true,
  "system_configuration": {
    "hasVectorStore": true,
    "hasOpenCIAPI": true,
    "sampleDocumentsAvailable": 13,
    "environment": "development"
  },
  "v2_features": {
    "option_a": "Enhanced System Prompt",
    "option_b": "Vector Database (pgvector)",
    "option_c": "OpenCI API Integration"
  },
  "endpoints": {
    "health": "GET /demo/health",
    "concern_detection": "POST /demo/test-concern-detection",
    ...
  }
}
```

---

## Testing Workflow

### Complete Flow Test
1. Check health: `GET /demo/health`
2. Test concern detection: `POST /demo/test-concern-detection`
3. Search knowledge base: `POST /demo/knowledge-lookup`  
4. Search vectors: `POST /demo/vector-search`
5. Check API status: `GET /demo/api-status`
6. Test API call: `POST /demo/api-call`
7. Full context: `POST /demo/full-context`

### Quick Test Script
```bash
#!/bin/bash

echo "Testing OpenCI ChatBot v2.0 Demo Endpoints..."

echo -e "\n1. Health Check"
curl -s http://localhost:3000/api/demo/health | jq .

echo -e "\n2. Concern Detection"
curl -s -X POST http://localhost:3000/api/demo/test-concern-detection \
  -H "Content-Type: application/json" \
  -d '{"message": "Can'\''t login to Lark"}' | jq .

echo -e "\n3. Vector Search"
curl -s -X POST http://localhost:3000/api/demo/vector-search \
  -H "Content-Type: application/json" \
  -d '{"query": "Lark password reset"}' | jq .

echo -e "\n4. API Status"
curl -s http://localhost:3000/api/demo/api-status | jq .

echo -e "\nDemo testing complete!"
```

---

## Troubleshooting

**Q: Vector search returns 0 results**
- Check: `GET /demo/vector-stats` - should show 13 documents
- Verify: pgvector extension is enabled
- Try: Lower the threshold value (default 0.5)

**Q: API call returns "not available"**  
- Add OPENCI_API_KEY to .env
- Or accept template mode for development

**Q: Concern detection not matching**
- Try: Different keywords
- Check: 12 available categories in response

**Q: Server won't start**
- Verify: PostgreSQL is running
- Check: Environment variables in .env
- Review: Server logs for errors

---

## Performance Tips

- Vector search faster on subsequent queries (index warmup)
- Limit results: Use `limit` parameter (default 5)
- Adjust threshold: Lower = more results, higher = more precise
- Use `jq` for pretty JSON output in terminal

---

## Next Steps

1. ✅ Demo endpoints working
2. Test actual chat endpoint: `POST /api/conversations/{id}/messages`
3. Monitor context injection in real conversations
4. Load more documents into vector store
5. Obtain OpenCI API credentials for production

---

**Happy testing! 🚀**

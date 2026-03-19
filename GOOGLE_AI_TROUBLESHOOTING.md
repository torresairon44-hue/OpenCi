# Troubleshooting Google AI Integration

## 🔴 Diagnostic Results

**All models failed:** This indicates a connectivity or authentication issue, not a model availability issue.

## 🔧 Quick Fixes to Try

### 1. **Network Connectivity**
```powershell
# Test internet connection
ping google.com

# Test API endpoint access
curl -i "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY" 
```

### 2. **Verify API Key Permissions**
1. Go to: https://console.cloud.google.com/
2. Select your project
3. Navigate to "APIs & Services" > "Credentials"
4. Check your API key details:
   - Is it a **Browser key** or **Restricted key**?
   - Which APIs are restricted to?
   - Is the Generative Language API included?

### 3. **Enable Required API**
1. Go to: https://console.cloud.google.com/apis/library
2. Search for "Generative Language API"
3. Click on it
4. Click "Enable" (if not already enabled)
5. Wait 1-2 minutes for changes to propagate

### 4. **API Key Restrictions**
If your API key has restrictions:
- Check if it's restricted to certain IPs
- Make sure it's not restricted by referrer
- Ensure "Generative Language API" is in the allowed list

### 5. **Create a New API Key**
If the current one still doesn't work:
1. Go to: https://aistudio.google.com/
2. Click "Get API key"
3. Click "Create API key in new project"
4. Copy the new key
5. Update `.env` with the new key
6. Restart the server

## 📋 Full Checklist

- [ ] Can ping google.com (network works)
- [ ] API key is valid and copied correctly
- [ ] Generative Language API is enabled in Google Cloud
- [ ] API key is not restricted (or properly configured)
- [ ] No IP restrictions on the API key
- [ ] You're using HTTPS (not HTTP)
- [ ] API key has been used before successfully
- [ ] Google Cloud Console shows active billing
- [ ] Waited 1-2 minutes after enabling API

## 🆘 Advanced Debugging

### Check API Response Directly
```bash
$headers = @{
    "Content-Type" = "application/json"
}

$body = @{
    "contents" = @(
        @{
            "parts" = @(
                @{
                    "text" = "Hello"
                }
            )
        }
    )
} | ConvertTo-Json

Invoke-WebRequest `
    -Uri "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=YOUR_API_KEY" `
    -Method POST `
    -Headers $headers `
    -Body $body
```

### Check API Key Status
```bash
curl "https://generativelanguage.googleapis.com/v1/models?key=YOUR_API_KEY"
```

Expected response should list available models.

## 💡 For Now: Use Fallback Mode

**The chatbot is fully functional in fallback mode!** It will:
- ✅ Create conversations
- ✅ Store messages in database
- ✅ Show conversation history
- ✅ Display demo AI responses
- ⚠️ Won't use real Google AI

Users won't notice the difference until you configure the real API.

## 🟢 Verify Current Status

The server should show:
```
✅ Database initialized successfully
ℹ️  Running in fallback mode - using demo responses
🚀 Server is running at http://localhost:3000
💡 To enable real AI, add your Google AI API key to .env
```

## 🔄 When Real AI is Configured

Once Google AI is working, you'll see:
```
✅ Database initialized successfully
✅ Google Generative AI connected successfully
🚀 Server is running at http://localhost:3000
```

## ✉️ Support Resources

- **Google AI Documentation:** https://ai.google.dev/
- **Issues & Support:** https://github.com/google/generative-ai-js/issues
- **Status Page:** https://status.cloud.google.com/

---

**Note:** The fallback mode is actually a great feature - you can fully test and demo the chatbot without real AI, then enable it later when ready!

# Google Generative AI Configuration Guide

## ⚠️ Current Status
The chatbot is running in **fallback mode** with demo responses because the Google AI connection couldn't access the specified model.

## 🔧 Setup Steps

### Step 1: Verify Your API Key
Your current API key in `.env`:
```
GOOGLE_AI_API_KEY=AIzaSyAiZLekNjrhfcFA5K6GoJEIuSo2kyuVwPA
```

### Step 2: Check Available Models
The error indicates the model might not be available. Try these steps:

1. **Visit Google AI Studio:**
   - Go to https://aistudio.google.com/
   - Sign in with your Google account
   - Create a new API key if needed

2. **Test Your API Key:**
   ```bash
   curl -X POST https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=YOUR_API_KEY \
     -H "Content-Type: application/json" \
     -d '{"contents": [{"parts": [{"text": "Hello"}]}]}'
   ```

### Step 3: Common Issues & Solutions

#### Issue: "Model not found" error
**Solution:** The API key might not have access to these models. Try:
- Check Google Cloud Console
- Verify billing is enabled
- Request access to Gemini models
- Use Text Bison (text-bison-001) instead

#### Issue: 403 Forbidden error
**Solution:** 
- Check API key authentication
- Verify the API key hasn't been revoked
- Enable the Generative Language API in Google Cloud Console

#### Issue: Rate limiting
**Solution:**
- Implement request throttling
- Check API quotas in Google Cloud Console

### Step 4: Update Model Name

If you identify the correct model available for your API key, update `src/ai-service.ts`:

```typescript
// Line ~43: Change this:
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

// To your available model:
const model = genAI.getGenerativeModel({ model: 'text-bison-001' });
// OR
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
```

### Step 5: Test the Connection

After updating:
```bash
npm run build
npm run dev
```

Watch the console for:
- ✅ `✅ Google Generative AI connected successfully` - Working!
- ⚠️  `ℹ️  Running in fallback mode` - Check model name/API key

## 🚀 Alternative: Get Free Credits

1. Go to https://makersuite.google.com/
2. Sign up for Generative AI Studio
3. Create an API key
4. Get free monthly API access
5. Update `.env` with your new API key

## 📚 Supported Models

### Current Stable Models:
- `gemini-1.5-pro` - Most capable
- `gemini-1.5-flash` - Fast and efficient
- `gemini-pro` - General purpose (may not be available)
- `text-bison-001` - Legacy text model

### Check Available Models:
```bash
curl -H "x-goog-api-key: YOUR_API_KEY" \
  https://generativelanguage.googleapis.com/v1beta1/models
```

## 🔐 Protect Your API Key

**Never commit .env to git!** Your `.gitignore` is already configured:
```
.env
```

## 📝 Full Configuration Checklist

- [ ] Have valid Google API key
- [ ] API key has Generative Language API enabled
- [ ] Billing account is active
- [ ] Correct model name for your API tier
- [ ] `.env` file updated with API key
- [ ] Rebuilt project: `npm run build`
- [ ] Server restart: `npm run dev`
- [ ] Check console for success message

## 🆘 Still Having Issues?

1. **Check API Key Status:**
   - Go to Google Cloud Console
   - Verify API is enabled
   - Check quotas and billing

2. **Test API Directly:**
   - Use the curl commands above
   - Check response status code
   - Review error message details

3. **Try Different Model:**
   - Update `src/ai-service.ts` with alternative model
   - Rebuild and test
   - Check console output

## 📖 Useful Resources

- Google Generative AI Documentation: https://ai.google.dev/
- API Reference: https://ai.google.dev/api/rest/v1beta/models
- Model Documentation: https://ai.google.dev/models
- Status Page: https://status.cloud.google.com/

## 💡 Pro Tips

1. Start with `gemini-1.5-flash` for faster responses
2. Use `gemini-1.5-pro` for complex queries
3. Monitor API usage in Google Cloud Console
4. Set up billing alerts
5. Implement rate limiting in production

---

**Note:** The application works perfectly in fallback mode while you configure the real AI. Users can still have full conversations!

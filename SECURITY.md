# Security Implementation Guide

## Overview
This document outlines all security features implemented in the OpenCI chatbot application to prevent injection attacks, XSS vulnerabilities, and other common security issues.

---

## 🔒 Security Features Implemented

### 1. **Input Validation & Sanitization**

#### Backend (Express Routes)
- **Message Content Validation**
  - Length validation: 1-5000 characters
  - Required field validation
  - Trim whitespace automatically
  - Example:
    ```typescript
    body('content')
      .notEmpty().withMessage('Message content is required')
      .trim()
      .isLength({ min: 1, max: 5000 })
    ```

- **UUID Validation**
  - All conversation IDs validated as UUIDs
  - Prevents manipulation of conversation parameters
  - Example:
    ```typescript
    param('conversationId').isUUID()
    ```

- **Title Validation**
  - Max 200 characters
  - Required fields
  - Trims whitespace

#### Frontend (JavaScript)
- **Message Validation**
  - Client-side validation before sending
  - Length limits: 1-5000 characters
  - User-friendly error messages
  - Prevents empty messages

  ```javascript
  SecurityUtils.validateInput(msg, 1, 5000)
  ```

### 2. **XSS (Cross-Site Scripting) Prevention**

#### Backend
- **XSS Sanitization Library**: `xss` package
- All user inputs sanitized to remove HTML tags
- Applied to: messages, titles, conversation content

  ```typescript
  const sanitizeInput = (input: string): string => {
    return xss(input.trim(), {
      whiteList: {}, // Remove all HTML tags
      stripIgnoredTag: true,
    });
  };
  ```

#### Frontend
- **textContent Usage**: All message content rendered using `textContent` instead of `innerHTML`
- **HTML Escaping**: Utility function to escape special characters
- Prevents script injection in message display

  ```javascript
  bubble.textContent = content; // Safe from XSS
  // NOT: bubble.innerHTML = content; ❌
  ```

### 3. **Security Headers**

#### Helmet.js Integration
Automatically sets secure HTTP headers:
- `Content-Security-Policy` - Prevents inline script execution
- `X-Frame-Options` - Prevents clickjacking
- `X-Content-Type-Options` - Forces MIME type detection
- `Strict-Transport-Security` - Enforces HTTPS
- `X-XSS-Protection` - Legacy XSS protection

```typescript
app.use(helmet());
```

### 4. **Rate Limiting**

#### General Rate Limiting
- **Limit**: 100 requests per 15 minutes per IP
- **Purpose**: Prevent brute force and DoS attacks
- Applies to: All endpoints

#### API-Specific Rate Limiting (Stricter)
- **Limit**: 30 requests per 15 minutes per IP
- **Purpose**: Protect API endpoints from abuse
- Applied to: `/api/*` routes

```typescript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
});
```

### 5. **CORS (Cross-Origin Resource Sharing)**

#### Configuration
- Restricted to whitelisted origins only
- Configured from environment variables: `ALLOWED_ORIGINS`
- Default: `['http://localhost:3000']`
- Credentials enabled for secure token transmission

```typescript
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200,
}));
```

### 6. **Request Size Limits**

#### Payload Limits
- **JSON**: 10MB (reduced from 50MB)
- **URL-encoded**: 10MB (reduced from 50MB)
- **Purpose**: Prevent memory exhaustion attacks

```typescript
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
```

---

## 📋 Security Checklist

- [x] Input validation on all endpoints
- [x] XSS sanitization (backend and frontend)
- [x] SQL injection prevention (parameterized queries already in use)
- [x] Security headers (Helmet.js)
- [x] Rate limiting (global and API-specific)
- [x] CORS restrictions
- [x] Request size limits
- [x] Client-side validation
- [x] Proper error handling (no stack traces exposed)
- [x] HTML escaping in frontend

---

## 🔧 Environment Configuration

### Required .env Variables
```env
# Server & Database
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://user:password@localhost/chatai

# Security
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Secrets (keep secure)
GOOGLE_AI_API_KEY=your_api_key_here
```

### Production Recommendations
1. **HTTPS Only**: Deploy with HTTPS certificate
2. **Environment**: Set `NODE_ENV=production`
3. **Secrets Management**: Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
4. **Database**: Use strong passwords and restrict access
5. **Monitoring**: Log security events and API usage
6. **Rate Limits**: Adjust based on your traffic patterns

---

## 🚀 Installation Instructions

### 1. Install Dependencies
```bash
npm install
```

This installs the new security packages:
- `helmet` - Security headers
- `express-rate-limit` - Rate limiting
- `express-validator` - Input validation
- `xss` - XSS sanitization

### 2. Build Project
```bash
npm run build
```

### 3. Configure Environment
Create or update `.env` file with secure values:
```env
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=http://localhost:3000
GOOGLE_AI_API_KEY=your_key_here
```

### 4. Run Server
```bash
npm start
```

---

## 🔍 Testing Security

### Input Validation Tests
```bash
# Test max length (should fail)
curl -X POST http://localhost:3000/api/conversations/123e4567-e89b-12d3-a456-426614174000/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"'$(head -c 5001 < /dev/zero | tr '\0' 'a')'"}'

# Test valid input (should succeed)
curl -X POST http://localhost:3000/api/conversations/123e4567-e89b-12d3-a456-426614174000/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello, AI!"}'
```

### XSS Test
```bash
# Attempt script injection (should be sanitized)
curl -X POST http://localhost:3000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"title":"<script>alert(1)</script>Test"}'
```

### Rate Limiting Test
```bash
# Make 31 requests in quick succession (31st should fail)
for i in {1..31}; do
  curl http://localhost:3000/api/conversations
done
```

---

## 📚 Security Best Practices

### For Developers
1. **Never hardcode secrets** - Use environment variables
2. **Validate all inputs** - Both client and server side
3. **Use parameterized queries** - Already implemented (no string concatenation)
4. **Log security events** - Monitor for suspicious activity
5. **Keep dependencies updated** - Run `npm audit` regularly

### For Deployment
1. **Use HTTPS** - Never transmit data over plain HTTP
2. **Set secure headers** - Already configured with Helmet
3. **Implement authentication** - Add user authentication layer
4. **Use database authentication** - Secure credentials
5. **Enable logging** - Monitor access patterns
6. **Regular backups** - Protect data integrity

---

## 🐛 Vulnerability Reporting

If you discover a security vulnerability, please email security@yourdomain.com with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (optional)

---

## 📖 References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [npm Security Documentation](https://docs.npmjs.com/packages-and-modules/security)
- [Helmet.js Documentation](https://helmetjs.github.io/)

---

**Last Updated**: March 5, 2024  
**Security Level**: Production-Ready

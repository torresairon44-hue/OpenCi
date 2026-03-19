#!/bin/bash

# Security Features Test Suite
# Tests the implemented security features

echo "========================================"
echo "Security Testing Suite for OpenCI"
echo "========================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

API_URL="http://localhost:3000/api"

# Test 1: Input Validation - Empty Message
echo -e "${YELLOW}Test 1: Empty Message Validation${NC}"
echo "Sending empty message (should fail)..."
curl -s -X POST "$API_URL/conversations/550e8400-e29b-41d4-a716-446655440000/messages" \
  -H "Content-Type: application/json" \
  -d '{"content":""}' | jq '.' || echo "Request failed (expected)"
echo ""

# Test 2: Input Validation - Too Long Message
echo -e "${YELLOW}Test 2: Message Length Validation${NC}"
echo "Sending 5001 character message (should fail)..."
LONG_MSG=$(python3 -c "print('a' * 5001)")
curl -s -X POST "$API_URL/conversations/550e8400-e29b-41d4-a716-446655440000/messages" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"$LONG_MSG\"}" | jq '.errors' || echo "Request failed (expected)"
echo ""

# Test 3: Valid Input
echo -e "${YELLOW}Test 3: Valid Input Submission${NC}"
echo "Sending valid conversation creation..."
RESPONSE=$(curl -s -X POST "$API_URL/conversations" \
  -H "Content-Type: application/json" \
  -d '{"title":"Security Test"}')
echo "$RESPONSE" | jq '.'
CONV_ID=$(echo "$RESPONSE" | jq -r '.conversationId' 2>/dev/null)
echo "Conversation ID: $CONV_ID"
echo ""

# Test 4: XSS Attempt
echo -e "${YELLOW}Test 4: XSS Injection Prevention${NC}"
echo "Attempting to inject script tags (should be sanitized)..."
curl -s -X POST "$API_URL/conversations" \
  -H "Content-Type: application/json" \
  -d '{"title":"<script>alert(1)</script>XSS Test"}' | jq '.'
echo ""

# Test 5: Invalid UUID
echo -e "${YELLOW}Test 5: UUID Validation${NC}"
echo "Using invalid UUID format (should fail)..."
curl -s -X GET "$API_URL/conversations/not-a-uuid" | jq '.errors' || echo "Request failed (expected)"
echo ""

# Test 6: Rate Limiting
echo -e "${YELLOW}Test 6: Rate Limiting Test${NC}"
echo "Making 35 rapid requests (31st and beyond should be rate limited)..."
SUCCESS=0
BLOCKED=0
for i in {1..35}; do
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/conversations")
  if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "404" ]; then
    ((SUCCESS++))
  else
    ((BLOCKED++))
  fi
  if [ $((i % 5)) -eq 0 ]; then
    echo "  Request $i: Success=$SUCCESS, Blocked=$BLOCKED"
  fi
done
echo -e "Final: ${GREEN}Success=$SUCCESS${NC}, ${RED}Blocked=$BLOCKED${NC}"
echo ""

# Test 7: CORS Headers
echo -e "${YELLOW}Test 7: CORS Configuration${NC}"
echo "Checking CORS headers..."
curl -s -i -X OPTIONS "$API_URL/conversations" 2>&1 | grep -i "access-control"
echo ""

# Test 8: Security Headers
echo -e "${YELLOW}Test 8: Security Headers${NC}"
echo "Checking Helmet.js security headers..."
curl -s -i "$API_URL/health" 2>&1 | grep -E "X-Content-Type|X-Frame|Strict-Transport|Content-Security"
echo ""

echo -e "${GREEN}========================================"
echo "Security Testing Complete"
echo "========================================${NC}"
echo ""
echo "Note: This is a basic test suite. For production:"
echo "1. Test with actual API clients"
echo "2. Monitor application logs"
echo "3. Use security scanning tools (e.g., OWASP ZAP)"
echo "4. Perform penetration testing"

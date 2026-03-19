import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GOOGLE_AI_API_KEY;

async function testGoogleAI() {
  console.log('\n🔍 Google Generative AI Diagnostic Test\n');
  console.log('=' . repeat(50));

  // Check API Key
  console.log('\n1. Checking API Key:');
  if (!apiKey) {
    console.log('   ❌ GOOGLE_AI_API_KEY not found in .env');
    console.log('   ℹ️  Please add GOOGLE_AI_API_KEY to .env file');
    return;
  }

  console.log(
    '   ✅ API Key found: ' + apiKey.substring(0, 20) + '...'
  );

  // Initialize client
  console.log('\n2. Initializing Google AI Client:');
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    console.log('   ✅ Client initialized successfully');

    // Test available models
    console.log('\n3. Testing Available Models:');

    const modelsToTest = [
      'gemini-pro',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'text-bison-001',
    ];

    for (const modelName of modelsToTest) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent('test');
        console.log(
          `   ✅ ${modelName}: Available and working`
        );
      } catch (error: any) {
        const errorMsg = error.message || error;
        console.log(
          `   ❌ ${modelName}: ${errorMsg.substring(0, 60)}`
        );
      }
    }
  } catch (error) {
    console.error('   ❌ Failed to initialize client:', error);
    return;
  }

  // Test chat functionality
  console.log('\n4. Testing Chat Functionality:');
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: 'Hi' }],
        },
        {
          role: 'model',
          parts: [{ text: 'Hello! How can I help you?' }],
        },
      ],
    });

    const result = await chat.sendMessage('What is 2+2?');
    const response = await result.response;
    const text = response.text();

    console.log('   ✅ Chat functionality working');
    console.log('   📝 Test response: ' + text.substring(0, 100) + '...');
  } catch (error: any) {
    console.log('   ⚠️  Chat test failed (this might be ok)');
    console.log(
      '   Error: ' + (error.message || error).substring(0, 80)
    );
  }

  console.log('\n' + '='.repeat(50));
  console.log('\n✅ Diagnostic test complete!\n');
  console.log('Next Steps:');
  console.log(
    '1. If models are available, run: npm run build && npm run dev'
  );
  console.log(
    '2. If no models work, check GOOGLE_AI_API_SETUP.md for solutions'
  );
  console.log('3. The app works in fallback mode while you configure AI\n');
}

testGoogleAI().catch(console.error);

import 'dotenv/config';
import { WestWalletService } from './services/westwalletService.js';

const PUBLIC_KEY = process.env.WESTWALLET_PUBLIC_KEY;
const PRIVATE_KEY = process.env.WESTWALLET_PRIVATE_KEY;

console.log('🧪 Testing WestWallet Integration\n');

if (!PUBLIC_KEY || !PRIVATE_KEY) {
  console.error('❌ WESTWALLET keys not found in .env!');
  console.log('Add these to your .env file:');
  console.log('WESTWALLET_PUBLIC_KEY=your_public_key');
  console.log('WESTWALLET_PRIVATE_KEY=your_private_key');
  process.exit(1);
}

const westwallet = new WestWalletService(PUBLIC_KEY, PRIVATE_KEY);

async function test() {
  try {
    console.log('1️⃣  Testing API Connection...');
    const balance = await westwallet.getBalance('USDTTRC');
    console.log('✅ API Connection successful!');
    console.log(`   Balance: ${balance.balance} USDT\n`);

    console.log('2️⃣  Testing Deposit Address Generation...');
    const address = await westwallet.generateDepositAddress('USDTTRC', '123456789');
    console.log('✅ Deposit address generated!');
    console.log(`   Address: ${address.address}`);
    console.log(`   Label: ${address.label}\n`);

    console.log('3️⃣  Testing Transaction History...');
    const history = await westwallet.getTransactionHistory('USDTTRC', 5);
    console.log(`✅ Transaction history retrieved!`);
    console.log(`   Total transactions: ${history.length}\n`);

    console.log('🎉 ALL TESTS PASSED!');
    console.log('\n📋 Next Steps:');
    console.log('1. Your WestWallet integration is working!');
    console.log('2. Add IPN URL in WestWallet dashboard:');
    console.log(`   https://your-backend-url.com/api/westwallet/callback`);
    console.log('3. Test deposit: Send test USDT to the generated address');
    console.log('4. Check if IPN callback is received\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\n🔍 Troubleshooting:');
    console.error('1. Check if your API keys are correct');
    console.error('2. Verify your IP is whitelisted in WestWallet dashboard');
    console.error('3. Check internet connection');
    console.error('4. Enable test mode in WestWallet dashboard');
  }
}

test();

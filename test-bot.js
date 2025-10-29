import 'dotenv/config';
import { supabase } from './db/supabase.js';

console.log('🧪 Testing Bot Configuration...\n');

console.log('1️⃣ Checking Environment Variables:');
console.log(`   TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✅ SET' : '❌ MISSING'}`);
console.log(`   WEBAPP_URL: ${process.env.WEBAPP_URL || '❌ MISSING'}`);
console.log(`   ADMIN_TELEGRAM_IDS: ${process.env.ADMIN_TELEGRAM_IDS || '❌ MISSING'}`);
console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL || '❌ MISSING'}`);
console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ SET' : '❌ MISSING'}\n`);

console.log('2️⃣ Testing Supabase Connection:');
try {
  const { data, error } = await supabase
    .from('users')
    .select('telegram_id, balance_usdt, balance_ton, balance_sol')
    .limit(5);

  if (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
  } else {
    console.log(`   ✅ Connected! Found ${data.length} users`);
    if (data.length > 0) {
      console.log(`   📊 Sample user balances:`);
      data.forEach((user, i) => {
        console.log(`      ${i + 1}. ID ${user.telegram_id}:`);
        console.log(`         USDT: ${user.balance_usdt || 0}`);
        console.log(`         TON: ${user.balance_ton || 0}`);
        console.log(`         SOL: ${user.balance_sol || 0}`);
      });
    }
  }
} catch (err) {
  console.log(`   ❌ CONNECTION ERROR: ${err.message}`);
}

console.log('\n3️⃣ Configuration Status:');
const hasToken = !!process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.includes('YOUR_');
const hasSupabase = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY.includes('example');
const hasWebApp = !!process.env.WEBAPP_URL && !process.env.WEBAPP_URL.includes('your-');

if (hasToken && hasSupabase && hasWebApp) {
  console.log('   ✅ ALL CONFIGURED! Bot ready to start!');
  console.log('\n🚀 Start bot with: node backend/bot/bot.js');
} else {
  console.log('   ❌ MISSING CONFIGURATION:');
  if (!hasToken) console.log('      - Get bot token from @BotFather');
  if (!hasSupabase) console.log('      - Get service role key from Supabase dashboard');
  if (!hasWebApp) console.log('      - Set your web app URL');
  console.log('\n📝 Update .env file with real credentials!');
}

process.exit(0);

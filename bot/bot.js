import { Bot, InputFile } from 'grammy';
import dotenv from 'dotenv';
import { supabase } from '../db/supabase.js';
import { investmentService } from '../services/investmentService.js';
import { pnlService } from '../services/pnlService.js';
import { exportService } from '../services/exportService.js';
import { TRANSLATIONS, getUserLanguage, setUserLanguage } from './botTranslations.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL || 'http://localhost:3000';

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in .env');
  process.exit(1);
}

const bot = new Bot(token);

console.log('🤖 Telegram Bot started successfully!');
console.log(`📱 Web App URL: ${webAppUrl}`);

bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;
  const startPayload = ctx.match;

  try {
    console.log(`🔍 /start DEBUG:
      - User ID: ${userId}
      - Username: ${username}
      - Payload Type: ${typeof startPayload}
      - Payload Value: "${startPayload}"
      - Payload Length: ${startPayload ? startPayload.length : 0}
    `);

    // Check if user exists
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', userId)
      .maybeSingle();

    console.log(`/start from user ${userId}, exists: ${!!user}, payload: ${startPayload}`);

    // ALWAYS show language selection on /start
    const message = user
      ? '🌍 Welcome back! / С возвращением! / ¡Bienvenido de nuevo!\n\nPlease select your language / Выберите язык / Seleccione su idioma:'
      : '🌍 Welcome! / Добро пожаловать! / ¡Bienvenido!\n\nPlease select your language / Выберите язык / Seleccione su idioma:';

    await ctx.reply(message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🇬🇧 English', callback_data: `lang_en_${startPayload || ''}` }],
          [{ text: '🇷🇺 Русский', callback_data: `lang_ru_${startPayload || ''}` }],
          [{ text: '🇪🇸 Español', callback_data: `lang_es_${startPayload || ''}` }]
        ]
      }
    });
  } catch (error) {
    console.error('Error in /start:', error);
    await ctx.reply('❌ Sorry, there was an error. Please try again later.');
  }
});

// Handle ALL callback queries in ONE handler
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;
  const username = ctx.from.username || `user${userId}`;
  const firstName = ctx.from.first_name || 'User';

  console.log(`Callback received: ${data} from user ${userId}`);

  // Handle lang_ - Used for ALL language selection (new users, existing users, /start, /language)
  // Format: lang_<language>_<optional_referral_code>
  if (data.startsWith('lang_')) {
    const parts = data.split('_');
    const lang = parts[1]; // 'en', 'ru', or 'es'
    // FIXED: Join all remaining parts for the referral code
    // Example: lang_en_ref_ABC123 -> parts = ['lang', 'en', 'ref', 'ABC123']
    // We need to join parts[2] onwards: 'ref_ABC123'
    const startPayload = parts.slice(2).join('_') || ''; // referral code if present
    const t = TRANSLATIONS[lang];

    console.log(`🔍 LANG CALLBACK DEBUG:
      - Full data: "${data}"
      - Parts: ${JSON.stringify(parts)}
      - Language: ${lang}
      - Start Payload: "${startPayload}"
      - Payload length: ${startPayload.length}
    `);

    // Check if user already exists (might have been created by frontend)
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', userId)
      .maybeSingle();

    console.log(`📊 EXISTING USER CHECK:
      - Exists: ${!!existingUser}
      - Has referrer_id: ${existingUser?.referrer_id || 'NULL'}
      - Payload: "${startPayload}"
    `);

    let finalUser;

    if (existingUser) {
      // User exists (created by frontend), just update language and referrer if needed
      console.log(`✅ User ${userId} exists, updating language to ${lang}`);

      // CRITICAL: Only allow referrer assignment on FIRST bot activation
      // If user has last_activity, they've used the bot before = NO REFERRER
      const isFirstBotActivation = !existingUser.last_activity;

      let referrerId = null;
      if (startPayload && startPayload.startsWith('ref_') && !existingUser.referrer_id) {
        if (!isFirstBotActivation) {
          console.log(`🚫 BLOCKED: User ${userId} tried to set referrer after already using bot`);
          console.log(`   last_activity: ${existingUser.last_activity}`);
          console.log(`   Referral code "${startPayload}" IGNORED`);
        } else {
          const referralCode = startPayload.replace('ref_', '');
          console.log(`🔗 EXISTING USER - FIRST BOT ACTIVATION - Processing referral: ${referralCode}`);
          const { data: referrer } = await supabase
            .from('users')
            .select('id')
            .eq('referral_code', referralCode)
            .maybeSingle();
          if (referrer) {
            referrerId = referrer.id;
            console.log(`✅ EXISTING USER - Found referrer ID: ${referrerId}`);
          } else {
            console.log(`❌ EXISTING USER - No referrer found for code: ${referralCode}`);
          }
        }
      }

      const updateData = {
        language_preference: lang,
        first_name: firstName || existingUser.first_name,
        username: username || existingUser.username
      };

      if (referrerId && !existingUser.referrer_id) {
        updateData.referrer_id = referrerId;
        console.log(`🔧 WILL UPDATE referrer_id to: ${referrerId}`);
      }

      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('telegram_id', userId)
        .select()
        .single();

      if (updateError) {
        console.error('❌ UPDATE ERROR:', updateError);
      } else {
        console.log(`✅ UPDATE SUCCESS - referrer_id is now: ${updatedUser.referrer_id}`);
      }

      finalUser = updatedUser;

      if (referrerId && !existingUser.referrer_id) {
        // Double-check: Prevent self-referral
        if (finalUser.id === referrerId) {
          console.error(`🚫 BLOCKED: Existing user ${userId} attempted self-referral (user_id=${finalUser.id} === referrer_id=${referrerId})`);
        } else {
          console.log(`🏗️ EXISTING USER - BUILDING HIERARCHY for user ${finalUser.id} with referrer ${referrerId}`);
          const { data: hierarchyResult, error: rpcError } = await supabase.rpc('build_referral_hierarchy', {
            user_id: finalUser.id,
            new_referrer_id: referrerId
          });
          if (rpcError) {
            console.error('❌ EXISTING USER - HIERARCHY ERROR:', rpcError);
          } else {
            console.log(`✅ EXISTING USER - HIERARCHY BUILT`);

            // Verify referrals were created
            const { data: verifyRefs } = await supabase
              .from('referrals')
              .select('*')
              .eq('referred_id', finalUser.id);
            console.log(`✅ EXISTING USER - Referral entries created:`, verifyRefs?.length || 0, verifyRefs);
          }
        }
      } else if (existingUser.referrer_id) {
        console.log(`ℹ️ EXISTING USER - Already has referrer_id: ${existingUser.referrer_id}`);
      } else {
        console.log(`⚠️ EXISTING USER - NO REFERRER CODE PROVIDED`);
      }
    } else {
      // User doesn't exist, create new
      let referrerId = null;
      if (startPayload && startPayload.startsWith('ref_')) {
        const referralCode = startPayload.replace('ref_', '');
        console.log(`🔗 Processing referral code: ${referralCode}`);
        const { data: referrer } = await supabase
          .from('users')
          .select('id')
          .eq('referral_code', referralCode)
          .maybeSingle();
        if (referrer) {
          referrerId = referrer.id;
          console.log(`✅ Found referrer ID: ${referrerId}`);
        } else {
          console.log(`❌ No referrer found for code: ${referralCode}`);
        }
      }

      const { data: newUser, error } = await supabase
        .from('users')
        .insert({
          telegram_id: userId,
          username,
          first_name: firstName,
          language_preference: lang,
          referrer_id: referrerId,
          balance_usdtbep: 0,
          balance_usdterc: 0,
          balance_usdttrc: 0,
          balance_usdtton: 0,
          balance_usdcerc: 0,
          balance_usdcbep: 0,
          balance_bnb: 0,
          balance_eth: 0,
          balance_ton: 0,
          balance_sol: 0
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Error creating user:', error);
        console.error('   Details:', JSON.stringify(error, null, 2));
        await ctx.answerCallbackQuery('❌ Error creating account. Please try again.');
        return;
      }

      finalUser = newUser;

      if (referrerId) {
        // Double-check: Prevent self-referral (should never happen, but extra safety)
        if (finalUser.id === referrerId) {
          console.error(`🚫 BLOCKED: User ${userId} attempted self-referral (user_id=${finalUser.id} === referrer_id=${referrerId})`);
        } else {
          console.log(`🏗️ BUILDING HIERARCHY: user_id=${finalUser.id}, referrer_id=${referrerId}`);
          const { data: hierarchyResult, error: hierarchyError } = await supabase.rpc('build_referral_hierarchy', {
            user_id: finalUser.id,
            new_referrer_id: referrerId
          });

          if (hierarchyError) {
            console.error(`❌ HIERARCHY BUILD FAILED:`, hierarchyError);
          } else {
            console.log(`✅ HIERARCHY BUILT SUCCESSFULLY`);

            // Verify referrals were created
            const { data: verifyRefs } = await supabase
              .from('referrals')
              .select('*')
              .eq('referred_id', finalUser.id);
            console.log(`✅ Referral entries created:`, verifyRefs?.length || 0, verifyRefs);
          }
        }
      } else {
        console.log(`⚠️ NO REFERRER - User ${userId} registered without referral code`);
      }

      console.log(`✅ New user registered: ${userId} (${username}) - Language: ${lang}`);
    }

    await ctx.answerCallbackQuery(t.languageSet);
    await ctx.editMessageText(
      t.welcome(firstName) + '\n\n' +
        t.commandsTitle + '\n' +
        t.cmdBalance + '\n' +
        t.cmdInvest + '\n' +
        t.cmdMyInvest + '\n' +
        t.cmdPnl + '\n' +
        t.cmdReferral + '\n' +
        t.cmdLanguage + '\n\n' +
        t.useWebApp,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: t.btnStartInvesting, web_app: { url: webAppUrl } }],
            [{ text: t.btnBalance, callback_data: 'check_balance' }],
            [{ text: t.btnSupport, url: 'https://t.me/fastbitofficial' }]
          ]
        }
      }
    );
  }

  if (data === 'check_balance') {
    const lang = await getUserLanguage(supabase, userId);
    const t = TRANSLATIONS[lang];

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', userId)
      .maybeSingle();

    if (!user) {
      await ctx.answerCallbackQuery(t.errorNotFound);
      return;
    }

    const message = `
${t.balanceTitle}

💵 USDT: ${(user.balance_usdt || 0).toFixed(2)}
💲 USDC: ${(user.balance_usdc || 0).toFixed(2)}
🟡 BNB: ${(user.balance_bnb || 0).toFixed(4)}
⟠ ETH: ${(user.balance_eth || 0).toFixed(4)}
💎 TON: ${(user.balance_ton || 0).toFixed(4)}
☀️ SOL: ${(user.balance_sol || 0).toFixed(4)}

${t.totalBalance}: $${((user.balance_usdt || 0) + (user.balance_usdc || 0) + (user.balance_bnb || 0) + (user.balance_eth || 0) + (user.balance_ton || 0) + (user.balance_sol || 0)).toFixed(2)}
`;

    await ctx.answerCallbackQuery();
    await ctx.reply(message);
  }
});

// /language command - Same as /start, shows language selector
bot.command('language', async (ctx) => {
  await ctx.reply(
    '🌍 Select your language / Выберите язык / Seleccione su idioma:',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🇬🇧 English', callback_data: 'lang_en_' }],
          [{ text: '🇷🇺 Русский', callback_data: 'lang_ru_' }],
          [{ text: '🇪🇸 Español', callback_data: 'lang_es_' }]
        ]
      }
    }
  );
});

bot.command('balance', async (ctx) => {
  const userId = ctx.from.id;

  try {
    const lang = await getUserLanguage(supabase, userId);
    const t = TRANSLATIONS[lang];

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', userId)
      .maybeSingle();

    if (!user) {
      await ctx.reply(t.errorNotFound);
      return;
    }

    // Fetch live crypto prices from CoinGecko
    let livePrices = { TON: 2.05, SOL: 150, BNB: 600, ETH: 3000, USDT: 1, USDC: 1 };
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,solana,binancecoin,ethereum&vs_currencies=usd'
      );
      const data = await response.json();
      livePrices = {
        TON: data['the-open-network']?.usd || 2.05,
        SOL: data['solana']?.usd || 150,
        BNB: data['binancecoin']?.usd || 600,
        ETH: data['ethereum']?.usd || 3000,
        USDT: 1,
        USDC: 1
      };
    } catch (err) {
      console.log('⚠️ Failed to fetch live prices, using fallback');
    }

    // Calculate total balance in USD
    const totalUSD = (
      (user.balance_usdt || 0) * livePrices.USDT +
      (user.balance_usdc || 0) * livePrices.USDC +
      (user.balance_bnb || 0) * livePrices.BNB +
      (user.balance_eth || 0) * livePrices.ETH +
      (user.balance_ton || 0) * livePrices.TON +
      (user.balance_sol || 0) * livePrices.SOL
    );

    const message = `
${t.balanceTitle}

💵 USDT: ${(user.balance_usdt || 0).toFixed(2)}
💲 USDC: ${(user.balance_usdc || 0).toFixed(2)}
🟡 BNB: ${(user.balance_bnb || 0).toFixed(4)}
⟠ ETH: ${(user.balance_eth || 0).toFixed(4)}
💎 TON: ${(user.balance_ton || 0).toFixed(4)}
☀️ SOL: ${(user.balance_sol || 0).toFixed(4)}

${t.totalBalance}: $${totalUSD.toFixed(2)}
`;

    await ctx.reply(message);
  } catch (error) {
    console.error('Error checking balance:', error);
    await ctx.reply('❌ Error loading balance');
  }
});

bot.callbackQuery('check_balance', async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from.id;

  try {
    const { data: user } = await supabase
      .from('users')
      .select('balance_usdt, balance_ton, balance_sol')
      .eq('telegram_id', userId)
      .maybeSingle();

    if (!user) {
      await ctx.reply('❌ Пользователь не найден. Используйте /start для регистрации.');
      return;
    }

    const usdt = parseFloat(user.balance_usdt || 0).toFixed(2);
    const ton = parseFloat(user.balance_ton || 0).toFixed(4);
    const sol = parseFloat(user.balance_sol || 0).toFixed(4);

    await ctx.reply(
      `💰 Your Balances:\n\n` +
      `💵 USDT: ${usdt}\n` +
      `💎 TON: ${ton}\n` +
      `🔮 SOL: ${sol}`
    );
  } catch (error) {
    console.error('Error checking balance:', error);
    await ctx.reply('❌ Error loading balance');
  }
});

bot.command('invest', async (ctx) => {
  try {
    const plans = await investmentService.getPlans();

    let message = '📊 Investment Plans:\n\n';

    plans.forEach((plan) => {
      message += `${plan.emoji} ${plan.name}\n`;
      message += `  Min: ${plan.min_amount} | Max: ${plan.max_amount}\n`;
      message += `  Return: ${plan.daily_return}% ${plan.duration_hours > 0 ? 'daily' : 'per day'}\n`;
      message += `  ${plan.description}\n\n`;
    });

    message += 'Use the Web App to start investing! 🚀';

    await ctx.reply(message);
  } catch (error) {
    console.error('Error loading plans:', error);
    await ctx.reply('❌ Error loading investment plans');
  }
});

bot.command('myinvest', async (ctx) => {
  const userId = ctx.from.id;

  try {
    const investments = await investmentService.getInvestments(userId.toString());

    if (!investments || investments.length === 0) {
      await ctx.reply('📊 You have no investments yet.\n\nUse /invest to see available plans!');
      return;
    }

    let message = '📊 Your Investments:\n\n';

    investments.slice(0, 5).forEach((inv) => {
      const status = inv.status === 'active' ? '⏳ Active' : '✅ Completed';
      const plan = inv.investment_plans;
      message += `${plan.emoji} ${plan.name} - ${status}\n`;
      message += `  Amount: ${inv.amount} ${inv.crypto_type}\n`;
      message += `  Profit: ${inv.current_profit?.toFixed(2) || 0} ${inv.crypto_type}\n`;
      message += `  ${inv.can_claim ? '✅ Ready to claim!' : '⏳ Growing...'}\n\n`;
    });

    if (investments.length > 5) {
      message += `... and ${investments.length - 5} more!\n\n`;
    }

    message += 'Use the Web App to manage investments! 🚀';

    await ctx.reply(message);
  } catch (error) {
    console.error('Error loading investments:', error);
    await ctx.reply('❌ Error loading investments');
  }
});

bot.command('pnl', async (ctx) => {
  const userId = ctx.from.id;

  try {
    const pnl = await pnlService.getPNL(userId.toString());

    const message =
      `📊 Ваша статистика дохода\n\n` +
      `💰 Доходы:\n` +
      `  За 24 часа: $${pnl.earnings_24h.toFixed(2)}\n` +
      `  За 7 дней: $${pnl.earnings_7d.toFixed(2)}\n` +
      `  За 30 дней: $${pnl.earnings_30d.toFixed(2)}\n\n` +
      `📈 Сводка:\n` +
      `  Всего инвестировано: $${pnl.total_invested.toFixed(2)}\n` +
      `  Всего получено: $${pnl.total_claimed.toFixed(2)}\n` +
      `  Активных вкладов: ${pnl.active_investments_count}\n` +
      `  ROI: ${pnl.roi_percentage}%\n\n` +
      `💸 Удобно, все считается за вас, а вы получаете доход!\n\n` +
      `🔗 Наши ресурсы:\n` +
      `🔥 Новостной Канал: https://t.me/+FNXgiijCvJo1Zjhk\n` +
      `💬 Чат Сообщества: https://t.me/+p4orxjRf684zMjQ0`;

    await ctx.reply(message);
  } catch (error) {
    console.error('Error loading PNL:', error);
    await ctx.reply('❌ Ошибка загрузки данных');
  }
});

bot.command('referral', async (ctx) => {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ').slice(1);
  const level = args[0] ? parseInt(args[0]) : null;

  try {
    const { data: user } = await supabase
      .from('users')
      .select('referral_code, id')
      .eq('telegram_id', userId)
      .single();

    if (level && level >= 1 && level <= 3) {
      const { data: refs } = await supabase
        .from('referrals')
        .select(`
          referred_id,
          users!referrals_referred_id_fkey (
            telegram_id,
            username,
            first_name,
            created_at
          )
        `)
        .eq('referrer_id', user.id)
        .eq('level', level)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (!refs || refs.length === 0) {
        await ctx.reply(`📊 Level ${level}: You have 0 referrals at this level`);
        return;
      }

      let message = `👥 Level ${level} Referrals (${refs.length} total)\n\n`;

      refs.slice(0, 20).forEach((ref, idx) => {
        const refUser = ref.users;
        const name = refUser?.username
          ? `@${refUser.username}`
          : (refUser?.first_name || 'Unknown');
        const joinDate = refUser?.created_at
          ? new Date(refUser.created_at).toLocaleDateString('ru-RU')
          : 'N/A';
        message += `${idx + 1}. ${name} (${joinDate})\n`;
      });

      if (refs.length > 20) {
        message += `\n... and ${refs.length - 20} more!`;
      }

      await ctx.reply(message);
      return;
    }

    const { data: refs } = await supabase
      .from('referrals')
      .select('level')
      .eq('referrer_id', user.id)
      .eq('is_active', true);

    const { data: earnings } = await supabase
      .from('referral_earnings')
      .select('level, amount, crypto_type')
      .eq('referrer_id', user.id);

    const level1 = refs?.filter(r => r.level === 1).length || 0;
    const level2 = refs?.filter(r => r.level === 2).length || 0;
    const level3 = refs?.filter(r => r.level === 3).length || 0;

    // Fetch live crypto prices from CoinGecko
    let cryptoPrices = { TON: 5.5, SOL: 150, BNB: 600, ETH: 3000 };
    try {
      const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,solana,binancecoin,ethereum&vs_currencies=usd');
      const priceData = await priceResponse.json();
      cryptoPrices = {
        TON: priceData['the-open-network']?.usd || 5.5,
        SOL: priceData['solana']?.usd || 150,
        BNB: priceData['binancecoin']?.usd || 600,
        ETH: priceData['ethereum']?.usd || 3000
      };
    } catch (err) {
      console.error('Failed to fetch live crypto prices:', err.message);
    }

    // Convert all earnings to USD using live prices
    const convertToUSD = (amount, cryptoType) => {
      if (!cryptoType || cryptoType.includes('USDT') || cryptoType.includes('USDC')) return amount;
      return amount * (cryptoPrices[cryptoType] || 1);
    };

    const level1Earnings = earnings?.filter(e => e.level === 1).reduce((s, e) => s + convertToUSD(parseFloat(e.amount), e.crypto_type), 0) || 0;
    const level2Earnings = earnings?.filter(e => e.level === 2).reduce((s, e) => s + convertToUSD(parseFloat(e.amount), e.crypto_type), 0) || 0;
    const level3Earnings = earnings?.filter(e => e.level === 3).reduce((s, e) => s + convertToUSD(parseFloat(e.amount), e.crypto_type), 0) || 0;
    const level4Earnings = earnings?.filter(e => e.level === 4).reduce((s, e) => s + convertToUSD(parseFloat(e.amount), e.crypto_type), 0) || 0;
    const level5Earnings = earnings?.filter(e => e.level === 5).reduce((s, e) => s + convertToUSD(parseFloat(e.amount), e.crypto_type), 0) || 0;

    const botUsername = ctx.me.username;
    const referralLink = `https://t.me/${botUsername}?start=ref_${user.referral_code}`;

    const totalEarnings = level1Earnings + level2Earnings + level3Earnings + level4Earnings + level5Earnings;

    const message =
      `👥 Referral Program (5 Levels)\n\n` +
      `🔗 Your Referral Link:\n${referralLink}\n\n` +
      `📊 Your Stats:\n` +
      `  Level 1: ${level1} refs (15% commission)\n` +
      `  Level 2: ${level2} refs (10% commission)\n` +
      `  Level 3: ${level3} refs (5% commission)\n` +
      `  Level 4: ${level4} refs (3% commission)\n` +
      `  Level 5: ${level5} refs (2% commission)\n\n` +
      `💰 Total Earnings (USD):\n` +
      `  Level 1: $${level1Earnings.toFixed(2)}\n` +
      `  Level 2: $${level2Earnings.toFixed(2)}\n` +
      `  Level 3: $${level3Earnings.toFixed(2)}\n` +
      `  Level 4: $${level4Earnings.toFixed(2)}\n` +
      `  Level 5: $${level5Earnings.toFixed(2)}\n` +
      `  Total: $${totalEarnings.toFixed(2)}\n\n` +
      `💡 Tip: Use /referral <level> to see your referrals\n` +
      `Example: /referral 1`;

    await ctx.reply(message);
  } catch (error) {
    console.error('Error loading referral stats:', error);
    await ctx.reply('❌ Error loading referral data');
  }
});

bot.callbackQuery('my_investments', async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from.id;

  try {
    const investments = await investmentService.getInvestments(userId.toString());

    if (!investments || investments.length === 0) {
      await ctx.reply('📊 You have no investments yet.\n\nUse the Web App to start investing!');
      return;
    }

    let message = '📊 Your Investments:\n\n';

    investments.slice(0, 5).forEach((inv) => {
      const status = inv.status === 'active' ? '⏳' : '✅';
      const plan = inv.investment_plans;
      message += `${status} ${plan.emoji} ${plan.name}\n`;
      message += `  ${inv.amount} ${inv.crypto_type} → ${inv.return_amount} ${inv.crypto_type}\n`;
    });

    if (investments.length > 5) {
      message += `\n... and ${investments.length - 5} more!`;
    }

    await ctx.reply(message);
  } catch (error) {
    console.error('Error loading investments:', error);
    await ctx.reply('❌ Error loading data');
  }
});

bot.on('message:web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.message.web_app_data.data);
    await ctx.reply(
      `✅ Received from Web App:\n${JSON.stringify(data, null, 2)}`
    );
  } catch (error) {
    console.error('Error handling web app data:', error);
  }
});

// Inline query handler for bot invitations
bot.on('inline_query', async (ctx) => {
  try {
    const query = ctx.inlineQuery.query.toLowerCase();
    const botUsername = ctx.me.username;

    const results = [
      {
        type: 'photo',
        id: '1',
        photo_url: 'https://i.ibb.co/fz0HJqnT/20.jpg',
        thumbnail_url: 'https://i.ibb.co/fz0HJqnT/20.jpg',
        photo_width: 1200,
        photo_height: 630,
        title: '🚀 Start Investing',
        description: 'Get up to 3% daily returns!',
        caption:
          `🚀 Start Investing and Get Up To 3% Daily!\n\n` +
          `💰 Flexible deposits with 0.01%/sec\n` +
          `🔒 Fixed deposits up to 1% per day\n` +
          `📈 Live profit statistics\n` +
          `👥 3-level referral program: 5% + 3% + 1%\n\n` +
          `Join The Way Money and start your financial future today! 💎`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Open Web App', url: webAppUrl }],
            [{ text: '📱 Open Bot', url: `https://t.me/${botUsername}` }]
          ]
        }
      },
      {
        type: 'photo',
        id: '2',
        photo_url: 'https://i.ibb.co/fz0HJqnT/20.jpg',
        thumbnail_url: 'https://i.ibb.co/fz0HJqnT/20.jpg',
        photo_width: 1200,
        photo_height: 630,
        title: '💎 Начать инвестировать',
        description: 'Получай до 3% в день!',
        caption:
          `💎 Начни зарабатывать на крипто сегодня!\n\n` +
          `✨ Получай до 3% в день с The Way Money:\n` +
          `🔓 Гибкие вклады без заморозки\n` +
          `🔒 Фиксированные вклады с высоким доходом\n` +
          `📈 Живая статистика прибыли\n` +
          `👥 Реферальная программа: 5% + 3% + 1%\n\n` +
          `Присоединяйся к The Way Money и начни свое финансовое будущее! 🚀`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Открыть Web App', url: webAppUrl }],
            [{ text: '📱 Открыть бота', url: `https://t.me/${botUsername}` }]
          ]
        }
      }
    ];

    await ctx.answerInlineQuery(results, {
      cache_time: 300,
      is_personal: false
    });
  } catch (error) {
    console.error('Error handling inline query:', error);
    console.error('Bot username:', ctx.me.username);
    console.error('Webapp URL:', webAppUrl);
  }
});

// Admin commands
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
console.log('🔧 Loaded ADMIN_IDS:', ADMIN_IDS);

const isAdmin = (userId) => ADMIN_IDS.includes(userId);

// Admin: Help
bot.command('adminhelp', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  const helpText = `🔐 АДМИНСКИЕ КОМАНДЫ

💰 Управление балансами:
/addbalance <telegram_id> <crypto> <amount>
  Добавить баланс пользователю
  Пример: /addbalance 123456789 USDTTRC 100

/removebalance <telegram_id> <crypto> <amount>
  Снять баланс у пользователя
  Пример: /removebalance 123456789 USDTTRC 50

👥 Управление рефералами:
/addref <referrer_id> <referred_id>
  Создать реферальную связь
  Пример: /addref 123456789 987654321

/deleteref <referred_id>
  Удалить реферальную связь
  Пример: /deleteref 987654321

📊 Информация:
/userinfo <telegram_id>
  Полная информация о пользователе

/listusers
  Список всех пользователей

/stats
  Статистика платформы

📤 Экспорт:
/exportusers <тип>
  Экспорт пользователей, депозитов и выводов
  Используйте: /exportusers help - для полного списка

  📋 Пользователи: all, refs, deposits, investors, top
  💰 Депозиты: deposits_today, deposits_time, deposits_range
  💸 Выводы: withdrawals_today, withdrawals_time, withdrawals_range

  Примеры:
  • /exportusers deposits_today - депозиты за сегодня
  • /exportusers withdrawals_today - выводы за сегодня
  • /exportusers withdrawals_time 24 - выводы за 24 часа
  • /exportusers refs 10 - юзеры с 10+ рефералами

📢 Массовые действия:
/broadcast <сообщение>
  Отправить сообщение всем пользователям

/global <сообщение>
  Глобальное сообщение всем

Поддерживаемые криптовалюты:
USDTBEP, USDTERC, USDTTRC, USDTTON
USDCERC, USDCBEP
BNB, ETH, TON, SOL, STARS`;

  await ctx.reply(helpText);
});

// Admin: Add balance to user
bot.command('addbalance', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 4) {
    await ctx.reply('ℹ️ Использование: /addbalance <telegram_id> <crypto_type> <amount>\nПример: /addbalance 123456789 USDTTRC 100\n\nПоддерживаемые криптовалюты:\nUSDTBEP, USDTERC, USDTTRC, USDTTON\nUSDCERC, USDCBEP\nBNB, ETH, TON, SOL');
    return;
  }

  const [, telegramId, cryptoType, amountStr] = args;
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Неверная сумма');
    return;
  }

  const validCryptos = ['USDTBEP', 'USDTERC', 'USDTTRC', 'USDTTON', 'USDCERC', 'USDCBEP', 'BNB', 'ETH', 'TON', 'SOL'];
  const cryptoUpper = cryptoType.toUpperCase();

  if (!validCryptos.includes(cryptoUpper)) {
    await ctx.reply(`❌ Неверный тип криптовалюты.\n\nДоступные: ${validCryptos.join(', ')}`);
    return;
  }

  try {
    const columnName = `balance_${cryptoUpper.toLowerCase()}`;

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('id, ' + columnName)
      .eq('telegram_id', parseInt(telegramId))
      .maybeSingle();

    if (!user) {
      await ctx.reply(`❌ Пользователь с Telegram ID ${telegramId} не найден`);
      return;
    }

    const currentBalance = parseFloat(user[columnName]) || 0;
    const newBalance = currentBalance + amount;

    const { error: updateError } = await supabase
      .from('users')
      .update({ [columnName]: newBalance })
      .eq('telegram_id', parseInt(telegramId));

    if (updateError) throw updateError;

    // Log operation
    await supabase.from('operation_history').insert({
      user_id: user.id,
      operation_type: 'admin_add_balance',
      amount: amount,
      crypto_type: cryptoType.toUpperCase(),
      description: `Admin added ${amount} ${cryptoType}`,
      status: 'completed'
    });

    await ctx.reply(
      `✅ Баланс обновлен!\n\n` +
      `👤 User ID: ${telegramId}\n` +
      `💰 ${cryptoUpper}: ${currentBalance.toFixed(4)} → ${newBalance.toFixed(4)}\n` +
      `➕ Добавлено: ${amount}`
    );
  } catch (error) {
    console.error('Error adding balance:', error);
    await ctx.reply('❌ Ошибка при добавлении баланса');
  }
});

// Admin: Remove balance
bot.command('removebalance', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 4) {
    await ctx.reply('ℹ️ Использование: /removebalance <telegram_id> <crypto_type> <amount>\nПример: /removebalance 123456789 USDTTRC 50\n\nПоддерживаемые криптовалюты:\nUSDTBEP, USDTERC, USDTTRC, USDTTON\nUSDCERC, USDCBEP\nBNB, ETH, TON, SOL');
    return;
  }

  const [, telegramId, cryptoType, amountStr] = args;
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Неверная сумма');
    return;
  }

  const validCryptos = ['USDTBEP', 'USDTERC', 'USDTTRC', 'USDTTON', 'USDCERC', 'USDCBEP', 'BNB', 'ETH', 'TON', 'SOL'];
  const cryptoUpper = cryptoType.toUpperCase();

  if (!validCryptos.includes(cryptoUpper)) {
    await ctx.reply(`❌ Неверный тип криптовалюты.\n\nДоступные: ${validCryptos.join(', ')}`);
    return;
  }

  try {
    const columnName = `balance_${cryptoUpper.toLowerCase()}`;

    const { data: user } = await supabase
      .from('users')
      .select('id, ' + columnName)
      .eq('telegram_id', parseInt(telegramId))
      .maybeSingle();

    if (!user) {
      await ctx.reply(`❌ Пользователь не найден`);
      return;
    }

    const currentBalance = parseFloat(user[columnName]) || 0;
    const newBalance = Math.max(0, currentBalance - amount);

    await supabase
      .from('users')
      .update({ [columnName]: newBalance })
      .eq('telegram_id', parseInt(telegramId));

    await supabase.from('operation_history').insert({
      user_id: user.id,
      operation_type: 'admin_remove_balance',
      amount: -amount,
      crypto_type: cryptoType.toUpperCase(),
      description: `Admin removed ${amount} ${cryptoType}`,
      status: 'completed'
    });

    await ctx.reply(
      `✅ Баланс обновлен!\n\n` +
      `👤 User ID: ${telegramId}\n` +
      `💰 ${cryptoUpper}: ${currentBalance.toFixed(4)} → ${newBalance.toFixed(4)}\n` +
      `➖ Удалено: ${amount}`
    );
  } catch (error) {
    console.error('Error removing balance:', error);
    await ctx.reply('❌ Ошибка');
  }
});

// Admin: Get user info
bot.command('userinfo', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 2) {
    await ctx.reply('ℹ️ Использование: /userinfo <telegram_id>');
    return;
  }

  const telegramId = args[1];

  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', parseInt(telegramId))
      .maybeSingle();

    if (!user) {
      await ctx.reply(`❌ Пользователь не найден`);
      return;
    }

    // Get deposits
    const { data: deposits } = await supabase
      .from('deposits')
      .select('amount, crypto_type, created_at, status')
      .eq('user_id', user.id)
      .in('status', ['completed', 'credited'])
      .order('created_at', { ascending: false });

    // Fetch live crypto prices from CoinGecko
    let cryptoRates = {
      'USDT': 1, 'USDTBEP': 1, 'USDTERC': 1, 'USDTTRC': 1, 'USDTTON': 1,
      'USDC': 1, 'USDCERC': 1, 'USDCBEP': 1,
      'BNB': 600, 'ETH': 3000, 'TON': 5.5, 'SOL': 150
    };
    try {
      const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,solana,binancecoin,ethereum&vs_currencies=usd');
      const priceData = await priceResponse.json();
      cryptoRates.TON = priceData['the-open-network']?.usd || 5.5;
      cryptoRates.SOL = priceData['solana']?.usd || 150;
      cryptoRates.BNB = priceData['binancecoin']?.usd || 600;
      cryptoRates.ETH = priceData['ethereum']?.usd || 3000;
    } catch (err) {
      console.error('Failed to fetch live crypto prices:', err.message);
    }

    // Convert deposits to USD
    const totalDepositsUSD = deposits?.reduce((sum, d) => {
      const rate = cryptoRates[d.crypto_type] || 1;
      return sum + (parseFloat(d.amount || 0) * rate);
    }, 0) || 0;
    const lastDeposit = deposits?.[0] || null;

    // Get withdrawals
    const { data: withdrawals } = await supabase
      .from('withdrawals')
      .select('amount, status, crypto_type')
      .eq('user_id', user.id)
      .eq('status', 'approved');

    // Convert withdrawals to USD
    const totalWithdrawalsUSD = withdrawals?.reduce((sum, w) => {
      const rate = cryptoRates[w.crypto_type || 'USDT'] || 1;
      return sum + (parseFloat(w.amount || 0) * rate);
    }, 0) || 0;

    // Get investments
    const { data: investments } = await supabase
      .from('investments')
      .select('amount, status, crypto_type')
      .eq('user_id', user.id);

    const activeInvestments = investments?.filter(i => i.status === 'active') || [];
    const completedInvestments = investments?.filter(i => i.status === 'completed') || [];
    const totalActiveInvestment = activeInvestments.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);

    // Get referrer info
    let referrerInfo = 'Нет реферера';
    if (user.referrer_id) {
      const { data: referrer } = await supabase
        .from('users')
        .select('telegram_id, username, first_name')
        .eq('id', user.referrer_id)
        .maybeSingle();

      if (referrer) {
        referrerInfo = referrer.username
          ? `@${referrer.username} (${referrer.telegram_id})`
          : `${referrer.first_name || 'Unknown'} (${referrer.telegram_id})`;
      }
    }

    // Get 5-level referral stats using the SQL function
    const { data: refStats } = await supabase
      .rpc('get_referral_stats_5_levels', { target_user_id: user.id });

    // Get referral earnings
    const { data: refEarnings } = await supabase
      .from('referral_earnings')
      .select('amount, level, crypto_type')
      .eq('referrer_id', user.id);

    // Calculate earnings by level (convert to USD using live rates)
    const earningsByLevel = [0, 0, 0, 0, 0];
    let totalRefEarningsUSD = 0;

    refEarnings?.forEach(e => {
      const amount = parseFloat(e.amount || 0);
      let usdValue = amount;

      // Convert to USD based on crypto type using cryptoRates
      if (e.crypto_type?.includes('USDT') || e.crypto_type?.includes('USDC') || e.crypto_type === 'USDT' || e.crypto_type === 'USDC') {
        usdValue = amount; // Already USD
      } else {
        const rate = cryptoRates[e.crypto_type] || 1;
        usdValue = amount * rate;
      }

      totalRefEarningsUSD += usdValue;

      if (e.level >= 1 && e.level <= 5) {
        earningsByLevel[e.level - 1] += usdValue;
      }
    });

    // Total balance across all cryptos (in USD equivalent)
    const totalBalance =
      parseFloat(user.balance_usdt || 0) +
      parseFloat(user.balance_usdc || 0) +
      (parseFloat(user.balance_ton || 0) * cryptoRates.TON) +
      (parseFloat(user.balance_sol || 0) * cryptoRates.SOL) +
      (parseFloat(user.balance_bnb || 0) * cryptoRates.BNB) +
      (parseFloat(user.balance_eth || 0) * cryptoRates.ETH);

    const totalValue = totalBalance + totalActiveInvestment;

    // Build message
    let message = `📊 Информация о пользователе ${user.telegram_id}\n\n`;

    message += `👤 Личные данные:\n`;
    message += `• Имя: ${user.first_name || 'нет'} ${user.last_name || ''}`.trim() + '\n';
    if (user.username) message += `• Username: @${user.username}\n`;
    message += `• ID в системе: ${user.id}\n`;
    message += `• Язык: ${user.language_preference || user.language_code || 'en'}\n\n`;

    message += `💰 Финансовая информация:\n`;
    message += `• Сумма депозитов: $${totalDepositsUSD.toFixed(2)} USD\n`;
    message += `• Сумма выводов: $${totalWithdrawalsUSD.toFixed(2)} USD\n`;
    message += `• Активные инвестиции: $${totalActiveInvestment.toFixed(2)} USD\n`;
    message += `• Баланс (все криптовалюты): $${totalBalance.toFixed(2)} USD\n`;
    message += `• Реферальный баланс: $${totalRefEarningsUSD.toFixed(2)} USD\n`;
    message += `• 💎 Активные инвестиции + Баланс: $${totalValue.toFixed(2)} USD\n\n`;

    message += `💵 Балансы по криптовалютам:\n`;
    if (parseFloat(user.balance_usdt || 0) > 0) {
      message += `• USDT: ${parseFloat(user.balance_usdt || 0).toFixed(2)}\n`;
      if (parseFloat(user.balance_usdtbep || 0) > 0) message += `  └ BEP20: ${parseFloat(user.balance_usdtbep || 0).toFixed(2)}\n`;
      if (parseFloat(user.balance_usdterc || 0) > 0) message += `  └ ERC20: ${parseFloat(user.balance_usdterc || 0).toFixed(2)}\n`;
      if (parseFloat(user.balance_usdttrc || 0) > 0) message += `  └ TRC20: ${parseFloat(user.balance_usdttrc || 0).toFixed(2)}\n`;
      if (parseFloat(user.balance_usdtton || 0) > 0) message += `  └ TON: ${parseFloat(user.balance_usdtton || 0).toFixed(2)}\n`;
    }
    if (parseFloat(user.balance_usdc || 0) > 0) {
      message += `• USDC: ${parseFloat(user.balance_usdc || 0).toFixed(2)}\n`;
      if (parseFloat(user.balance_usdcerc || 0) > 0) message += `  └ ERC20: ${parseFloat(user.balance_usdcerc || 0).toFixed(2)}\n`;
      if (parseFloat(user.balance_usdcbep || 0) > 0) message += `  └ BEP20: ${parseFloat(user.balance_usdcbep || 0).toFixed(2)}\n`;
    }
    if (parseFloat(user.balance_ton || 0) > 0) message += `• TON: ${parseFloat(user.balance_ton || 0).toFixed(4)}\n`;
    if (parseFloat(user.balance_sol || 0) > 0) message += `• SOL: ${parseFloat(user.balance_sol || 0).toFixed(4)}\n`;
    if (parseFloat(user.balance_bnb || 0) > 0) message += `• BNB: ${parseFloat(user.balance_bnb || 0).toFixed(4)}\n`;
    if (parseFloat(user.balance_eth || 0) > 0) message += `• ETH: ${parseFloat(user.balance_eth || 0).toFixed(4)}\n`;
    if (parseFloat(user.balance_stars || 0) > 0) message += `• STARS: ${parseFloat(user.balance_stars || 0).toFixed(0)}\n`;
    message += '\n';

    message += `👥 Реферальная программа (5 уровней):\n`;
    message += `• Рефералы:\n`;
    refStats?.forEach((level, idx) => {
      message += `  Уровень ${idx + 1}: ${level.referral_count} чел.\n`;
    });
    message += `• С депозитами:\n`;
    refStats?.forEach((level, idx) => {
      message += `  Уровень ${idx + 1}: $${parseFloat(level.total_deposits_usd || 0).toFixed(2)} USD депозитов\n`;
    });
    message += `• Выводы (заработано):\n`;
    earningsByLevel.forEach((earnings, idx) => {
      message += `  Уровень ${idx + 1}: $${earnings.toFixed(2)} USD\n`;
    });
    message += `• 👤 Реферер: ${referrerInfo}\n\n`;

    message += `📊 Инвестиции:\n`;
    message += `• Активные: ${activeInvestments.length} (${totalActiveInvestment.toFixed(2)} USDT)\n`;
    message += `• Завершенные: ${completedInvestments.length}\n\n`;

    message += `📅 Активность:\n`;
    if (lastDeposit) {
      message += `• Последний депозит: ${lastDeposit.created_at} (${parseFloat(lastDeposit.amount).toFixed(2)} ${lastDeposit.crypto_type})\n`;
    } else {
      message += `• Последний депозит: Нет депозитов\n`;
    }
    message += `• Дата регистрации: ${user.created_at}\n`;
    message += `• Последняя активность: ${user.last_activity || 'н/д'}\n\n`;

    message += user.is_blocked ? '🚫 Заблокирован' : '✅ Активен';

    await ctx.reply(message);
  } catch (error) {
    console.error('Error getting user info:', error);
    await ctx.reply('❌ Ошибка: ' + error.message);
  }
});

// Admin: List latest users
bot.command('listusers', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  try {
    const { data: users, count } = await supabase
      .from('users')
      .select('telegram_id, username, first_name, balance_usdt, balance_ton, balance_sol, balance_stars, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(10);

    if (!users || users.length === 0) {
      await ctx.reply('👥 Пользователей нет');
      return;
    }

    let message = `👥 Последние 10 пользователей (всего: ${count})\n\n`;

    users.forEach((user, idx) => {
      message += `${idx + 1}. `;
      message += user.username ? `@${user.username}` : user.first_name || 'No name';
      message += ` (ID: ${user.telegram_id})\n`;
      message += `   USDT: ${parseFloat(user.balance_usdt || 0).toFixed(2)}\n`;
    });

    message += `\nИспользуйте /userinfo <id> для подробной информации`;

    await ctx.reply(message);
  } catch (error) {
    console.error('Error listing users:', error);
    await ctx.reply('❌ Ошибка');
  }
});

// Admin: Export users to CSV
bot.command('exportusers', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  try {
    const args = ctx.message.text.split(' ').slice(1);
    const command = args[0];
    const param = args[1];

    // Show help if no args or "help"
    if (!command || command === 'help') {
      await ctx.reply(exportService.getHelpMessage(), { parse_mode: 'Markdown' });
      return;
    }

    await ctx.reply('📊 Экспортирую данные...');

    let users = [];
    let deposits = [];
    let withdrawals = [];
    let exportType = '';
    let isDepositExport = false;
    let isWithdrawalExport = false;

    switch (command) {
      case 'all':
        users = await exportService.exportAllUsers();
        exportType = 'все пользователи';
        break;

      case 'refs':
        if (!param || isNaN(param)) {
          await ctx.reply('❌ Укажите количество рефералов: /exportusers refs 10');
          return;
        }
        users = await exportService.exportUsersByReferralCount(parseInt(param));
        exportType = `пользователи с ${param}+ рефералами`;
        break;

      case 'refs_deposits':
        users = await exportService.exportUsersWithReferralDeposits();
        exportType = 'пользователи с рефералами, сделавшими депозиты';
        break;

      case 'deposits':
        if (!param || isNaN(param)) {
          await ctx.reply('❌ Укажите минимальную сумму: /exportusers deposits 100');
          return;
        }
        users = await exportService.exportUsersByDepositAmount(parseFloat(param));
        exportType = `пользователи с депозитами $${param}+`;
        break;

      case 'investors':
        users = await exportService.exportActiveInvestors();
        exportType = 'активные инвесторы';
        break;

      case 'top':
        const limit = param && !isNaN(param) ? parseInt(param) : 100;
        users = await exportService.exportTopEarners(limit);
        exportType = `топ-${limit} по заработку`;
        break;

      // Deposit export commands
      case 'deposits_today':
        deposits = await exportService.exportDepositsToday();
        exportType = 'депозиты за сегодня';
        isDepositExport = true;
        break;

      case 'deposits_time':
        if (!param || isNaN(param)) {
          await ctx.reply('❌ Укажите количество часов: /exportusers deposits_time 24');
          return;
        }
        deposits = await exportService.exportDepositsByTime(parseInt(param));
        exportType = `депозиты за последние ${param} часов`;
        isDepositExport = true;
        break;

      case 'deposits_range':
        const depositDateArgs = ctx.message.text.split(' ').slice(2);
        if (depositDateArgs.length !== 2) {
          await ctx.reply('❌ Укажите даты: /exportusers deposits_range 2025-11-01 2025-11-06');
          return;
        }
        const [depositStartDate, depositEndDate] = depositDateArgs;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(depositStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(depositEndDate)) {
          await ctx.reply('❌ Неверный формат даты. Используйте YYYY-MM-DD');
          return;
        }
        deposits = await exportService.exportDepositsByDateRange(depositStartDate, depositEndDate);
        exportType = `депозиты с ${depositStartDate} по ${depositEndDate}`;
        isDepositExport = true;
        break;

      case 'deposits_all':
        deposits = await exportService.exportAllDeposits('all');
        exportType = 'все депозиты';
        isDepositExport = true;
        break;

      case 'deposits_pending':
        deposits = await exportService.exportAllDeposits('pending');
        exportType = 'все pending депозиты';
        isDepositExport = true;
        break;

      // Withdrawal export commands
      case 'withdrawals_today':
        withdrawals = await exportService.exportWithdrawalsToday();
        exportType = 'выводы за сегодня';
        isWithdrawalExport = true;
        break;

      case 'withdrawals_time':
        if (!param || isNaN(param)) {
          await ctx.reply('❌ Укажите количество часов: /exportusers withdrawals_time 24');
          return;
        }
        withdrawals = await exportService.exportWithdrawalsByTime(parseInt(param));
        exportType = `выводы за последние ${param} часов`;
        isWithdrawalExport = true;
        break;

      case 'withdrawals_range':
        const withdrawalDateArgs = ctx.message.text.split(' ').slice(2);
        if (withdrawalDateArgs.length !== 2) {
          await ctx.reply('❌ Укажите даты: /exportusers withdrawals_range 2025-11-01 2025-11-06');
          return;
        }
        const [withdrawalStartDate, withdrawalEndDate] = withdrawalDateArgs;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(withdrawalStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(withdrawalEndDate)) {
          await ctx.reply('❌ Неверный формат даты. Используйте YYYY-MM-DD');
          return;
        }
        withdrawals = await exportService.exportWithdrawalsByDateRange(withdrawalStartDate, withdrawalEndDate);
        exportType = `выводы с ${withdrawalStartDate} по ${withdrawalEndDate}`;
        isWithdrawalExport = true;
        break;

      case 'withdrawals_approved':
        withdrawals = await exportService.exportAllWithdrawals('approved');
        exportType = 'все одобренные выводы';
        isWithdrawalExport = true;
        break;

      case 'withdrawals_pending':
        withdrawals = await exportService.exportAllWithdrawals('pending');
        exportType = 'все pending выводы';
        isWithdrawalExport = true;
        break;

      case 'withdrawals_rejected':
        withdrawals = await exportService.exportAllWithdrawals('rejected');
        exportType = 'все отклоненные выводы';
        isWithdrawalExport = true;
        break;

      default:
        await ctx.reply(
          '❌ Неизвестная команда. Используйте /exportusers help для справки',
          { parse_mode: 'Markdown' }
        );
        return;
    }

    // Handle deposit exports
    if (isDepositExport) {
      if (!deposits || deposits.length === 0) {
        await ctx.reply(`❌ Нет депозитов для экспорта (${exportType})`);
        return;
      }

      const csv = await exportService.formatDepositsAsCSV(deposits);
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `deposits_export_${command}_${timestamp}.csv`;

      // Fetch live prices for total calculation
      const livePrices = await exportService.getLiveCryptoPrices();
      const totalUSD = deposits.reduce((sum, d) => {
        return sum + parseFloat(exportService.convertToUSDSync(d.amount, d.crypto_type, livePrices));
      }, 0);

      await ctx.replyWithDocument(
        new InputFile(Buffer.from(csv, 'utf-8'), filename),
        {
          caption: `✅ Экспортировано: ${deposits.length} депозитов\n💰 Общая сумма: $${totalUSD.toFixed(2)} USD\n📋 ${exportType}\n📅 ${new Date().toLocaleString('ru-RU')}`
        }
      );
      return;
    }

    // Handle withdrawal exports
    if (isWithdrawalExport) {
      if (!withdrawals || withdrawals.length === 0) {
        await ctx.reply(`❌ Нет выводов для экспорта (${exportType})`);
        return;
      }

      const csv = await exportService.formatWithdrawalsAsCSV(withdrawals);
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `withdrawals_export_${command}_${timestamp}.csv`;

      // Fetch live prices for total calculation
      const livePrices = await exportService.getLiveCryptoPrices();
      const totalUSD = withdrawals.reduce((sum, w) => {
        return sum + parseFloat(exportService.convertToUSDSync(w.amount, w.crypto_type, livePrices));
      }, 0);

      await ctx.replyWithDocument(
        new InputFile(Buffer.from(csv, 'utf-8'), filename),
        {
          caption: `✅ Экспортировано: ${withdrawals.length} выводов\n💰 Общая сумма: $${totalUSD.toFixed(2)} USD\n📋 ${exportType}\n📅 ${new Date().toLocaleString('ru-RU')}`
        }
      );
      return;
    }

    // Handle user exports
    if (!users || users.length === 0) {
      await ctx.reply(`❌ Нет пользователей для экспорта (${exportType})`);
      return;
    }

    const csv = exportService.formatAsCSV(users);
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `users_export_${command}_${timestamp}.csv`;

    await ctx.replyWithDocument(
      new InputFile(Buffer.from(csv, 'utf-8'), filename),
      {
        caption: `✅ Экспортировано: ${users.length} ${exportType}\n📅 ${new Date().toLocaleString('ru-RU')}`
      }
    );
  } catch (error) {
    console.error('Error exporting users:', error);
    await ctx.reply('❌ Ошибка при экспорте: ' + error.message);
  }
});

// Admin: Broadcast message
bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  const message = ctx.message.text.replace('/broadcast', '').trim();

  if (!message) {
    await ctx.reply('ℹ️ Использование: /broadcast <сообщение>');
    return;
  }

  try {
    const { data: users } = await supabase
      .from('users')
      .select('telegram_id')
      .eq('is_blocked', false);

    if (!users || users.length === 0) {
      await ctx.reply('❌ Нет пользователей');
      return;
    }

    await ctx.reply(`📣 Начинаю рассылку ${users.length} пользователям...`);

    let sent = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await bot.api.sendMessage(user.telegram_id, `📢 Сообщение от администрации:\n\n${message}`);
        sent++;
        await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
      } catch (err) {
        failed++;
        console.error(`Failed to send to ${user.telegram_id}:`, err.message);
      }
    }

    await ctx.reply(
      `✅ Рассылка завершена!\n\n` +
      `✅ Отправлено: ${sent}\n` +
      `❌ Ошибок: ${failed}`
    );
  } catch (error) {
    console.error('Error broadcasting:', error);
    await ctx.reply('❌ Ошибка при рассылке');
  }
});

// Admin: Global message with image
bot.command('global', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  const message = ctx.message.text.replace('/global', '').trim();

  if (!message) {
    await ctx.reply('ℹ️ Использование: /global <сообщение>\n\nОтправит изображение с вашим текстом и кнопкой "Start Investing" всем пользователям.');
    return;
  }

  try {
    const { data: users } = await supabase
      .from('users')
      .select('telegram_id')
      .eq('is_blocked', false);

    if (!users || users.length === 0) {
      await ctx.reply('❌ Нет пользователей');
      return;
    }

    await ctx.reply(`📣 Начинаю глобальную рассылку ${users.length} пользователям с изображением...`);

    let sent = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await bot.api.sendPhoto(
          user.telegram_id,
          'https://i.ibb.co/fz0HJqnT/20.jpg',
          {
            caption: message,
            reply_markup: {
              inline_keyboard: [
                [{ text: '🚀 Start Investing', web_app: { url: webAppUrl } }]
              ]
            }
          }
        );
        sent++;
        await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
      } catch (err) {
        failed++;
        console.error(`Failed to send to ${user.telegram_id}:`, err.message);
      }
    }

    await ctx.reply(
      `✅ Глобальная рассылка завершена!\n\n` +
      `✅ Отправлено: ${sent}\n` +
      `❌ Ошибок: ${failed}`
    );
  } catch (error) {
    console.error('Error in global broadcast:', error);
    await ctx.reply('❌ Ошибка при рассылке');
  }
});

// Admin: Stats
bot.command('stats', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  try {
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    const { count: activeInvestments } = await supabase
      .from('investments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const { data: totalInvestedData } = await supabase
      .from('investments')
      .select('amount');

    const totalInvested = totalInvestedData?.reduce((sum, inv) => sum + parseFloat(inv.amount), 0) || 0;

    const { data: balances } = await supabase
      .from('users')
      .select('balance_usdt, balance_ton, balance_sol');

    const totalBalance = balances?.reduce((sum, user) => {
      return sum + parseFloat(user.balance_usdt || 0) + parseFloat(user.balance_ton || 0) + parseFloat(user.balance_sol || 0);
    }, 0) || 0;

    await ctx.reply(
      `📊 Статистика платформы\n\n` +
      `👥 Пользователей: ${totalUsers || 0}\n` +
      `💼 Активных вкладов: ${activeInvestments || 0}\n` +
      `💰 Всего инвестировано: $${totalInvested.toFixed(2)}\n` +
      `💵 Баланс пользователей: $${totalBalance.toFixed(2)}`
    );
  } catch (error) {
    console.error('Error getting stats:', error);
    await ctx.reply('❌ Ошибка');
  }
});

// Admin: Add Referral
bot.command('addref', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length !== 2) {
      await ctx.reply(
        '❌ Неправильный формат\n\n' +
        'Использование:\n' +
        '/addref <referrer_telegram_id> <referred_telegram_id>\n\n' +
        'Пример: /addref 123456789 987654321'
      );
      return;
    }

    const [referrerTgId, referredTgId] = args.map(id => parseInt(id));

    if (isNaN(referrerTgId) || isNaN(referredTgId)) {
      await ctx.reply('❌ ID должны быть числами');
      return;
    }

    if (referrerTgId === referredTgId) {
      await ctx.reply('❌ Пользователь не может быть реферером самого себя');
      return;
    }

    const { data: referrer } = await supabase
      .from('users')
      .select('id, telegram_id, username, referrer_id')
      .eq('telegram_id', referrerTgId)
      .maybeSingle();

    const { data: referred } = await supabase
      .from('users')
      .select('id, telegram_id, username, referrer_id')
      .eq('telegram_id', referredTgId)
      .maybeSingle();

    if (!referrer) {
      await ctx.reply(`❌ Реферер с ID ${referrerTgId} не найден`);
      return;
    }

    if (!referred) {
      await ctx.reply(`❌ Реферал с ID ${referredTgId} не найден`);
      return;
    }

    if (referred.referrer_id) {
      const { data: existingReferrer } = await supabase
        .from('users')
        .select('telegram_id, username')
        .eq('id', referred.referrer_id)
        .maybeSingle();

      await ctx.reply(
        `⚠️ У пользователя @${referred.username || referredTgId} уже есть реферер: @${existingReferrer?.username || existingReferrer?.telegram_id}\n\n` +
        'Используйте /deleteref чтобы сначала удалить старую связь'
      );
      return;
    }

    let checkId = referrer.referrer_id;
    let depth = 0;
    while (checkId && depth < 10) {
      if (checkId === referred.id) {
        await ctx.reply('❌ Обнаружена циклическая реферальная связь');
        return;
      }
      const { data: parent } = await supabase
        .from('users')
        .select('referrer_id')
        .eq('id', checkId)
        .maybeSingle();
      checkId = parent?.referrer_id;
      depth++;
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ referrer_id: referrer.id })
      .eq('id', referred.id);

    if (updateError) throw updateError;

    const buildReferralChain = async (userId, level = 1) => {
      if (level > 3) return;

      const { data: parent } = await supabase
        .from('users')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (!parent) return;

      const { data: existingRef } = await supabase
        .from('referrals')
        .select('id')
        .eq('referrer_id', parent.id)
        .eq('referred_id', referred.id)
        .eq('level', level)
        .maybeSingle();

      if (!existingRef) {
        await supabase
          .from('referrals')
          .insert({
            referrer_id: parent.id,
            referred_id: referred.id,
            level: level,
            is_active: true
          });
      }

      const { data: grandparent } = await supabase
        .from('users')
        .select('referrer_id')
        .eq('id', parent.id)
        .maybeSingle();

      if (grandparent?.referrer_id) {
        await buildReferralChain(grandparent.referrer_id, level + 1);
      }
    };

    await buildReferralChain(referrer.id);

    await ctx.reply(
      `✅ Реферальная связь создана!\n\n` +
      `👤 Реферер: @${referrer.username || referrerTgId}\n` +
      `👥 Реферал: @${referred.username || referredTgId}`
    );

  } catch (error) {
    console.error('Error adding referral:', error);
    await ctx.reply('❌ Ошибка при добавлении реферала: ' + error.message);
  }
});

// Admin: Delete Referral
bot.command('deleteref', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length !== 1) {
      await ctx.reply(
        '❌ Неправильный формат\n\n' +
        'Использование:\n' +
        '/deleteref <referred_telegram_id>\n\n' +
        'Пример: /deleteref 987654321\n\n' +
        'Это удалит реферальную связь для указанного пользователя'
      );
      return;
    }

    const referredTgId = parseInt(args[0]);

    if (isNaN(referredTgId)) {
      await ctx.reply('❌ ID должен быть числом');
      return;
    }

    const { data: referred } = await supabase
      .from('users')
      .select('id, telegram_id, username, referrer_id')
      .eq('telegram_id', referredTgId)
      .maybeSingle();

    if (!referred) {
      await ctx.reply(`❌ Пользователь с ID ${referredTgId} не найден`);
      return;
    }

    if (!referred.referrer_id) {
      await ctx.reply(`⚠️ У пользователя @${referred.username || referredTgId} нет реферера`);
      return;
    }

    const { data: referrer } = await supabase
      .from('users')
      .select('telegram_id, username')
      .eq('id', referred.referrer_id)
      .maybeSingle();

    const { error: deleteRefError } = await supabase
      .from('referrals')
      .delete()
      .eq('referred_id', referred.id);

    if (deleteRefError) throw deleteRefError;

    const { error: updateError } = await supabase
      .from('users')
      .update({ referrer_id: null })
      .eq('id', referred.id);

    if (updateError) throw updateError;

    await ctx.reply(
      `✅ Реферальная связь удалена!\n\n` +
      `👤 Реферер был: @${referrer?.username || referrer?.telegram_id}\n` +
      `👥 Реферал: @${referred.username || referredTgId}`
    );

  } catch (error) {
    console.error('Error deleting referral:', error);
    await ctx.reply('❌ Ошибка при удалении реферала: ' + error.message);
  }
});

// Admin notification system
let lastDepositCheck = new Date();
let lastWithdrawalCheck = new Date();
let lastReferralCheck = new Date();
const notifiedDeposits = new Set();
const notifiedWithdrawals = new Set();
const notifiedReferrals = new Set();

async function checkNewDeposits() {
  try {
    console.log('🔍 Checking for new deposits...');
    const { data: deposits, error } = await supabase
      .from('deposits')
      .select('id, user_id, amount, crypto_type, status, created_at, users(telegram_id, username)')
      .in('status', ['completed', 'credited']) // 🔧 FIX: Check both completed AND credited
      .gte('created_at', lastDepositCheck.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching deposits:', error);
      return;
    }

    console.log(`📊 Found ${deposits?.length || 0} new deposits`);

    if (deposits && deposits.length > 0) {
      for (const deposit of deposits) {
        if (!notifiedDeposits.has(deposit.id)) {
          notifiedDeposits.add(deposit.id);

          const message =
            `💰 НОВЫЙ ДЕПОЗИТ\n\n` +
            `👤 User: @${deposit.users?.username || deposit.users?.telegram_id || 'Unknown'}\n` +
            `🆔 TG ID: ${deposit.users?.telegram_id || 'N/A'}\n` +
            `💵 Сумма: ${parseFloat(deposit.amount).toFixed(2)} ${deposit.crypto_type}\n` +
            `🕐 Время: ${new Date(deposit.created_at).toLocaleString('ru-RU')}`;

          console.log(`📤 Sending deposit notification to ${ADMIN_IDS.length} admins...`);

          for (const adminId of ADMIN_IDS) {
            try {
              await bot.api.sendMessage(adminId, message);
              console.log(`✅ Notified admin ${adminId}`);
            } catch (err) {
              console.error(`❌ Failed to notify admin ${adminId}:`, err.message);
            }
          }
        }
      }
    }

    lastDepositCheck = new Date();
  } catch (error) {
    console.error('Error checking deposits:', error);
  }
}

async function checkNewReferrals() {
  try {
    const { data: referrals } = await supabase
      .from('referrals')
      .select(`
        id,
        level,
        created_at,
        referrer:users!referrals_referrer_id_fkey(telegram_id, username, first_name, language_preference),
        referred:users!referrals_referred_id_fkey(telegram_id, username, first_name)
      `)
      .gte('created_at', lastReferralCheck.toISOString())
      .eq('level', 1)
      .order('created_at', { ascending: false });

    if (referrals && referrals.length > 0) {
      for (const ref of referrals) {
        if (!notifiedReferrals.has(ref.id)) {
          notifiedReferrals.add(ref.id);

          const referredName = ref.referred?.username
            ? `@${ref.referred.username}`
            : (ref.referred?.first_name || 'Unknown');

          const lang = ref.referrer?.language_preference || 'en';

          let message = '';
          if (lang === 'ru') {
            message =
              `🎉 НОВЫЙ РЕФЕРАЛ!\n\n` +
              `👤 Пользователь ${referredName} присоединился по вашей ссылке!\n` +
              `📊 Уровень: 1\n` +
              `💰 Вы будете получать 15% от их прибыли\n\n` +
              `Используйте /referral чтобы посмотреть всех рефералов`;
          } else if (lang === 'es') {
            message =
              `🎉 NUEVO REFERIDO!\n\n` +
              `👤 Usuario ${referredName} se unió por tu enlace!\n` +
              `📊 Nivel: 1\n` +
              `💰 Recibirás 15% de sus ganancias\n\n` +
              `Usa /referral para ver todos tus referidos`;
          } else {
            message =
              `🎉 NEW REFERRAL!\n\n` +
              `👤 User ${referredName} joined via your link!\n` +
              `📊 Level: 1\n` +
              `💰 You'll earn 15% from their profits\n\n` +
              `Use /referral to see all your referrals`;
          }

          try {
            await bot.api.sendMessage(ref.referrer.telegram_id, message);
          } catch (err) {
            console.error(`Failed to notify referrer ${ref.referrer.telegram_id}:`, err.message);
          }
        }
      }
    }

    lastReferralCheck = new Date();
  } catch (error) {
    console.error('Error checking referrals:', error);
  }
}

async function checkNewWithdrawals() {
  try {
    console.log('🔍 Checking for new withdrawals...');
    const { data: withdrawals, error } = await supabase
      .from('withdrawals')
      .select('id, user_id, amount, crypto_type, status, wallet_address, memo, created_at, users(telegram_id, username)')
      .eq('status', 'pending')
      .gte('created_at', lastWithdrawalCheck.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching withdrawals:', error);
      return;
    }

    console.log(`📊 Found ${withdrawals?.length || 0} new withdrawals`);

    if (withdrawals && withdrawals.length > 0) {
      for (const withdrawal of withdrawals) {
        if (!notifiedWithdrawals.has(withdrawal.id)) {
          notifiedWithdrawals.add(withdrawal.id);

          const message =
            `🔔 НОВЫЙ ЗАПРОС НА ВЫВОД\n\n` +
            `👤 User: @${withdrawal.users?.username || withdrawal.users?.telegram_id || 'Unknown'}\n` +
            `🆔 ID: ${withdrawal.users?.telegram_id || 'N/A'}\n` +
            `💵 Сумма: ${parseFloat(withdrawal.amount).toFixed(2)} ${withdrawal.crypto_type}\n` +
            `📍 Адрес: ${withdrawal.wallet_address || 'N/A'}\n` +
            `${withdrawal.memo ? `📝 Memo: ${withdrawal.memo}\n` : ''}` +
            `🕐 Время: ${new Date(withdrawal.created_at).toLocaleString('ru-RU')}\n\n` +
            `⚠️ Требуется одобрение в админ панели`;

          console.log(`📤 Sending withdrawal notification to ${ADMIN_IDS.length} admins...`);

          for (const adminId of ADMIN_IDS) {
            try {
              await bot.api.sendMessage(adminId, message);
              console.log(`✅ Notified admin ${adminId}`);
            } catch (err) {
              console.error(`❌ Failed to notify admin ${adminId}:`, err.message);
            }
          }
        }
      }
    }

    lastWithdrawalCheck = new Date();
  } catch (error) {
    console.error('Error checking withdrawals:', error);
  }
}

// Track processed withdrawal status changes
const notifiedWithdrawalStatuses = new Set();
let lastWithdrawalStatusCheck = new Date();

async function checkWithdrawalStatusChanges() {
  try {
    console.log('🔍 Checking for withdrawal status changes...');
    const { data: withdrawals, error } = await supabase
      .from('withdrawals')
      .select('id, user_id, amount, crypto_type, status, updated_at, users(telegram_id, username, language_preference)')
      .in('status', ['approved', 'rejected'])
      .gte('updated_at', lastWithdrawalStatusCheck.toISOString())
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching withdrawal status changes:', error);
      return;
    }

    console.log(`📊 Found ${withdrawals?.length || 0} status changes`);

    if (withdrawals && withdrawals.length > 0) {
      for (const withdrawal of withdrawals) {
        const statusKey = `${withdrawal.id}_${withdrawal.status}`;
        if (!notifiedWithdrawalStatuses.has(statusKey)) {
          notifiedWithdrawalStatuses.add(statusKey);

          const lang = withdrawal.users?.language_preference || 'en';
          const telegramId = withdrawal.users?.telegram_id;

          console.log(`📤 Notifying user ${telegramId} about ${withdrawal.status} withdrawal`);

          if (!telegramId) {
            console.log('⚠️ No telegram_id, skipping');
            continue;
          }

          const supportChat = 'https://t.me/+g4OtjKatTIQ1MWQ0';
          let message = '';
          if (withdrawal.status === 'approved') {
            if (lang === 'ru') {
              message =
                `✅ ВАШ ВЫВОД ОТПРАВЛЕН\n\n` +
                `💵 Ваша заявка в размере ${parseFloat(withdrawal.amount).toFixed(4)} ${withdrawal.crypto_type} была успешно отправлена вам на кошелек.\n\n` +
                `Пожалуйста проверьте зачисление и поделитесь отзывом о выплате в этом чате: ${supportChat}\n` +
                `Большое спасибо за доверие! 🙏`;
            } else if (lang === 'es') {
              message =
                `✅ RETIRO ENVIADO\n\n` +
                `💵 Tu solicitud de ${parseFloat(withdrawal.amount).toFixed(4)} ${withdrawal.crypto_type} ha sido enviada a tu billetera.\n\n` +
                `Por favor verifica y comparte tu opinión en este chat: ${supportChat}\n` +
                `¡Muchas gracias por tu confianza! 🙏`;
            } else {
              message =
                `✅ WITHDRAWAL SENT\n\n` +
                `💵 Your request for ${parseFloat(withdrawal.amount).toFixed(4)} ${withdrawal.crypto_type} has been sent to your wallet.\n\n` +
                `Please check and share your feedback in this chat: ${supportChat}\n` +
                `Thank you for your trust! 🙏`;
            }
          } else if (withdrawal.status === 'rejected') {
            if (lang === 'ru') {
              message =
                `❌ ВЫВОД ОТКЛОНЕН\n\n` +
                `💵 Ваша заявка в размере ${parseFloat(withdrawal.amount).toFixed(4)} ${withdrawal.crypto_type} была отклонена.\n\n` +
                `Средства возвращены на ваш баланс.\n` +
                `Свяжитесь с поддержкой для уточнений: ${supportChat}`;
            } else if (lang === 'es') {
              message =
                `❌ RETIRO RECHAZADO\n\n` +
                `💵 Tu solicitud de ${parseFloat(withdrawal.amount).toFixed(4)} ${withdrawal.crypto_type} ha sido rechazada.\n\n` +
                `Los fondos han sido devueltos a tu saldo.\n` +
                `Contacta con soporte: ${supportChat}`;
            } else {
              message =
                `❌ WITHDRAWAL REJECTED\n\n` +
                `💵 Your withdrawal request for ${parseFloat(withdrawal.amount).toFixed(4)} ${withdrawal.crypto_type} has been rejected.\n\n` +
                `Funds have been returned to your balance.\n` +
                `Contact support: ${supportChat}`;
            }
          }

          try {
            await bot.api.sendMessage(telegramId, message);
            console.log(`✅ Notified user ${telegramId} about ${withdrawal.status}`);
          } catch (err) {
            console.error(`❌ Failed to notify user ${telegramId} about withdrawal ${withdrawal.status}:`, err.message);
          }
        }
      }
    }

    lastWithdrawalStatusCheck = new Date();
  } catch (error) {
    console.error('Error checking withdrawal status changes:', error);
  }
}

// Start monitoring (will be called from server.js after bot starts)
export function startAdminNotifications() {
  console.log('📢 Starting admin notification system...');

  // POLLING DISABLED - Using database triggers instead!
  // Database triggers fire immediately on INSERT/UPDATE
  // No need for 30-second polling intervals

  // setInterval(checkNewDeposits, 30000);  // DISABLED - using notify_deposit_changes trigger
  // setInterval(checkNewWithdrawals, 30000);  // DISABLED - using notify_withdrawal_changes trigger
  // setInterval(checkNewReferrals, 30000);  // DISABLED - using notify_new_referral trigger
  // setInterval(checkWithdrawalStatusChanges, 30000);  // DISABLED - using notify_withdrawal_changes trigger

  // setTimeout(checkNewDeposits, 5000);  // DISABLED
  // setTimeout(checkNewWithdrawals, 5000);  // DISABLED
  // setTimeout(checkNewReferrals, 5000);  // DISABLED
  // setTimeout(checkWithdrawalStatusChanges, 5000);  // DISABLED

  console.log('✅ Admin notifications enabled via database triggers (instant, no polling)');
}

bot.catch((err) => {
  console.error('Bot error:', err);
});

// Don't auto-start bot - let server.js handle it
// This prevents multiple instances on Render restarts
export default bot;

import { Bot, InputFile } from 'grammy';
import dotenv from 'dotenv';
import { supabase } from '../db/supabase.js';
import { investmentService } from '../services/investmentService.js';
import { pnlService } from '../services/pnlService.js';
import { exportService } from '../services/exportService.js';

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
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', userId)
      .maybeSingle();

    if (!user) {
      let referrerId = null;

      if (startPayload && startPayload.startsWith('ref_')) {
        const referralCode = startPayload.replace('ref_', '');
        const { data: referrer } = await supabase
          .from('users')
          .select('id')
          .eq('referral_code', referralCode)
          .single();

        if (referrer) {
          referrerId = referrer.id;
        }
      }

      const { data: newUser } = await supabase
        .from('users')
        .insert({
          telegram_id: userId,
          username: username || `user${userId}`,
          first_name: firstName || 'User',
          referrer_id: referrerId,
          balance_usdt: 0,
          balance_ton: 0,
          balance_sol: 0,
        })
        .select()
        .single();

      user = newUser;

      if (referrerId) {
        await supabase.rpc('build_referral_hierarchy', {
          user_id: newUser.id,
          new_referrer_id: referrerId
        });

        await ctx.reply(`✅ You've been referred! Your referrer will earn commissions from your investments.`);
      }

      console.log(`✅ New user registered: ${userId} (${username || 'no username'})`);
    }

    await ctx.reply(
      `👋 Welcome${firstName ? ' ' + firstName : ''}!\n\n` +
        `💎 Your crypto investment platform is ready!\n\n` +
        `Available Commands:\n` +
        `/balance - Check your balances\n` +
        `/invest - View investment plans\n` +
        `/myinvest - View your investments\n` +
        `/pnl - View profit & loss\n` +
        `/referral - Your referral info\n\n` +
        `Use the Web App for full features! 🚀`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Start Investing', web_app: { url: webAppUrl } }],
            [{ text: '💰 Balance', callback_data: 'check_balance' }],
            [{ text: '💬 Support', url: 'https://t.me/hashdev_support' }],
          ],
        },
      }
    );
  } catch (error) {
    console.error('Error in /start:', error);
    await ctx.reply('❌ Sorry, there was an error. Please try again later.');
  }
});

bot.command('balance', async (ctx) => {
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
      `🔥 Новостной Канал: @hashdev_bot"\n` +
      `💬 Чат Сообщества: @hashdev_bot`;

    await ctx.reply(message);
  } catch (error) {
    console.error('Error loading PNL:', error);
    await ctx.reply('❌ Ошибка загрузки данных');
  }
});

bot.command('referral', async (ctx) => {
  const userId = ctx.from.id;

  try {
    const { data: user } = await supabase
      .from('users')
      .select('referral_code, id')
      .eq('telegram_id', userId)
      .single();

    const { data: refs } = await supabase
      .from('referrals')
      .select('level')
      .eq('referrer_id', user.id)
      .eq('is_active', true);

    const { data: earnings } = await supabase
      .from('referral_earnings')
      .select('level, amount')
      .eq('referrer_id', user.id);

    const level1 = refs?.filter(r => r.level === 1).length || 0;
    const level2 = refs?.filter(r => r.level === 2).length || 0;
    const level3 = refs?.filter(r => r.level === 3).length || 0;

    const level1Earnings = earnings?.filter(e => e.level === 1).reduce((s, e) => s + parseFloat(e.amount), 0) || 0;
    const level2Earnings = earnings?.filter(e => e.level === 2).reduce((s, e) => s + parseFloat(e.amount), 0) || 0;
    const level3Earnings = earnings?.filter(e => e.level === 3).reduce((s, e) => s + parseFloat(e.amount), 0) || 0;

    const botUsername = ctx.me.username;
    const referralLink = `https://t.me/${botUsername}?start=ref_${user.referral_code}`;

    const message =
      `👥 Referral Program\n\n` +
      `🔗 Your Referral Link:\n${referralLink}\n\n` +
      `📊 Your Stats:\n` +
      `  Level 1: ${level1} refs (5% commission)\n` +
      `  Level 2: ${level2} refs (3% commission)\n` +
      `  Level 3: ${level3} refs (1% commission)\n\n` +
      `💰 Total Earnings:\n` +
      `  Level 1: ${level1Earnings.toFixed(2)} USDT\n` +
      `  Level 2: ${level2Earnings.toFixed(2)} USDT\n` +
      `  Level 3: ${level3Earnings.toFixed(2)} USDT\n` +
      `  Total: ${(level1Earnings + level2Earnings + level3Earnings).toFixed(2)} USDT`;

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
        photo_url: 'https://i.ibb.co/sJ1jwkk4/invite.jpg',
        thumbnail_url: 'https://i.ibb.co/sJ1jwkk4/invite.jpg',
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
        photo_url: 'https://i.ibb.co/sJ1jwkk4/invite.jpg',
        thumbnail_url: 'https://i.ibb.co/sJ1jwkk4/invite.jpg',
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

const isAdmin = (userId) => ADMIN_IDS.includes(userId);

// Admin: Add balance to user
bot.command('addbalance', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ У вас нет прав администратора');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 4) {
    await ctx.reply('ℹ️ Использование: /addbalance <telegram_id> <crypto_type> <amount>\nПример: /addbalance 123456789 USDT 100');
    return;
  }

  const [, telegramId, cryptoType, amountStr] = args;
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Неверная сумма');
    return;
  }

  if (!['USDT', 'TON', 'SOL'].includes(cryptoType.toUpperCase())) {
    await ctx.reply('❌ Неверный тип криптовалюты. Используйте: USDT, TON, или SOL');
    return;
  }

  try {
    const columnName = `balance_${cryptoType.toLowerCase()}`;

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
      `💰 ${cryptoType}: ${currentBalance.toFixed(4)} → ${newBalance.toFixed(4)}\n` +
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
    await ctx.reply('ℹ️ Использование: /removebalance <telegram_id> <crypto_type> <amount>\nПример: /removebalance 123456789 USDT 50');
    return;
  }

  const [, telegramId, cryptoType, amountStr] = args;
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Неверная сумма');
    return;
  }

  if (!['USDT', 'TON', 'SOL'].includes(cryptoType.toUpperCase())) {
    await ctx.reply('❌ Неверный тип криптовалюты');
    return;
  }

  try {
    const columnName = `balance_${cryptoType.toLowerCase()}`;

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
      `💰 ${cryptoType}: ${currentBalance.toFixed(4)} → ${newBalance.toFixed(4)}\n` +
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

    const { data: investments } = await supabase
      .from('investments')
      .select('*')
      .eq('user_id', user.id);

    const activeInv = investments?.filter(i => i.status === 'active').length || 0;
    const completedInv = investments?.filter(i => i.status === 'completed').length || 0;

    await ctx.reply(
      `👤 Информация о пользователе\n\n` +
      `ID: ${user.id}\n` +
      `Telegram ID: ${user.telegram_id}\n` +
      `Username: @${user.username || 'нет'}\n` +
      `Имя: ${user.first_name || 'нет'}\n\n` +
      `💰 Балансы:\n` +
      `USDT: ${parseFloat(user.balance_usdt || 0).toFixed(2)}\n` +
      `TON: ${parseFloat(user.balance_ton || 0).toFixed(4)}\n` +
      `SOL: ${parseFloat(user.balance_sol || 0).toFixed(4)}\n\n` +
      `📊 Вклады:\n` +
      `Активные: ${activeInv}\n` +
      `Завершенные: ${completedInv}\n\n` +
      `📅 Регистрация: ${new Date(user.created_at).toLocaleString('ru-RU')}`
    );
  } catch (error) {
    console.error('Error getting user info:', error);
    await ctx.reply('❌ Ошибка');
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

    await ctx.reply('📊 Экспортирую данные пользователей...');

    let users = [];
    let exportType = '';

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

      default:
        await ctx.reply(
          '❌ Неизвестная команда. Используйте /exportusers help для справки',
          { parse_mode: 'Markdown' }
        );
        return;
    }

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
          'https://i.ibb.co/sJ1jwkk4/invite.jpg',
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

bot.catch((err) => {
  console.error('Bot error:', err);
});

// Don't auto-start bot - let server.js handle it
// This prevents multiple instances on Render restarts
export default bot;

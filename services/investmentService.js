import { supabase } from '../db/supabase.js';
import { nanoid } from 'nanoid';

// Helper function to get aggregated balance for USDT/USDC across all networks
// NOTE: balance_usdt and balance_usdc are now auto-aggregated by DB trigger!
function getAggregatedBalance(user, cryptoType) {
  cryptoType = cryptoType.toUpperCase();

  if (cryptoType === 'USDT') {
    // balance_usdt is already aggregated by trigger - just read it!
    return parseFloat(user.balance_usdt || 0);
  } else if (cryptoType === 'USDC') {
    // balance_usdc is already aggregated by trigger - just read it!
    return parseFloat(user.balance_usdc || 0);
  } else {
    // Other cryptos have only one balance column
    const cryptoColumn = `balance_${cryptoType.toLowerCase()}`;
    return parseFloat(user[cryptoColumn] || 0);
  }
}

// Helper function to deduct from the highest network balance available
async function deductFromBalance(userId, cryptoType, amount) {
  cryptoType = cryptoType.toUpperCase();

  console.log(`\n🔵 DEDUCT BALANCE CALLED: User ${userId}, ${amount} ${cryptoType}`);

  // Get fresh user data
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (!user) throw new Error('User not found');

  console.log(`📊 Current balances for ${cryptoType}:`, {
    usdc: user.balance_usdc,
    usdcerc: user.balance_usdcerc,
    usdcbep: user.balance_usdcbep,
    usdt: user.balance_usdt,
    usdtbep: user.balance_usdtbep,
    usdterc: user.balance_usdterc,
    usdttrc: user.balance_usdttrc,
    usdtton: user.balance_usdtton
  });

  let remainingAmount = amount;
  const updates = {};

  if (cryptoType === 'USDT') {
    // Deduct from USDT networks in priority order (BEP > TRC > ERC > TON)
    const networks = [
      { col: 'balance_usdtbep', val: parseFloat(user.balance_usdtbep || 0) },
      { col: 'balance_usdttrc', val: parseFloat(user.balance_usdttrc || 0) },
      { col: 'balance_usdterc', val: parseFloat(user.balance_usdterc || 0) },
      { col: 'balance_usdtton', val: parseFloat(user.balance_usdtton || 0) }
    ];

    console.log(`🔍 USDT Network balances:`, networks);

    for (const network of networks) {
      if (remainingAmount <= 0) break;
      if (network.val > 0) {
        const deductAmount = Math.min(network.val, remainingAmount);
        updates[network.col] = network.val - deductAmount;
        remainingAmount -= deductAmount;
        console.log(`  ✂️  Deducting ${deductAmount} from ${network.col}: ${network.val} → ${updates[network.col]}`);
      } else {
        console.log(`  ⚠️  Skipping ${network.col} (balance is 0)`);
      }
    }

    console.log(`💰 Remaining amount after USDT deduction: ${remainingAmount}`);

    // CRITICAL FIX: If network balances are 0 but balance_usdt has money, put it in BEP as default
    if (remainingAmount > 0 && parseFloat(user.balance_usdt || 0) >= amount) {
      console.log(`⚠️  NETWORK BALANCES ARE ZERO BUT balance_usdt HAS FUNDS!`);
      console.log(`🔧 APPLYING EMERGENCY FIX: Moving funds to balance_usdtbep`);

      // Set the primary network balance to handle this
      updates.balance_usdtbep = parseFloat(user.balance_usdt || 0) - amount;
      remainingAmount = 0;

      console.log(`  ✅ Set balance_usdtbep to ${updates.balance_usdtbep}`);
    }

    // NOTE: balance_usdt will be auto-calculated by the DB trigger!
  } else if (cryptoType === 'USDC') {
    // Deduct from USDC networks in priority order (ERC > BEP)
    const networks = [
      { col: 'balance_usdcerc', val: parseFloat(user.balance_usdcerc || 0) },
      { col: 'balance_usdcbep', val: parseFloat(user.balance_usdcbep || 0) }
    ];

    console.log(`🔍 USDC Network balances:`, networks);

    for (const network of networks) {
      if (remainingAmount <= 0) break;
      if (network.val > 0) {
        const deductAmount = Math.min(network.val, remainingAmount);
        updates[network.col] = network.val - deductAmount;
        remainingAmount -= deductAmount;
        console.log(`  ✂️  Deducting ${deductAmount} from ${network.col}: ${network.val} → ${updates[network.col]}`);
      } else {
        console.log(`  ⚠️  Skipping ${network.col} (balance is 0)`);
      }
    }

    console.log(`💰 Remaining amount after USDC deduction: ${remainingAmount}`);

    // CRITICAL FIX: If network balances are 0 but balance_usdc has money, put it in ERC as default
    if (remainingAmount > 0 && parseFloat(user.balance_usdc || 0) >= amount) {
      console.log(`⚠️  NETWORK BALANCES ARE ZERO BUT balance_usdc HAS FUNDS!`);
      console.log(`🔧 APPLYING EMERGENCY FIX: Moving funds to balance_usdcerc`);

      // Set the primary network balance to handle this
      updates.balance_usdcerc = parseFloat(user.balance_usdc || 0) - amount;
      remainingAmount = 0;

      console.log(`  ✅ Set balance_usdcerc to ${updates.balance_usdcerc}`);
    }

    // NOTE: balance_usdc will be auto-calculated by the DB trigger!
  } else {
    // Other cryptos - single balance column
    const cryptoColumn = `balance_${cryptoType.toLowerCase()}`;
    const currentBalance = parseFloat(user[cryptoColumn] || 0);
    updates[cryptoColumn] = currentBalance - amount;
  }

  // Apply updates
  if (Object.keys(updates).length > 0) {
    console.log(`🔥 DEDUCTING FROM USER ${userId}:`, JSON.stringify(updates, null, 2));

    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (error) {
      console.error(`❌ DEDUCTION FAILED:`, error);
      throw error;
    }

    console.log(`✅ DEDUCTION SUCCESS for user ${userId}`);
  } else {
    console.warn(`⚠️  NO UPDATES TO APPLY! User ${userId}, crypto ${cryptoType}, amount ${amount}`);
  }

  return updates;
}

export const investmentService = {
  async getPlans() {
    const { data: plans } = await supabase
      .from('investment_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    return plans || [];
  },

  async createInvestment(telegramId, planId, amount, cryptoType = 'USDT') {
    const { data: user } = await supabase
      .from('users')
      .select('*, referrer_id')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    if (!user) throw new Error('User not found');

    const { data: plan } = await supabase
      .from('investment_plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (!plan) throw new Error('Plan not found');

    if (amount < parseFloat(plan.min_amount) || amount > parseFloat(plan.max_amount)) {
      throw new Error(`Amount must be between ${plan.min_amount} and ${plan.max_amount} ${cryptoType}`);
    }

    // Get aggregated balance across all networks for USDT/USDC
    const userBalance = getAggregatedBalance(user, cryptoType);

    if (userBalance < amount) {
      throw new Error(`Insufficient balance. You have ${userBalance.toFixed(4)} ${cryptoType}`);
    }

    const returnAmount = amount * (1 + (parseFloat(plan.daily_return) / 100));
    const uniqueCode = nanoid(10).toUpperCase();
    const startTime = new Date();
    const endTime = new Date();

    if (plan.duration_hours > 0) {
      endTime.setHours(endTime.getHours() + plan.duration_hours);
    } else {
      endTime.setFullYear(endTime.getFullYear() + 100);
    }

    // CRITICAL: Track which network will actually be deducted from
    // We need to match the deduction logic in deductFromBalance()
    let paymentCrypto = cryptoType;
    if (cryptoType === 'USDT') {
      // Match the deduction priority: BEP > TRC > ERC > TON
      const usdtbep = parseFloat(user.balance_usdtbep || 0);
      const usdttrc = parseFloat(user.balance_usdttrc || 0);
      const usdterc = parseFloat(user.balance_usdterc || 0);
      const usdtton = parseFloat(user.balance_usdtton || 0);

      // Use the FIRST network with sufficient balance (matches deduction logic)
      if (usdtbep >= amount) {
        paymentCrypto = 'USDTBEP';
      } else if (usdtbep + usdttrc >= amount) {
        // Will deduct from both, but return to primary (BEP)
        paymentCrypto = 'USDTBEP';
      } else if (usdtbep + usdttrc + usdterc >= amount) {
        paymentCrypto = 'USDTBEP';
      } else {
        paymentCrypto = 'USDTBEP'; // Default
      }
      console.log(`💡 USDT investment will use ${paymentCrypto} for returns (BEP: ${usdtbep}, TRC: ${usdttrc}, ERC: ${usdterc}, TON: ${usdtton})`);
    } else if (cryptoType === 'USDC') {
      // Match the deduction priority: ERC > BEP
      const usdcerc = parseFloat(user.balance_usdcerc || 0);
      const usdcbep = parseFloat(user.balance_usdcbep || 0);

      paymentCrypto = (usdcerc >= amount || usdcerc > 0) ? 'USDCERC' : 'USDCBEP';
      console.log(`💡 USDC investment will use ${paymentCrypto} for returns (ERC: ${usdcerc}, BEP: ${usdcbep})`);
    }

    const { data: investment, error: invError } = await supabase
      .from('investments')
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        unique_code: uniqueCode,
        amount,
        return_amount: returnAmount,
        status: 'active',
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        crypto_type: cryptoType,
        payment_crypto: paymentCrypto, // Store the actual network used
        accumulated_profit: 0,
        last_claim_time: null,
      })
      .select()
      .single();

    if (invError) throw invError;

    // Deduct amount from user's balance (smart deduction across networks)
    // Use the generic cryptoType so it deducts from all networks smartly
    await deductFromBalance(user.id, cryptoType, amount);

    await supabase.from('operation_history').insert({
      user_id: user.id,
      operation_type: 'investment',
      amount: amount,
      crypto_type: cryptoType,
      investment_id: investment.id,
      description: `Investment in ${plan.name}: ${amount} ${cryptoType}`,
      status: 'completed',
      metadata: {
        investment_id: investment.id,
        plan_name: plan.name,
        duration_hours: plan.duration_hours
      },
    });

    // NOTE: Referral commissions are NO LONGER distributed on investment creation
    // They are now distributed when profits are claimed (see claimProfit function)
    // This ensures commissions are based on actual PROFIT, not investment volume

    return {
      ...investment,
      plan: plan,
    };
  },

  async distributeReferralCommissions(userId, amount, cryptoType, investmentId) {
    // DEPRECATED: This function no longer distributes commissions
    // See distributeReferralProfitCommissions() which is called when profits are claimed
    console.log('⚠️  distributeReferralCommissions is deprecated - commissions now profit-based');
    return;
  },

  async distributeReferralProfitCommissions(userId, profitAmount, cryptoType, investmentId) {
    console.log('\n💰 DISTRIBUTING PROFIT-BASED COMMISSIONS');
    console.log(`   User ID: ${userId}`);
    console.log(`   Profit: ${profitAmount} ${cryptoType}`);
    console.log(`   Investment ID: ${investmentId}`);

    if (profitAmount <= 0) {
      console.log(`   ⚠️  Profit amount is ${profitAmount}, skipping...`);
      return;
    }

    const commissionRates = { 1: 0.15, 2: 0.10, 3: 0.05 }; // 15%, 10%, 5% of PROFIT

    const { data: referrals } = await supabase
      .from('referrals')
      .select('referrer_id, level')
      .eq('referred_id', userId)
      .eq('is_active', true)
      .in('level', [1, 2, 3]);

    if (!referrals || referrals.length === 0) {
      console.log('   ℹ️  No active referrals found for this user');
      return;
    }

    console.log(`   📊 Found ${referrals.length} active referral(s)`);

    // Fetch live crypto prices from CoinGecko for accurate USD conversion
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
      console.log(`   💹 Live prices fetched: TON=$${cryptoPrices.TON}, SOL=$${cryptoPrices.SOL}, BNB=$${cryptoPrices.BNB}, ETH=$${cryptoPrices.ETH}`);
    } catch (err) {
      console.error('   ⚠️  Failed to fetch live prices, using defaults:', err.message);
    }

    // Convert profit to USD
    let profitUSD = profitAmount;
    const upperCrypto = cryptoType.toUpperCase();

    if (upperCrypto.includes('USDT') || upperCrypto.includes('USDC')) {
      profitUSD = profitAmount; // Already USD
      console.log(`   💵 Profit in USD: $${profitUSD.toFixed(2)} (stablecoin)`);
    } else if (upperCrypto === 'TON') {
      profitUSD = profitAmount * cryptoPrices.TON;
      console.log(`   💵 Profit in USD: ${profitAmount} TON × $${cryptoPrices.TON} = $${profitUSD.toFixed(2)}`);
    } else if (upperCrypto === 'SOL') {
      profitUSD = profitAmount * cryptoPrices.SOL;
      console.log(`   💵 Profit in USD: ${profitAmount} SOL × $${cryptoPrices.SOL} = $${profitUSD.toFixed(2)}`);
    } else if (upperCrypto === 'BNB') {
      profitUSD = profitAmount * cryptoPrices.BNB;
      console.log(`   💵 Profit in USD: ${profitAmount} BNB × $${cryptoPrices.BNB} = $${profitUSD.toFixed(2)}`);
    } else if (upperCrypto === 'ETH') {
      profitUSD = profitAmount * cryptoPrices.ETH;
      console.log(`   💵 Profit in USD: ${profitAmount} ETH × $${cryptoPrices.ETH} = $${profitUSD.toFixed(2)}`);
    }

    // Credit in SAME crypto as the profit
    const cryptoColumnMap = {
      'USDT': 'balance_usdtbep',  // Generic USDT defaults to BEP20
      'USDC': 'balance_usdcerc',  // Generic USDC defaults to ERC20
      'USDTBEP': 'balance_usdtbep',
      'USDTERC': 'balance_usdterc',
      'USDTTRC': 'balance_usdttrc',
      'USDTTON': 'balance_usdtton',
      'USDCERC': 'balance_usdcerc',
      'USDCBEP': 'balance_usdcbep',
      'TON': 'balance_ton',
      'SOL': 'balance_sol',
      'BNB': 'balance_bnb',
      'ETH': 'balance_eth'
    };

    const targetCryptoColumn = cryptoColumnMap[upperCrypto];
    if (!targetCryptoColumn) {
      console.error(`   ❌ Unknown crypto type: ${upperCrypto} - SKIPPING REFERRAL DISTRIBUTION`);
      // Don't return - continue so claim completes
    }

    for (const ref of referrals) {
      // Skip if balance column not found
      if (!targetCryptoColumn) {
        console.error(`   ⚠️ Skipping referral commission for level ${ref.level} - no balance column`);
        continue;
      }

      // Commission in SAME crypto as profit
      const commissionAmount = profitAmount * commissionRates[ref.level];
      const commissionUSD = profitUSD * commissionRates[ref.level];

      console.log(`   💰 Level ${ref.level}: ${(commissionRates[ref.level] * 100)}% of ${profitAmount} ${upperCrypto} = ${commissionAmount.toFixed(8)} ${upperCrypto} (~$${commissionUSD.toFixed(2)})`);

      const { data: referrer } = await supabase
        .from('users')
        .select(`id, telegram_id, ${targetCryptoColumn}`)
        .eq('id', ref.referrer_id)
        .single();

      if (!referrer) {
        console.error(`   ❌ Referrer ${ref.referrer_id} not found`);
        continue;
      }

      const currentBalance = parseFloat(referrer[targetCryptoColumn] || 0);
      const newBalance = currentBalance + commissionAmount;

      console.log(`   👤 Referrer ${referrer.telegram_id}: ${currentBalance.toFixed(8)} → ${newBalance.toFixed(8)} ${upperCrypto}`);

      const { error: updateError } = await supabase
        .from('users')
        .update({ [targetCryptoColumn]: newBalance })
        .eq('id', ref.referrer_id);

      if (updateError) {
        console.error(`   ❌ Failed to update referrer balance:`, updateError);
        continue;
      }

      await supabase.from('referral_earnings').insert({
        referrer_id: ref.referrer_id,
        referred_id: userId,
        level: ref.level,
        amount: commissionAmount,
        source_investment_id: investmentId,
        crypto_type: upperCrypto,
        commission_type: 'profit',
        percentage: commissionRates[ref.level] * 100,
      });

      await supabase.from('activity_logs').insert({
        user_id: ref.referrer_id,
        activity_type: 'referral_bonus',
        amount: commissionAmount,
        crypto_type: upperCrypto,
        description: `Referral commission: ${commissionAmount.toFixed(8)} ${upperCrypto} from Level ${ref.level} referral`,
        metadata: {
          level: ref.level,
          referred_user_id: userId,
          investment_id: investmentId,
          usd_value: commissionUSD
        },
      });

      await supabase.from('notification_queue').insert({
        user_id: ref.referrer_id,
        investment_id: investmentId,
        notification_type: 'referral_bonus',
        message: `You earned ${commissionAmount.toFixed(8)} ${upperCrypto} (~$${commissionUSD.toFixed(2)}) from Level ${ref.level} referral!`,
      });

      console.log(`   ✅ Level ${ref.level}: ${commissionAmount.toFixed(8)} ${upperCrypto} credited to referrer ${referrer.telegram_id}`);
    }
  },

  async getInvestments(telegramId) {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    if (!user) throw new Error('User not found');

    const { data: investments } = await supabase
      .from('investments')
      .select(`
        *,
        investment_plans (
          id, name, emoji, daily_return, duration_hours,
          freeze_principal, claim_type, interest_rate_per_second
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const enriched = await Promise.all((investments || []).map(async (inv) => {
      const currentProfit = await this.calculateCurrentProfit(inv);
      const canClaim = await this.canClaim(inv, user.id);

      const plan = inv.investment_plans || {};
      return {
        ...inv,
        current_profit: currentProfit,
        can_claim: canClaim,
        is_matured: new Date() >= new Date(inv.end_time) && (plan.duration_hours || 0) > 0,
        // Flatten plan fields for easier frontend access
        freeze_principal: plan.freeze_principal || false,
        claim_type: plan.claim_type || 'flexible',
        interest_rate_per_second: plan.interest_rate_per_second || 0,
        duration_hours: plan.duration_hours || 0,
        daily_return: plan.daily_return || 0,
      };
    }));

    return enriched;
  },

  async calculateCurrentProfit(investment) {
    const plan = investment.investment_plans;
    const now = new Date();
    const startTime = new Date(investment.start_time);
    const endTime = new Date(investment.end_time);
    const lastClaimTime = investment.last_claim_time ? new Date(investment.last_claim_time) : startTime;

    // FROZEN INVESTMENTS: Only show profit when matured
    if (plan.freeze_principal === true) {
      const isMatured = now >= endTime;
      if (!isMatured) {
        // Not matured yet, no profit available
        return 0;
      }
      // Matured: return remaining profit (total profit - already claimed)
      const dailyReturnRate = parseFloat(plan.daily_return) / 100;
      const totalProfit = investment.amount * dailyReturnRate;
      const alreadyClaimed = parseFloat(investment.accumulated_profit || 0);
      return Math.max(0, totalProfit - alreadyClaimed);
    }

    // FLEXIBLE INVESTMENTS: Profit accrues over time since last claim
    const elapsedMs = now - lastClaimTime;

    // Calculate profit based on elapsed time relative to plan duration
    const dailyReturnRate = parseFloat(plan.daily_return) / 100;

    // Get plan duration in milliseconds
    const durationHours = plan.duration_hours || 24;
    const durationMs = durationHours * 60 * 60 * 1000;

    // Calculate progress as percentage of plan duration (0 to 1)
    const progress = Math.min(elapsedMs / durationMs, 1);

    // Profit accrues linearly from 0 to (amount * dailyReturnRate) over the duration
    const maxProfit = investment.amount * dailyReturnRate;
    const profit = maxProfit * progress;

    // For flexible investments, accumulated_profit should always be 0
    // because last_claim_time resets the calculation window
    return Math.max(0, profit);
  },

  async canClaim(investment, userId) {
    const plan = investment.investment_plans;
    const now = new Date();
    const endTime = new Date(investment.end_time);

    if (investment.status !== 'active') return false;

    // Check if investment has matured (locked investments)
    if (plan.freeze_principal === true && now >= endTime) {
      return true;
    }

    // Flexible investments
    if (plan.freeze_principal === false) {
      const { data: user } = await supabase
        .from('users')
        .select('last_flexible_claim_time')
        .eq('id', userId)
        .single();

      if (user?.last_flexible_claim_time) {
        const { data: settings } = await supabase
          .from('admin_settings')
          .select('setting_value')
          .eq('setting_key', 'claim_cooldown_minutes')
          .single();

        const cooldownMinutes = parseInt(settings?.setting_value || 5);
        const lastClaim = new Date(user.last_flexible_claim_time);
        const minutesSinceLastClaim = (now - lastClaim) / (1000 * 60);

        if (minutesSinceLastClaim < cooldownMinutes) {
          return false;
        }
      }

      const profit = await this.calculateCurrentProfit(investment);
      return profit > 0;
    }

    return false;
  },

  async claimProfit(telegramId, investmentId, claimType = 'profit') {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    if (!user) throw new Error('User not found');

    const { data: investment } = await supabase
      .from('investments')
      .select(`
        *,
        investment_plans (*)
      `)
      .eq('id', investmentId)
      .eq('user_id', user.id)
      .single();

    if (!investment) throw new Error('Investment not found');

    const plan = investment.investment_plans;
    const now = new Date();
    const endTime = new Date(investment.end_time);
    const currentProfit = await this.calculateCurrentProfit(investment);

    console.log(`\n🎯 CLAIM PROFIT CALLED:`);
    console.log(`   Investment ID: ${investmentId}`);
    console.log(`   Amount Invested: ${investment.amount}`);
    console.log(`   Crypto Type: ${investment.crypto_type}`);
    console.log(`   Payment Crypto: ${investment.payment_crypto}`);
    console.log(`   Current Profit: ${currentProfit}`);
    console.log(`   Claim Type: ${claimType}`);
    console.log(`   Last Claim Time: ${investment.last_claim_time}`);
    console.log(`   Accumulated Profit: ${investment.accumulated_profit}`);

    // CRITICAL: Use payment_crypto (specific network) instead of crypto_type (generic)
    let claimCrypto = investment.payment_crypto || investment.crypto_type;

    // Fallback mapping if payment_crypto is missing
    if (claimCrypto === 'USDT') {
      claimCrypto = 'USDTBEP'; // Default to BEP for USDT
      console.log('⚠️  payment_crypto missing, defaulting USDT → USDTBEP');
    } else if (claimCrypto === 'USDC') {
      claimCrypto = 'USDCERC'; // Default to ERC for USDC
      console.log('⚠️  payment_crypto missing, defaulting USDC → USDCERC');
    }

    const cryptoColumn = `balance_${claimCrypto.toLowerCase()}`;

    // Validate column exists
    const validColumns = [
      'balance_usdtbep', 'balance_usdterc', 'balance_usdttrc', 'balance_usdtton',
      'balance_usdcerc', 'balance_usdcbep',
      'balance_bnb', 'balance_eth', 'balance_ton', 'balance_sol'
    ];

    if (!validColumns.includes(cryptoColumn)) {
      throw new Error(`Invalid crypto type: ${claimCrypto}. Cannot claim to ${cryptoColumn}.`);
    }

    let claimedAmount = 0;
    let newStatus = investment.status;

    // Check cooldown for all claim operations
    const { data: userCheck } = await supabase
      .from('users')
      .select('last_flexible_claim_time')
      .eq('id', user.id)
      .single();

    if (userCheck?.last_flexible_claim_time) {
      const { data: settings } = await supabase
        .from('admin_settings')
        .select('setting_value')
        .eq('setting_key', 'claim_cooldown_minutes')
        .single();

      const cooldownMinutes = parseInt(settings?.setting_value || 5);
      const lastClaim = new Date(userCheck.last_flexible_claim_time);
      const minutesSinceLastClaim = (now - lastClaim) / (1000 * 60);

      if (minutesSinceLastClaim < cooldownMinutes) {
        throw new Error(`Please wait ${Math.ceil(cooldownMinutes - minutesSinceLastClaim)} more minutes before claiming again`);
      }
    }

    // FLEXIBLE INVESTMENT (freeze_principal = false) - Can claim anytime
    if (plan.freeze_principal === false) {
      if (claimType === 'principal_and_profit') {
        claimedAmount = currentProfit + parseFloat(investment.amount);
        newStatus = 'completed';
      } else {
        claimedAmount = currentProfit;
        newStatus = 'active';
      }

      await supabase
        .from('investments')
        .update({
          last_claim_time: new Date().toISOString(),
          accumulated_profit: 0,
          status: newStatus,
          completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
        })
        .eq('id', investmentId);
    }
    // LOCKED INVESTMENT (freeze_principal = true) - Must mature before claiming principal
    else {
      const isMatured = now >= endTime;

      if (claimType === 'principal_and_profit') {
        if (!isMatured) {
          const hoursRemaining = Math.ceil((endTime - now) / (1000 * 60 * 60));
          throw new Error(`Cannot close investment early. ${hoursRemaining} hours remaining.`);
        }

        claimedAmount = currentProfit + parseFloat(investment.amount);
        newStatus = 'completed';

        await supabase
          .from('investments')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', investmentId);
      } else {
        claimedAmount = currentProfit;
        newStatus = 'active';

        // CRITICAL: ADD claimed profit to accumulated_profit, don't reset!
        const newAccumulated = parseFloat(investment.accumulated_profit || 0) + currentProfit;

        await supabase
          .from('investments')
          .update({
            accumulated_profit: newAccumulated,
            last_claim_time: new Date().toISOString(),
          })
          .eq('id', investmentId);
      }
    }

    await supabase
      .from('users')
      .update({ last_flexible_claim_time: new Date().toISOString() })
      .eq('id', user.id);

    // cryptoColumn already uses claimCrypto which is the specific network
    // Get fresh balance to avoid stale data
    console.log(`\n💰 CREDITING CLAIM:`);
    console.log(`   Claimed Amount: ${claimedAmount}`);
    console.log(`   Target Column: ${cryptoColumn}`);
    console.log(`   Claim Crypto: ${claimCrypto}`);

    const { data: freshUser } = await supabase
      .from('users')
      .select(`${cryptoColumn}, balance_usdt, balance_usdtbep, balance_usdttrc, balance_usdterc, balance_usdtton`)
      .eq('id', user.id)
      .single();

    console.log(`   Current Balances:`, {
      target: freshUser[cryptoColumn],
      usdt_total: freshUser.balance_usdt,
      usdtbep: freshUser.balance_usdtbep,
      usdttrc: freshUser.balance_usdttrc,
      usdterc: freshUser.balance_usdterc,
      usdtton: freshUser.balance_usdtton
    });

    const currentBalance = parseFloat(freshUser[cryptoColumn] || 0);
    const newBalance = currentBalance + claimedAmount;

    console.log(`   ${cryptoColumn}: ${currentBalance} + ${claimedAmount} = ${newBalance}`);

    const { error: updateError } = await supabase
      .from('users')
      .update({ [cryptoColumn]: newBalance })
      .eq('id', user.id);

    if (updateError) {
      console.error(`❌ Failed to update balance:`, updateError);
      throw updateError;
    }

    console.log(`✅ Balance updated successfully!`);

    // Calculate profit and distribute referral commissions
    const actualProfit = claimType === 'principal_and_profit' ? currentProfit : claimedAmount;
    console.log(`\n📊 REFERRAL COMMISSION CHECK:`);
    console.log(`   Actual Profit: ${actualProfit}`);
    console.log(`   Claim Type: ${claimType}`);
    console.log(`   Claim Crypto: ${claimCrypto}`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Investment ID: ${investmentId}`);

    if (actualProfit > 0) {
      console.log(`\n🎁 Calling distributeReferralProfitCommissions...`);
      try {
        await this.distributeReferralProfitCommissions(user.id, actualProfit, claimCrypto, investmentId);
        console.log(`✅ Referral commissions distributed successfully!`);
      } catch (refError) {
        console.error(`❌ REFERRAL COMMISSION ERROR:`, refError);
        console.error(`   Stack:`, refError.stack);
        // Don't throw - let the claim succeed even if referral fails
      }
    } else {
      console.log(`⚠️  No profit to distribute (actualProfit = ${actualProfit})`);
    }

    await supabase.from('operation_history').insert({
      user_id: user.id,
      operation_type: 'claim',
      amount: claimedAmount,
      crypto_type: claimCrypto, // Use actual network, not generic type
      investment_id: investmentId,
      description: `Claimed ${claimedAmount.toFixed(2)} ${claimCrypto} from ${plan.name}`,
      status: 'completed',
      metadata: {
        claim_type: claimType,
        investment_id: investmentId,
        plan_name: plan.name
      },
    });

    return {
      success: true,
      claimed_amount: claimedAmount,
      new_balance: newBalance,
      investment_status: newStatus,
    };
  },

  async getInvestmentStats(telegramId) {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    if (!user) throw new Error('User not found');

    const { data: investments } = await supabase
      .from('investments')
      .select('*, investment_plans(*)')
      .eq('user_id', user.id);

    const active = investments?.filter(i => i.status === 'active') || [];
    const completed = investments?.filter(i => i.status === 'completed') || [];

    const totalInvested = active.reduce((sum, inv) => sum + parseFloat(inv.amount), 0);
    const totalClaimed = completed.reduce((sum, inv) => sum + parseFloat(inv.return_amount), 0);

    let totalCurrentProfit = 0;
    for (const inv of active) {
      const profit = await this.calculateCurrentProfit(inv);
      totalCurrentProfit += profit;
    }

    return {
      active_count: active.length,
      completed_count: completed.length,
      total_invested: totalInvested,
      total_claimed: totalClaimed,
      total_current_profit: totalCurrentProfit,
      total_return_expected: active.reduce((sum, inv) => sum + parseFloat(inv.return_amount), 0),
    };
  },

  async autoCompleteMaturedInvestments() {
    const now = new Date().toISOString();

    // Find all matured locked investments that are still active
    const { data: maturedInvestments } = await supabase
      .from('investments')
      .select(`
        *,
        investment_plans (*),
        users (*)
      `)
      .eq('status', 'active')
      .lt('end_time', now);

    if (!maturedInvestments || maturedInvestments.length === 0) {
      return { processed: 0 };
    }

    let processed = 0;

    for (const investment of maturedInvestments) {
      const plan = investment.investment_plans;

      // Only auto-complete locked investments (freeze_principal = true)
      if (plan.freeze_principal === true) {
        const user = investment.users;

        // 🚨 CRITICAL FIX: ALWAYS return principal + profit for FROZEN investments
        // accumulated_profit tracks how much profit was claimed EARLY (before maturity)
        // So: returnAmount = principal + (totalProfit - alreadyClaimedProfit)
        const principal = parseFloat(investment.amount);
        const fullReturnAmount = parseFloat(investment.return_amount);
        const totalProfit = fullReturnAmount - principal;
        const alreadyClaimedProfit = parseFloat(investment.accumulated_profit || 0);
        const remainingProfit = totalProfit - alreadyClaimedProfit;
        const returnAmount = principal + remainingProfit;

        console.log(`\n💰 Investment ${investment.unique_code} matured:`);
        console.log(`   Principal: ${principal}`);
        console.log(`   Total Profit: ${totalProfit}`);
        console.log(`   Already Claimed Profit: ${alreadyClaimedProfit}`);
        console.log(`   Remaining Profit: ${remainingProfit}`);
        console.log(`   Returning: ${returnAmount} (${principal} principal + ${remainingProfit} profit)`);

        // CRITICAL: Use payment_crypto (specific network) instead of crypto_type (generic)
        // payment_crypto = 'USDTBEP', 'USDTTRC', etc.
        // crypto_type might be generic 'USDT' which maps to balance_usdt (GENERATED COLUMN - cannot update!)
        let returnCrypto = investment.payment_crypto || investment.crypto_type;

        // Fallback mapping if payment_crypto is missing
        if (returnCrypto === 'USDT') {
          returnCrypto = 'USDTBEP'; // Default to BEP for USDT
          console.log('⚠️  payment_crypto missing, defaulting USDT → USDTBEP');
        } else if (returnCrypto === 'USDC') {
          returnCrypto = 'USDCERC'; // Default to ERC for USDC
          console.log('⚠️  payment_crypto missing, defaulting USDC → USDCERC');
        }

        const cryptoColumn = `balance_${returnCrypto.toLowerCase()}`;

        // Validate column exists
        const validColumns = [
          'balance_usdtbep', 'balance_usdterc', 'balance_usdttrc', 'balance_usdtton',
          'balance_usdcerc', 'balance_usdcbep',
          'balance_bnb', 'balance_eth', 'balance_ton', 'balance_sol'
        ];

        if (!validColumns.includes(cryptoColumn)) {
          console.error(`❌ Invalid crypto column: ${cryptoColumn} (from ${returnCrypto})`);
          console.error(`   Investment ID: ${investment.id}, payment_crypto: ${investment.payment_crypto}, crypto_type: ${investment.crypto_type}`);
          continue; // Skip this investment
        }

        console.log(`💰 Returning ${returnAmount} to ${cryptoColumn} for investment ${investment.unique_code}`);

        // Add return amount to user balance
        const newBalance = parseFloat(user[cryptoColumn] || 0) + returnAmount;
        await supabase
          .from('users')
          .update({ [cryptoColumn]: newBalance })
          .eq('id', user.id);

        // Mark investment as completed
        await supabase
          .from('investments')
          .update({
            status: 'completed',
            completed_at: now,
          })
          .eq('id', investment.id);

        // Calculate profit and distribute referral commissions
        const investedAmount = parseFloat(investment.amount);
        const profitAmount = returnAmount - investedAmount;
        if (profitAmount > 0) {
          console.log(`\n🎁 Auto-distributing referral commissions on profit: ${profitAmount} ${returnCrypto}`);
          await this.distributeReferralProfitCommissions(user.id, profitAmount, returnCrypto, investment.id);
        }

        // Log operation (use returnCrypto which is the actual network)
        await supabase.from('operation_history').insert({
          user_id: user.id,
          operation_type: 'auto_claim',
          amount: returnAmount,
          crypto_type: returnCrypto, // Use actual network, not generic type
          investment_id: investment.id,
          description: `Auto-completed matured investment: ${returnAmount} ${returnCrypto} from ${plan.name}`,
          status: 'completed',
        });

        processed++;
      }
    }

    return { processed };
  },
};

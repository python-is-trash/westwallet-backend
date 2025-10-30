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

    // Determine the specific network that will be deducted from
    // This is critical for returning funds to the correct balance column
    let paymentCrypto = cryptoType;
    if (cryptoType === 'USDT') {
      // Check which USDT network has the most balance
      const usdtbep = parseFloat(user.balance_usdtbep || 0);
      const usdterc = parseFloat(user.balance_usdterc || 0);
      const usdttrc = parseFloat(user.balance_usdttrc || 0);
      const usdtton = parseFloat(user.balance_usdtton || 0);

      // Find the network with highest balance
      const balances = [
        { network: 'USDTTRC', balance: usdttrc },
        { network: 'USDTBEP', balance: usdtbep },
        { network: 'USDTERC', balance: usdterc },
        { network: 'USDTTON', balance: usdtton },
      ];
      const maxNetwork = balances.reduce((prev, curr) => curr.balance > prev.balance ? curr : prev);
      paymentCrypto = maxNetwork.network;
      console.log(`💡 Generic USDT → Using ${paymentCrypto} (balance: ${maxNetwork.balance})`);
    } else if (cryptoType === 'USDC') {
      // Check which USDC network has the most balance
      const usdcerc = parseFloat(user.balance_usdcerc || 0);
      const usdcbep = parseFloat(user.balance_usdcbep || 0);

      paymentCrypto = usdcerc >= usdcbep ? 'USDCERC' : 'USDCBEP';
      console.log(`💡 Generic USDC → Using ${paymentCrypto}`);
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

    if (user.referrer_id) {
      // Use paymentCrypto (specific network) for commissions
      await this.distributeReferralCommissions(user.id, amount, paymentCrypto, investment.id);
    }

    return {
      ...investment,
      plan: plan,
    };
  },

  async distributeReferralCommissions(userId, amount, cryptoType, investmentId) {
    const { data: referrals } = await supabase
      .from('referrals')
      .select('referrer_id, level')
      .eq('referral_id', userId)
      .eq('is_active', true)
      .in('level', [1, 2, 3]);

    if (!referrals || referrals.length === 0) return;

    const commissionRates = { 1: 0.05, 2: 0.03, 3: 0.01 };
    const cryptoColumn = `balance_${cryptoType.toLowerCase()}`;

    for (const ref of referrals) {
      const commission = amount * commissionRates[ref.level];

      await supabase
        .from('users')
        .update({
          [cryptoColumn]: supabase.rpc('increment_balance', {
            amount: commission
          })
        })
        .eq('id', ref.referrer_id);

      await supabase.from('referral_earnings').insert({
        referrer_id: ref.referrer_id,
        referral_id: userId,
        investment_id: investmentId,
        level: ref.level,
        amount: commission,
        percentage: commissionRates[ref.level] * 100,
        crypto_type: cryptoType,
      });

      await supabase.from('notification_queue').insert({
        user_id: ref.referrer_id,
        investment_id: investmentId,
        notification_type: 'referral_bonus',
        message: `You earned ${commission.toFixed(2)} ${cryptoType} from Level ${ref.level} referral commission!`,
      });
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
    const lastClaimTime = investment.last_claim_time ? new Date(investment.last_claim_time) : startTime;

    const elapsedMs = now - lastClaimTime;
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

    const dailyReturnRate = parseFloat(plan.daily_return) / 100;
    const profit = investment.amount * dailyReturnRate * elapsedDays;
    const accumulatedProfit = parseFloat(investment.accumulated_profit || 0);

    return Math.max(0, profit + accumulatedProfit);
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

        await supabase
          .from('investments')
          .update({
            accumulated_profit: 0,
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
    const { data: freshUser } = await supabase
      .from('users')
      .select(cryptoColumn)
      .eq('id', user.id)
      .single();

    const currentBalance = parseFloat(freshUser[cryptoColumn] || 0);
    const newBalance = currentBalance + claimedAmount;

    console.log(`💰 Claiming ${claimedAmount} to ${cryptoColumn} (current: ${currentBalance}, new: ${newBalance})`);

    await supabase
      .from('users')
      .update({ [cryptoColumn]: newBalance })
      .eq('id', user.id);

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
        const returnAmount = parseFloat(investment.return_amount);

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

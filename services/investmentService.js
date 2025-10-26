import { supabase } from '../db/supabase.js';
import { nanoid } from 'nanoid';

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

    const cryptoColumn = `balance_${cryptoType.toLowerCase()}`;
    const userBalance = parseFloat(user[cryptoColumn] || 0);

    if (userBalance < amount) {
      throw new Error(`Insufficient balance. You have ${userBalance} ${cryptoType}`);
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
        accumulated_profit: 0,
        last_claim_time: null,
      })
      .select()
      .single();

    if (invError) throw invError;

    await supabase
      .from('users')
      .update({ [cryptoColumn]: userBalance - amount })
      .eq('id', user.id);

    await supabase.from('operation_history').insert({
      user_id: user.id,
      operation_type: 'investment',
      amount: amount,
      crypto_type: cryptoType,
      investment_id: investment.id,
      description: `Investment in ${plan.name}: ${amount} ${cryptoType}`,
      status: 'completed',
    });

    if (user.referrer_id) {
      await this.distributeReferralCommissions(user.id, amount, cryptoType, investment.id);
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
    const cryptoColumn = `balance_${investment.crypto_type.toLowerCase()}`;

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

    const newBalance = parseFloat(user[cryptoColumn] || 0) + claimedAmount;
    await supabase
      .from('users')
      .update({ [cryptoColumn]: newBalance })
      .eq('id', user.id);

    await supabase.from('operation_history').insert({
      user_id: user.id,
      operation_type: 'claim',
      amount: claimedAmount,
      crypto_type: investment.crypto_type,
      investment_id: investmentId,
      description: `Claimed ${claimedAmount.toFixed(2)} ${investment.crypto_type} from ${plan.name}`,
      status: 'completed',
      metadata: { claim_type: claimType },
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
        const cryptoColumn = `balance_${investment.crypto_type.toLowerCase()}`;
        const user = investment.users;
        const returnAmount = parseFloat(investment.return_amount);

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

        // Log operation
        await supabase.from('operation_history').insert({
          user_id: user.id,
          operation_type: 'auto_claim',
          amount: returnAmount,
          crypto_type: investment.crypto_type,
          investment_id: investment.id,
          description: `Auto-completed matured investment: ${returnAmount} ${investment.crypto_type} from ${plan.name}`,
          status: 'completed',
        });

        processed++;
      }
    }

    return { processed };
  },
};

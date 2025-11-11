import { supabase } from '../db/supabase.js';
import { nanoid } from 'nanoid';

export const userService = {
  async getOrCreate(userId) {
    // userId is telegram_id as string
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', parseInt(userId))
      .maybeSingle();

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          telegram_id: parseInt(userId),
          username: `user${userId}`,
          first_name: 'User',
          balance: 0
        })
        .select()
        .single();
      user = newUser;
    }

    return user;
  },

  async getOrCreateUser(telegramId, username, firstName) {
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', parseInt(telegramId))
      .maybeSingle();

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          telegram_id: parseInt(telegramId),
          username,
          first_name: firstName || username,
          balance: 0
        })
        .select()
        .single();
      user = newUser;
    }

    return user;
  },

  async getUser(telegramId) {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', parseInt(telegramId))
      .single();
    return user;
  },

  async getPlans() {
    const { data: plans } = await supabase
      .from('investment_plans')
      .select('*')
      .eq('is_active', true)
      .order('min_amount', { ascending: true });
    return plans || [];
  },

  async createInvestment(telegramId, planId, amount) {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    const { data: plan } = await supabase
      .from('investment_plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (!plan) throw new Error('Plan not found');

    if (amount < parseFloat(plan.min_amount) || amount > parseFloat(plan.max_amount)) {
      throw new Error(`Amount must be between ${plan.min_amount} and ${plan.max_amount} USDT`);
    }

    if (parseFloat(user.balance) < amount) {
      throw new Error(`Insufficient balance. You have ${user.balance} USDT`);
    }

    const returnAmount = amount * (1 + (parseFloat(plan.daily_return) / 100));
    const uniqueCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    const endTime = new Date();
    endTime.setHours(endTime.getHours() + plan.duration_hours);

    const { data: investment } = await supabase
      .from('investments')
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        unique_code: uniqueCode,
        amount,
        return_amount: returnAmount,
        status: 'active',
        end_time: endTime.toISOString(),
      })
      .select()
      .single();

    await supabase
      .from('users')
      .update({ balance: parseFloat(user.balance) - amount })
      .eq('id', user.id);

    await supabase.from('operation_history').insert({
      user_id: user.id,
      operation_type: 'investment',
      amount: amount,
      description: `Investment in ${plan.name}: ${amount} USDT`,
    });

    return investment;
  },

  async getInvestments(telegramId) {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    const { data: investments } = await supabase
      .from('investments')
      .select(`*, investment_plans(name, emoji, daily_return)`)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    return investments || [];
  },

  async getReferralStats(telegramId) {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    const { data: refs } = await supabase
      .from('referrals')
      .select('level')
      .eq('referrer_id', user.id)
      .eq('is_active', true);

    const level1 = refs?.filter(r => r.level === 1).length || 0;
    const level2 = refs?.filter(r => r.level === 2).length || 0;
    const level3 = refs?.filter(r => r.level === 3).length || 0;

    const { data: earnings } = await supabase
      .from('referral_earnings')
      .select('level, amount, claimed')
      .eq('referrer_id', user.id);

    const level1Earnings = earnings?.filter(e => e.level === 1).reduce((s, e) => s + parseFloat(e.amount), 0) || 0;
    const level2Earnings = earnings?.filter(e => e.level === 2).reduce((s, e) => s + parseFloat(e.amount), 0) || 0;
    const level3Earnings = earnings?.filter(e => e.level === 3).reduce((s, e) => s + parseFloat(e.amount), 0) || 0;

    // Calculate unclaimed earnings (where claimed = false)
    const unclaimedEarnings = earnings?.filter(e => e.claimed === false).reduce((s, e) => s + parseFloat(e.amount), 0) || 0;

    return {
      totalReferrals: level1 + level2 + level3,
      level1,
      level2,
      level3,
      newLast7Days: 0,
      activeLast7Days: 0,
      investmentsLast7Days: 0,
      totalEarnings: level1Earnings + level2Earnings + level3Earnings,
      level1Earnings,
      level2Earnings,
      level3Earnings,
      unclaimedEarnings,
    };
  },

  async claimReferralEarnings(telegramId) {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    if (!user) throw new Error('User not found');

    // Get all unclaimed earnings
    const { data: unclaimedEarnings } = await supabase
      .from('referral_earnings')
      .select('id, amount, crypto_type')
      .eq('referrer_id', user.id)
      .eq('claimed', false);

    if (!unclaimedEarnings || unclaimedEarnings.length === 0) {
      throw new Error('No unclaimed earnings available');
    }

    // Group by crypto_type and sum amounts
    const earningsByCrypto = {};
    unclaimedEarnings.forEach(earning => {
      const crypto = earning.crypto_type;
      if (!earningsByCrypto[crypto]) {
        earningsByCrypto[crypto] = 0;
      }
      earningsByCrypto[crypto] += parseFloat(earning.amount);
    });

    // Update user balances for each crypto type
    const { data: currentUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    const updates = {};
    for (const [crypto, amount] of Object.entries(earningsByCrypto)) {
      const cryptoColumn = `balance_${crypto.toLowerCase()}`;
      const currentBalance = parseFloat(currentUser[cryptoColumn] || 0);
      updates[cryptoColumn] = currentBalance + amount;
    }

    await supabase
      .from('users')
      .update(updates)
      .eq('id', user.id);

    // Mark all earnings as claimed
    await supabase
      .from('referral_earnings')
      .update({ claimed: true })
      .eq('referrer_id', user.id)
      .eq('claimed', false);

    // Log the operation
    const totalClaimed = Object.values(earningsByCrypto).reduce((sum, val) => sum + val, 0);
    await supabase.from('operation_history').insert({
      user_id: user.id,
      operation_type: 'referral_claim',
      amount: totalClaimed,
      description: `Claimed referral earnings`,
      status: 'completed',
      metadata: { earnings_by_crypto: earningsByCrypto },
    });

    return {
      success: true,
      claimed: earningsByCrypto,
      total: totalClaimed,
    };
  },

  async getBalance(userId) {
    const user = await this.getOrCreate(userId);
    return { balance: parseFloat(user.balance) };
  },

  async updateBalance(userId, newBalance) {
    const user = await this.getOrCreate(userId);
    await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', user.id);
  },

  async getHistory(userId) {
    const user = await this.getOrCreate(userId);
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    return transactions || [];
  },

  async getAllUsers() {
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    return users || [];
  },
};

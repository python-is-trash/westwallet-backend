import { supabase } from '../db/supabase.js';
import { userService } from './userService.js';

export const adminService = {
  async listWithdrawals() {
    const { data: withdrawals } = await supabase
      .from('withdrawals')
      .select('*, users(telegram_id, username, balance)')
      .order('created_at', { ascending: false });

    return withdrawals || [];
  },

  async approve(withdrawalId) {
    await supabase
      .from('withdrawals')
      .update({ status: 'approved' })
      .eq('id', withdrawalId);

    const { data: withdrawal } = await supabase
      .from('withdrawals')
      .select('*, users(*)')
      .eq('id', withdrawalId)
      .single();

    await supabase.from('operation_history').insert({
      user_id: withdrawal.user_id,
      operation_type: 'withdrawal_approved',
      amount: withdrawal.amount,
      description: `Withdrawal approved: ${withdrawal.amount} USDT`,
    });

    return { success: true };
  },

  async reject(withdrawalId) {
    const { data: withdrawal } = await supabase
      .from('withdrawals')
      .select('*, users(*)')
      .eq('id', withdrawalId)
      .single();

    if (!withdrawal) {
      throw new Error('Withdrawal not found');
    }

    const refundBalance = parseFloat(withdrawal.users.balance) + parseFloat(withdrawal.amount);
    await supabase
      .from('users')
      .update({ balance: refundBalance })
      .eq('id', withdrawal.user_id);

    await supabase
      .from('withdrawals')
      .update({ status: 'rejected' })
      .eq('id', withdrawalId);

    await supabase.from('operation_history').insert({
      user_id: withdrawal.user_id,
      operation_type: 'withdrawal_rejected',
      amount: withdrawal.amount,
      description: `Withdrawal rejected: ${withdrawal.amount} USDT (refunded)`,
    });

    return { success: true, refunded: withdrawal.amount };
  },

  async isAdmin(telegramId) {
    // First check if using username-based admin config
    const adminUsernames = (process.env.ADMIN_USERNAMES || '').split(',').map(u => u.trim().toLowerCase());

    if (adminUsernames.length > 0 && adminUsernames[0] !== '') {
      // Get user's username from database
      const { data: user } = await supabase
        .from('users')
        .select('username')
        .eq('telegram_id', parseInt(telegramId))
        .maybeSingle();

      if (user && user.username) {
        return adminUsernames.includes(user.username.toLowerCase());
      }
    }

    // Fallback to ID-based check
    const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => id.trim());
    return adminIds.includes(telegramId.toString());
  },
};

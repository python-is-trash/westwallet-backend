import { supabase } from '../db/supabase.js';
import { nanoid } from 'nanoid';
import { userService } from './userService.js';

export const withdrawalService = {
  async request(userId, amount, address = '') {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', parseInt(userId))
      .single();

    if (!user) throw new Error('User not found');

    if (parseFloat(user.balance) < amount) {
      throw new Error('Insufficient balance');
    }

    const newBalance = parseFloat(user.balance) - amount;
    await supabase
      .from('users')
      .update({ balance: newBalance })
      .eq('id', user.id);

    const { data: withdrawal } = await supabase
      .from('withdrawals')
      .insert({
        user_id: user.id,
        amount,
        status: 'pending',
      })
      .select()
      .single();

    await supabase.from('operation_history').insert({
      user_id: user.id,
      operation_type: 'withdrawal_request',
      amount,
      description: `Withdrawal request: ${amount} USDT`,
    });

    return {
      success: true,
      withdrawal,
      newBalance,
    };
  },
};

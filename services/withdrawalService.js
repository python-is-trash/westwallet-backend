import { supabase } from '../db/supabase.js';
import { nanoid } from 'nanoid';
import { userService } from './userService.js';

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
    const cryptoColumn = `balance_${cryptoType.toLowerCase()}`;
    return parseFloat(user[cryptoColumn] || 0);
  }
}

// Helper function to deduct from the highest network balance available
async function deductFromBalance(userId, cryptoType, amount) {
  cryptoType = cryptoType.toUpperCase();

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (!user) throw new Error('User not found');

  let remainingAmount = amount;
  const updates = {};

  if (cryptoType === 'USDT') {
    // Deduct from network balances only (trigger will recalculate balance_usdt)
    const networks = [
      { col: 'balance_usdtbep', val: parseFloat(user.balance_usdtbep || 0) },
      { col: 'balance_usdttrc', val: parseFloat(user.balance_usdttrc || 0) },
      { col: 'balance_usdterc', val: parseFloat(user.balance_usdterc || 0) },
      { col: 'balance_usdtton', val: parseFloat(user.balance_usdtton || 0) }
    ];

    for (const network of networks) {
      if (remainingAmount <= 0) break;
      if (network.val > 0) {
        const deductAmount = Math.min(network.val, remainingAmount);
        updates[network.col] = network.val - deductAmount;
        remainingAmount -= deductAmount;
      }
    }
  } else if (cryptoType === 'USDC') {
    // Deduct from network balances only (trigger will recalculate balance_usdc)
    const networks = [
      { col: 'balance_usdcerc', val: parseFloat(user.balance_usdcerc || 0) },
      { col: 'balance_usdcbep', val: parseFloat(user.balance_usdcbep || 0) }
    ];

    for (const network of networks) {
      if (remainingAmount <= 0) break;
      if (network.val > 0) {
        const deductAmount = Math.min(network.val, remainingAmount);
        updates[network.col] = network.val - deductAmount;
        remainingAmount -= deductAmount;
      }
    }
  } else {
    const cryptoColumn = `balance_${cryptoType.toLowerCase()}`;
    const currentBalance = parseFloat(user[cryptoColumn] || 0);
    updates[cryptoColumn] = currentBalance - amount;
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (error) throw error;
  }

  return updates;
}

export const withdrawalService = {
  async request(userId, amount, address = '', cryptoType = 'USDT', network = null, memo = null) {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', parseInt(userId))
      .single();

    if (!user) throw new Error('User not found');

    // Get aggregated balance across all networks
    const userBalance = getAggregatedBalance(user, cryptoType);

    if (userBalance < amount) {
      throw new Error(`Insufficient balance. You have ${userBalance.toFixed(4)} ${cryptoType}`);
    }

    // Deduct amount from user's balance (smart deduction across networks)
    await deductFromBalance(user.id, cryptoType, amount);

    const { data: withdrawal } = await supabase
      .from('withdrawals')
      .insert({
        user_id: user.id,
        amount,
        crypto_type: cryptoType,
        wallet_address: address || null,
        network: network || null,
        memo: memo || null,
        status: 'pending',
      })
      .select()
      .single();

    await supabase.from('operation_history').insert({
      user_id: user.id,
      operation_type: 'withdrawal_request',
      amount,
      crypto_type: cryptoType,
      description: `Withdrawal request: ${amount} ${cryptoType}`,
    });

    // Get new aggregated balance
    const { data: updatedUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    const newBalance = getAggregatedBalance(updatedUser, cryptoType);

    return {
      success: true,
      withdrawal,
      newBalance,
    };
  },
};

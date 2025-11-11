import { supabase } from '../db/supabase.js';
import { nanoid } from 'nanoid';
import { userService } from './userService.js';

let westwalletService = null;

export const setWestWalletService = (service) => {
  westwalletService = service;
};

export const depositService = {
  async createPayment(userId, amount, currency = 'USDT') {
    const user = await userService.getOrCreate(userId);

    const orderId = `deposit_${userId}_${Date.now()}`;
    const callbackUrl = `${process.env.WEBAPP_URL || 'http://localhost:4000'}/api/westwallet/callback`;
    const returnUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/deposit?status=success`;

    const payment = await westwalletService.createPayment(
      orderId,
      amount,
      currency,
      callbackUrl,
      returnUrl
    );

    if (!payment.success) {
      throw new Error(payment.error);
    }

    const { data: deposit } = await supabase
      .from('deposits')
      .insert({
        user_id: user.id,
        amount,
        status: 'pending',
        payment_id: payment.data.paymentId,
        payment_url: payment.data.paymentUrl,
      })
      .select()
      .single();

    return {
      success: true,
      paymentUrl: payment.data.paymentUrl,
      paymentId: payment.data.paymentId,
      depositId: deposit.id,
    };
  },

  async processPayment(paymentId, status) {
    const { data: deposit } = await supabase
      .from('deposits')
      .select('*, app_users(*)')
      .eq('payment_id', paymentId)
      .single();

    if (!deposit) {
      throw new Error('Deposit not found');
    }

    if (status === 'completed' || status === 'paid' || status === 'success') {
      const newBalance = parseFloat(deposit.app_users.balance) + parseFloat(deposit.amount);

      await supabase
        .from('deposits')
        .update({ status: 'completed' })
        .eq('id', deposit.id);

      await userService.updateBalance(deposit.app_users.user_id, newBalance);

      const txId = `tx_${nanoid(10)}`;
      await supabase.from('transactions').insert({
        id: txId,
        user_id: deposit.user_id,
        type: 'deposit',
        amount: deposit.amount,
        status: 'completed',
        description: `Crypto deposit of $${deposit.amount}`,
      });

      // Log to operation_history for PNL tracking
      await supabase.from('operation_history').insert({
        user_id: deposit.user_id,
        operation_type: 'deposit',
        amount: deposit.amount,
        crypto_type: deposit.crypto_type || 'USDT',
        description: `Deposit: ${deposit.amount} ${deposit.crypto_type || 'USDT'}`,
        status: 'completed',
      });

      return { success: true, newBalance };
    } else {
      await supabase
        .from('deposits')
        .update({ status: 'failed' })
        .eq('id', deposit.id);

      return { success: false, error: 'Payment not completed' };
    }
  },

  async getPaymentStatus(paymentId) {
    if (!westwalletService) {
      throw new Error('WestWallet service not initialized');
    }
    return await westwalletService.getPaymentStatus(paymentId);
  },
};

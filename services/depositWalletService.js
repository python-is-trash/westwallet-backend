import { supabase } from '../db/supabase.js';
import { westwalletService } from './westwalletService.js';

export const initWestWallet = (publicKey, privateKey) => {
  if (publicKey && privateKey) {
    console.log('✅ WestWallet service initialized with keys');
    return true;
  }
  console.log('⚠️  WestWallet keys not found - deposit features will be limited');
  return false;
};

export const depositWalletService = {
  async createDeposit(telegramId, amount, cryptoType = 'USDTTRC', network = null) {
    const WESTWALLET_PUBLIC_KEY = process.env.WESTWALLET_PUBLIC_KEY;
    const WESTWALLET_PRIVATE_KEY = process.env.WESTWALLET_PRIVATE_KEY;

    if (!WESTWALLET_PUBLIC_KEY || !WESTWALLET_PRIVATE_KEY) {
      throw new Error('WestWallet service not initialized. Please add WESTWALLET keys to .env');
    }

    // Get user
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    if (!user) throw new Error('User not found');

    // Handle network parameter for USDT
    let finalCryptoType = cryptoType;
    if (network && cryptoType.toUpperCase().startsWith('USDT')) {
      finalCryptoType = network; // network should be USDTTRC, USDTERC, or USDTBEP
    }

    // Create unique label for tracking
    const label = `deposit_${user.id}_${Date.now()}`;

    // IPN callback URL
    const ipnUrl = `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/westwallet/callback`;

    // Generate deposit address via WestWallet API
    const addressData = await westwalletService.generateDepositAddress(
      finalCryptoType,
      label,
      ipnUrl
    );

    // Save deposit record with network info
    await supabase.from('deposits').insert({
      user_id: user.id,
      order_id: label,
      amount,
      crypto_type: finalCryptoType,
      payment_id: addressData.dest_tag || '',
      status: 'pending',
      payment_url: addressData.address,
    });

    // Build QR code data with amount
    let qr_data = addressData.address;
    if (addressData.dest_tag) {
      qr_data = `${addressData.address}?dt=${addressData.dest_tag}&amount=${amount}`;
    } else if (finalCryptoType.toUpperCase().includes('USDT')) {
      qr_data = `${addressData.address}?amount=${amount}`;
    }

    return {
      address: addressData.address,
      dest_tag: addressData.dest_tag || '',
      currency: finalCryptoType,
      network: westwalletService.getNetworkDisplayName(finalCryptoType),
      amount: amount,
      label: label,
      qr_data: qr_data,
    };
  },

  async processCallback(label, status, txData = {}) {
    // Find deposit by label (order_id)
    const { data: deposit } = await supabase
      .from('deposits')
      .select('*, users(*)')
      .eq('order_id', label)
      .maybeSingle();

    if (!deposit) {
      console.log('Deposit not found for label:', label);
      return;
    }

    if (deposit.status === 'completed') {
      console.log('Deposit already processed:', label);
      return;
    }

    // Update deposit status with transaction details
    await supabase
      .from('deposits')
      .update({
        status: status === 'completed' ? 'completed' : 'pending',
        payment_id: txData.id || '',
        updated_at: new Date().toISOString()
      })
      .eq('order_id', label);

    // If payment is complete, add balance to user
    if (status === 'completed') {
      const cryptoType = deposit.crypto_type || 'USDT';
      const cryptoColumn = `balance_${cryptoType.toLowerCase()}`;
      const currentBalance = parseFloat(deposit.users[cryptoColumn] || 0);
      const depositAmount = txData.amount || parseFloat(deposit.amount);
      const newBalance = currentBalance + depositAmount;

      await supabase
        .from('users')
        .update({ [cryptoColumn]: newBalance })
        .eq('id', deposit.user_id);

      // Log transaction
      await supabase.from('operation_history').insert({
        user_id: deposit.user_id,
        operation_type: 'deposit',
        amount: depositAmount,
        description: `Deposit completed: ${depositAmount} ${cryptoType} - ${txData.blockchain_hash || 'N/A'}`,
      });

      console.log(`✅ Deposit completed for user ${deposit.users.telegram_id}: ${depositAmount} ${cryptoType}`);
    }
  },

  async getDepositStatus(orderId) {
    const { data: deposit } = await supabase
      .from('deposits')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (!deposit) throw new Error('Deposit not found');

    return deposit;
  },

  async getUserDeposits(telegramId) {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    const { data: deposits } = await supabase
      .from('deposits')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    return deposits || [];
  },
};

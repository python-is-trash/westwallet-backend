import { supabase } from '../db/supabase.js';
import { westwalletService } from './westwalletService.js';

/**
 * Auto Deposit Crediter
 *
 * Automatically scans WestWallet for completed transactions and credits users
 * Works with static addresses from user_deposit_addresses table
 * Runs every 5 minutes to catch any missed deposits
 */

export const autoDepositCrediter = {
  /**
   * Main auto-credit function
   * Scans WestWallet transaction history and credits completed deposits
   */
  async creditCompletedDeposits() {
    console.log('\n💰 AUTO-CREDITER: Starting scan for completed deposits...\n');

    try {
      // Get all static addresses from database
      const { data: staticAddresses, error: addressError } = await supabase
        .from('user_deposit_addresses')
        .select('*, users(*)');

      if (addressError) {
        console.error('❌ Error fetching static addresses:', addressError);
        return { success: false, error: addressError.message };
      }

      if (!staticAddresses || staticAddresses.length === 0) {
        console.log('ℹ️  No static addresses found. Skipping auto-credit.');
        return { success: true, credited: 0, message: 'No static addresses' };
      }

      console.log(`📋 Found ${staticAddresses.length} static addresses to check`);

      // Get transaction history from WestWallet for all supported currencies
      const currencies = ['USDTTRC', 'USDTERC', 'USDTBEP', 'USDTTON', 'USDCERC', 'USDCBEP', 'TON', 'SOL', 'BNB', 'ETH'];
      const allTransactions = [];

      for (const currency of currencies) {
        try {
          const txHistory = await westwalletService.getTransactionHistory(currency, 50, 0);
          if (txHistory && txHistory.length > 0) {
            allTransactions.push(...txHistory.map(tx => ({ ...tx, currency })));
            console.log(`   ✅ ${currency}: ${txHistory.length} transactions`);
          }
        } catch (err) {
          // Skip if currency not supported or error
          console.log(`   ⏭️  ${currency}: Skipped (${err.message})`);
        }
      }

      console.log(`\n📊 Total transactions from WestWallet: ${allTransactions.length}\n`);

      let creditedCount = 0;
      const results = [];

      // Process each static address
      for (const staticAddr of staticAddresses) {
        try {
          const result = await this.checkAndCreditAddress(staticAddr, allTransactions);
          if (result.credited > 0) {
            creditedCount += result.credited;
            results.push(...result.transactions);
          }
        } catch (err) {
          console.error(`❌ Error processing address ${staticAddr.deposit_address}:`, err.message);
        }
      }

      if (creditedCount > 0) {
        console.log(`\n✅✅✅ AUTO-CREDITER: Credited ${creditedCount} deposits!\n`);
      } else {
        console.log(`\nℹ️  AUTO-CREDITER: No new deposits to credit\n`);
      }

      return {
        success: true,
        credited: creditedCount,
        results
      };
    } catch (error) {
      console.error('❌ AUTO-CREDITER ERROR:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Check a specific static address for completed transactions
   */
  async checkAndCreditAddress(staticAddr, westwalletTransactions) {
    const results = [];
    let creditedCount = 0;

    // Find all completed transactions for this address
    const matchingTxs = westwalletTransactions.filter(tx => {
      const addressMatch = tx.address === staticAddr.deposit_address;
      const isCompleted = tx.status === 'completed' || tx.status === 'confirmed';

      // For TON and other memo-based cryptos, match memo/dest_tag correctly
      let memoMatch = true;
      if (staticAddr.memo) {
        // If address has memo (e.g., TON), transaction MUST have matching memo
        memoMatch = tx.dest_tag === staticAddr.memo;
      } else if (tx.dest_tag) {
        // If tx has memo but address doesn't, it's for a different user
        memoMatch = false;
      }

      return addressMatch && isCompleted && memoMatch;
    });

    if (matchingTxs.length === 0) {
      return { credited: 0, transactions: [] };
    }

    console.log(`🔍 Checking address: ${staticAddr.deposit_address}`);
    console.log(`   User: ${staticAddr.user_id} (${staticAddr.users.telegram_id})`);
    console.log(`   Found ${matchingTxs.length} completed transaction(s)`);

    for (const tx of matchingTxs) {
      try {
        // Check if we already credited this transaction by hash
        const { data: existingByHash } = await supabase
          .from('deposits')
          .select('id, status')
          .eq('blockchain_hash', tx.blockchain_hash)
          .eq('user_id', staticAddr.user_id)
          .maybeSingle();

        if (existingByHash?.status === 'completed') {
          console.log(`   ⏭️  TX ${tx.id} already credited (found by hash)`);
          continue;
        }

        // ALSO check by payment_id (WestWallet tx.id)
        const { data: existingByPaymentId } = await supabase
          .from('deposits')
          .select('id, status')
          .eq('payment_id', tx.id.toString())
          .eq('user_id', staticAddr.user_id)
          .maybeSingle();

        if (existingByPaymentId?.status === 'completed') {
          console.log(`   ⏭️  TX ${tx.id} already credited (found by payment_id)`);
          continue;
        }

        // CRITICAL: Check for pending deposit by address
        // This finds the original deposit created by frontend
        const { data: existingByAddress } = await supabase
          .from('deposits')
          .select('id, status, order_id')
          .eq('payment_url', staticAddr.deposit_address)
          .eq('user_id', staticAddr.user_id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const existingDeposit = existingByHash || existingByPaymentId || existingByAddress;

        if (existingDeposit?.status === 'pending') {
          // If pending, we'll update it below
          const foundBy = existingByHash ? 'hash' : existingByPaymentId ? 'payment_id' : 'address';
          console.log(`   📝 Updating pending deposit for TX ${tx.id} (found by ${foundBy}, order_id: ${existingDeposit.order_id})`);
        }

        // ALSO check operation_history to catch manual credits
        const { data: existingOperation } = await supabase
          .from('operation_history')
          .select('id')
          .eq('user_id', staticAddr.user_id)
          .eq('operation_type', 'deposit')
          .eq('amount', parseFloat(tx.amount))
          .eq('crypto_type', tx.currency)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // Last 30 days
          .maybeSingle();

        if (existingOperation) {
          console.log(`   ⏭️  TX ${tx.id} already credited (found in operation history)`);
          continue;
        }

        // Credit this transaction
        console.log(`   💰 Crediting TX ${tx.id}: ${tx.amount} ${tx.currency}`);

        const credited = await this.creditTransaction(staticAddr, tx, existingDeposit);

        if (credited) {
          creditedCount++;
          results.push({
            user_id: staticAddr.user_id,
            telegram_id: staticAddr.users.telegram_id,
            amount: parseFloat(tx.amount),
            crypto: tx.currency,
            tx_hash: tx.blockchain_hash,
            tx_id: tx.id
          });
          console.log(`   ✅✅ Credited ${tx.amount} ${tx.currency} to user ${staticAddr.users.telegram_id}`);
        }
      } catch (err) {
        console.error(`   ❌ Error crediting TX ${tx.id}:`, err.message);
      }
    }

    return { credited: creditedCount, transactions: results };
  },

  /**
   * Credit a single transaction to a user
   */
  async creditTransaction(staticAddr, tx, existingDeposit) {
    const amount = parseFloat(tx.amount);
    const cryptoType = tx.currency.toUpperCase();
    const userId = staticAddr.user_id;

    // Map crypto type to balance column
    const cryptoColumn = `balance_${cryptoType.toLowerCase()}`;
    const validColumns = [
      'balance_usdt', 'balance_usdtbep', 'balance_usdterc', 'balance_usdttrc', 'balance_usdtton',
      'balance_usdc', 'balance_usdcerc', 'balance_usdcbep',
      'balance_bnb', 'balance_eth', 'balance_ton', 'balance_sol'
    ];

    if (!validColumns.includes(cryptoColumn)) {
      console.error(`   ❌ Invalid crypto type: ${cryptoType}`);
      return false;
    }

    // Get current balance
    const { data: user } = await supabase
      .from('users')
      .select(cryptoColumn)
      .eq('id', userId)
      .single();

    if (!user) {
      console.error(`   ❌ User not found: ${userId}`);
      return false;
    }

    const currentBalance = parseFloat(user[cryptoColumn] || 0);
    const newBalance = currentBalance + amount;

    // Update or create deposit record
    if (existingDeposit) {
      // Update existing pending deposit
      await supabase
        .from('deposits')
        .update({
          status: 'completed',
          amount: amount,
          payment_id: tx.id?.toString() || '',
          blockchain_hash: tx.blockchain_hash || '',
          blockchain_confirmations: tx.blockchain_confirmations || 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingDeposit.id);
    } else {
      // Create new deposit record (no pending deposit found)
      const label = `autocredit_${userId}_${Date.now()}`;
      console.log(`   🆕 Creating new deposit record: ${label}`);
      await supabase
        .from('deposits')
        .insert({
          user_id: userId,
          order_id: label,
          amount: amount,
          crypto_type: cryptoType,
          payment_url: staticAddr.deposit_address,
          payment_id: tx.id?.toString() || '',
          status: 'completed',
          blockchain_hash: tx.blockchain_hash || '',
          blockchain_confirmations: tx.blockchain_confirmations || 0,
        });
    }

    // Credit user balance
    const { error: balanceError } = await supabase
      .from('users')
      .update({ [cryptoColumn]: newBalance })
      .eq('id', userId);

    if (balanceError) {
      console.error(`   ❌ Failed to update balance:`, balanceError);
      return false;
    }

    // Log to operation history
    await supabase.from('operation_history').insert({
      user_id: userId,
      operation_type: 'deposit',
      amount: amount,
      crypto_type: cryptoType,
      description: `Auto-credited deposit: ${amount} ${cryptoType} - ${tx.blockchain_hash || 'N/A'} [AUTO-CREDITER]`,
      status: 'completed'
    });

    // Update last_used_at for static address
    await supabase
      .from('user_deposit_addresses')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', staticAddr.id);

    return true;
  }
};

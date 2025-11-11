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
        // CRITICAL: Check for pending deposit by address FIRST
        // This finds the original deposit created by frontend
        const { data: existingByAddress } = await supabase
          .from('deposits')
          .select('id, status, order_id, created_at')
          .eq('payment_url', staticAddr.deposit_address)
          .eq('user_id', staticAddr.user_id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // CRITICAL: If there's a pending deposit, ONLY credit transactions AFTER deposit creation
        // This prevents crediting old transactions when user creates a new deposit
        if (existingByAddress && tx.created_at) {
          const depositCreatedAt = new Date(existingByAddress.created_at);
          const txCreatedAt = new Date(tx.created_at);

          if (txCreatedAt < depositCreatedAt) {
            console.log(`   ⏭️  TX ${tx.id} is TOO OLD for pending deposit (TX: ${tx.created_at}, Deposit: ${existingByAddress.created_at})`);
            continue; // Skip old transactions
          }
        }

        // CRITICAL SECURITY FIX: Check if blockchain hash was used by ANY user (not just this user)
        // This prevents double-crediting when blockchain providers reuse hashes
        if (tx.blockchain_hash && tx.blockchain_hash.trim() !== '') {
          const { data: existingByHash } = await supabase
            .from('deposits')
            .select('id, status, user_id, users(telegram_id, username)')
            .eq('blockchain_hash', tx.blockchain_hash)
            .in('status', ['completed', 'credited'])
            .maybeSingle();

          if (existingByHash) {
            console.log(`   🚫 TX ${tx.id} BLOCKED: Hash ${tx.blockchain_hash} already used by user ${existingByHash.users?.telegram_id} (user_id: ${existingByHash.user_id})`);
            continue;
          }
        } else {
          console.log(`   ⚠️  TX ${tx.id} has NO blockchain hash - will rely on payment_id and duplicate checks`);
        }

        // CRITICAL SECURITY FIX: Check if payment_id (WestWallet TX ID) was used by ANY user
        const { data: existingByPaymentId } = await supabase
          .from('deposits')
          .select('id, status, user_id, users(telegram_id, username)')
          .eq('payment_id', tx.id.toString())
          .in('status', ['completed', 'credited'])
          .maybeSingle();

        if (existingByPaymentId) {
          console.log(`   🚫 TX ${tx.id} BLOCKED: Payment ID already used by user ${existingByPaymentId.users?.telegram_id} (user_id: ${existingByPaymentId.user_id})`);
          continue;
        }

        const existingDeposit = existingByAddress;

        // CRITICAL: Auto-crediter ONLY processes transactions that have a pending deposit
        // If no pending deposit exists, it means:
        // 1. Payment was already processed by IPN → Skip it
        // 2. User never requested deposit → Skip it (don't credit old transactions!)
        if (!existingDeposit || existingDeposit.status !== 'pending') {
          console.log(`   ⏭️  TX ${tx.id} SKIPPED: No pending deposit (status: ${existingDeposit?.status || 'not found'})`);
          continue;
        }

        console.log(`   📝 Updating pending deposit for TX ${tx.id} (order_id: ${existingDeposit.order_id})`);

        // Additional safety: Check for recent autocredits with same amount (for THIS user only)
        const { data: recentAutoCredits } = await supabase
          .from('deposits')
          .select('id, order_id, amount, created_at')
          .eq('user_id', staticAddr.user_id)
          .eq('crypto_type', tx.currency)
          .ilike('order_id', 'autocredit_%')
          .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false });

        if (recentAutoCredits && recentAutoCredits.length > 0) {
          const txAmount = parseFloat(tx.amount);
          const hasSameAmountRecently = recentAutoCredits.some(dep => {
            const diff = Math.abs(parseFloat(dep.amount) - txAmount);
            return diff < 0.000001;
          });

          if (hasSameAmountRecently) {
            console.log(`   ⏭️  TX ${tx.id} already credited (found recent autocredit with same amount for THIS user)`);
            continue;
          }
        }

        // Additional safety: Check operation_history for this USER (catches manual credits)
        if (tx.blockchain_hash) {
          const { data: existingOperationByHash } = await supabase
            .from('operation_history')
            .select('id')
            .eq('user_id', staticAddr.user_id)
            .eq('operation_type', 'deposit')
            .ilike('description', `%${tx.blockchain_hash}%`)
            .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle();

          if (existingOperationByHash) {
            console.log(`   ⏭️  TX ${tx.id} already credited to THIS user (found in operation history)`);
            continue;
          }
        }

        // Check by WestWallet TX ID in operation history (for THIS user)
        const { data: existingOperationByTxId } = await supabase
          .from('operation_history')
          .select('id')
          .eq('user_id', staticAddr.user_id)
          .eq('operation_type', 'deposit')
          .ilike('description', `%TX:${tx.id}%`)
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .maybeSingle();

        if (existingOperationByTxId) {
          console.log(`   ⏭️  TX ${tx.id} already credited to THIS user (found by TX ID)`);
          continue;
        }

        // Check by amount + crypto + recent time (for THIS user only)
        const txAmount = parseFloat(tx.amount);
        const { data: recentOperations } = await supabase
          .from('operation_history')
          .select('id, amount')
          .eq('user_id', staticAddr.user_id)
          .eq('operation_type', 'deposit')
          .eq('crypto_type', tx.currency)
          .gte('created_at', new Date(Date.now() - 3 * 60 * 1000).toISOString());

        const hasDuplicate = recentOperations?.some(op => {
          const diff = Math.abs(parseFloat(op.amount) - txAmount);
          return diff < 0.000001;
        });

        if (hasDuplicate) {
          console.log(`   ⏭️  TX ${tx.id} already credited to THIS user (found duplicate in last 3 min)`);
          continue;
        }

        // At this point we have:
        // 1. A pending deposit waiting for payment
        // 2. A completed transaction on WestWallet
        // 3. All duplicate checks passed
        // → Safe to credit!
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
    let cryptoType = tx.currency.toUpperCase();
    const userId = staticAddr.user_id;

    // CRITICAL: Map generic crypto types to specific networks
    // balance_usdt and balance_usdc are GENERATED COLUMNS!
    if (cryptoType === 'USDT') {
      cryptoType = 'USDTTRC';
      console.log('   ⚠️  Generic USDT detected, mapping to USDTTRC');
    } else if (cryptoType === 'USDC') {
      cryptoType = 'USDCERC';
      console.log('   ⚠️  Generic USDC detected, mapping to USDCERC');
    }

    // Map crypto type to balance column
    const cryptoColumn = `balance_${cryptoType.toLowerCase()}`;
    const validColumns = [
      'balance_usdtbep', 'balance_usdterc', 'balance_usdttrc', 'balance_usdtton',
      'balance_usdcerc', 'balance_usdcbep',
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
      // 🚨 CRITICAL FIX: Use atomic update with status check to prevent race condition
      // ONLY update if status is STILL 'pending' (prevents double-credit if auto-crediter runs twice)
      console.log(`   ✏️  Updating deposit record ID: ${existingDeposit.id}, order_id: ${existingDeposit.order_id}`);

      const { data: updatedDeposits, error: updateError } = await supabase
        .from('deposits')
        .update({
          status: 'credited',
          amount: amount,
          payment_id: tx.id?.toString() || null,
          blockchain_hash: tx.blockchain_hash || null,
          blockchain_confirmations: tx.blockchain_confirmations || 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingDeposit.id)
        .eq('status', 'pending') // 🔒 ATOMIC: Only update if STILL pending
        .select();

      if (updateError) {
        console.error(`   ❌ Failed to update deposit: ${updateError.message}`);
        return false;
      }

      // If no rows updated, deposit was already credited by another process
      if (!updatedDeposits || updatedDeposits.length === 0) {
        console.log(`   🚫 RACE CONDITION PREVENTED: Deposit ${existingDeposit.order_id} was already credited by another process`);
        return false; // Don't credit balance!
      }

      console.log(`   ✅ Deposit ${existingDeposit.order_id} status updated to credited`);
    } else {
      // CRITICAL: NO pending deposit found - this TX was already processed OR user never requested deposit
      // AUTO-CREDITER SHOULD NEVER CREATE NEW DEPOSITS! Only IPN callback should create deposits.
      // If we get here, it means:
      // 1. TX was already credited by IPN → duplicate checks should have caught it (they did)
      // 2. User never created a deposit for this payment → don't credit random old transactions!
      console.log(`   ⏭️  TX ${tx.id} SKIPPED: No pending deposit found (already processed or never requested)`);
      return false; // Don't credit
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

    // Log to operation history (include TX ID for duplicate detection)
    await supabase.from('operation_history').insert({
      user_id: userId,
      operation_type: 'deposit',
      amount: amount,
      crypto_type: cryptoType,
      description: `Auto-credited deposit: ${amount} ${cryptoType} - Hash:${tx.blockchain_hash || 'N/A'} TX:${tx.id} [AUTO-CREDITER]`,
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

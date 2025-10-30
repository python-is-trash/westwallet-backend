import { supabase } from '../db/supabase.js';
import { westwalletService } from './westwalletService.js';
import { moralisService } from './moralisService.js';

export const initWestWallet = (publicKey, privateKey) => {
  if (publicKey && privateKey) {
    console.log('✅ WestWallet service initialized with keys');
    return true;
  }
  console.log('⚠️  WestWallet keys not found - deposit features will be limited');
  return false;
};

export const depositWalletService = {
  async createDeposit(telegramId, amount, cryptoType = 'USDTBEP', network = null) {
    const WESTWALLET_PUBLIC_KEY = process.env.WESTWALLET_PUBLIC_KEY;
    const WESTWALLET_PRIVATE_KEY = process.env.WESTWALLET_PRIVATE_KEY;

    if (!WESTWALLET_PUBLIC_KEY || !WESTWALLET_PRIVATE_KEY) {
      throw new Error('WestWallet service not initialized. Please add WESTWALLET keys to .env');
    }

    // Get user with proper error handling
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', parseInt(telegramId))
      .maybeSingle();

    if (userError) {
      console.error('❌ Error fetching user:', userError);
      throw new Error(`Database error: ${userError.message}`);
    }

    if (!user) {
      console.error('❌ User not found for telegram_id:', telegramId);
      throw new Error('User not found. Please start the bot first with /start command.');
    }

    console.log('✅ User found:', { id: user.id, telegram_id: user.telegram_id, username: user.username });

    // Handle network parameter for USDT
    let finalCryptoType = cryptoType;
    if (network && cryptoType.toUpperCase().startsWith('USDT')) {
      finalCryptoType = network; // network should be USDTTRC, USDTERC, or USDTBEP
    }

    // Map crypto type to base type and network for static address lookup
    let baseCryptoType;
    let staticNetwork;

    // Parse crypto type and network
    if (finalCryptoType === 'USDTTRC' || finalCryptoType === 'USDTBEP' || finalCryptoType === 'USDTERC' || finalCryptoType === 'USDTTON') {
      baseCryptoType = 'USDT';
      if (finalCryptoType === 'USDTTRC') staticNetwork = 'TRC20';
      else if (finalCryptoType === 'USDTBEP') staticNetwork = 'BEP20';
      else if (finalCryptoType === 'USDTERC') staticNetwork = 'ERC20';
      else if (finalCryptoType === 'USDTTON') staticNetwork = 'TON';
    } else if (finalCryptoType === 'USDCERC' || finalCryptoType === 'USDCBEP') {
      baseCryptoType = 'USDC';
      if (finalCryptoType === 'USDCERC') staticNetwork = 'ERC20';
      else if (finalCryptoType === 'USDCBEP') staticNetwork = 'BEP20';
    } else if (finalCryptoType === 'TON') {
      baseCryptoType = 'TON';
      staticNetwork = 'TON';
    } else if (finalCryptoType === 'SOL') {
      baseCryptoType = 'SOL';
      staticNetwork = 'SOL';
    } else if (finalCryptoType === 'BNB') {
      baseCryptoType = 'BNB';
      staticNetwork = 'BEP20';
    } else if (finalCryptoType === 'ETH') {
      baseCryptoType = 'ETH';
      staticNetwork = 'ERC20';
    } else {
      // Fallback
      baseCryptoType = finalCryptoType;
      staticNetwork = 'TRC20';
    }

    console.log(`🔍 Looking for static address: crypto=${baseCryptoType}, network=${staticNetwork}`);

    // Check if user already has a static address for this crypto+network
    const { data: existingStaticAddress } = await supabase
      .from('user_deposit_addresses')
      .select('*')
      .eq('user_id', user.id)
      .eq('crypto_type', baseCryptoType)
      .eq('network', staticNetwork)
      .maybeSingle();

    let addressData;
    let label;

    if (existingStaticAddress) {
      // Use existing static address
      console.log('♻️  Reusing existing static address:', existingStaticAddress.deposit_address);

      // For TON networks, generate memo if not exists
      let memoValue = existingStaticAddress.memo;
      if (!memoValue && (staticNetwork === 'TON' || finalCryptoType.includes('TON'))) {
        memoValue = user.id.toString().padStart(8, '0');
        console.log('🔢 Generated memo for TON:', memoValue);
        await supabase
          .from('user_deposit_addresses')
          .update({ memo: memoValue })
          .eq('id', existingStaticAddress.id);
      }

      addressData = {
        address: existingStaticAddress.deposit_address,
        dest_tag: memoValue || ''
      };
      label = `deposit_${user.id}_${Date.now()}`;

      // Update last_used_at
      await supabase
        .from('user_deposit_addresses')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', existingStaticAddress.id);
    } else {
      // Generate NEW address via WestWallet API
      label = `deposit_${user.id}_${Date.now()}`;
      const ipnUrl = `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/westwallet/callback`;

      console.log('🆕 Generating new deposit address via WestWallet...');
      addressData = await westwalletService.generateDepositAddress(
        finalCryptoType,
        label,
        ipnUrl
      );

      // For TON networks, if WestWallet didn't provide memo, generate one
      if (!addressData.dest_tag && (staticNetwork === 'TON' || finalCryptoType.includes('TON'))) {
        addressData.dest_tag = user.id.toString().padStart(8, '0');
        console.log('🔢 Generated memo for new TON address:', addressData.dest_tag);
      }

      // Save as static address for future reuse
      await supabase
        .from('user_deposit_addresses')
        .insert({
          user_id: user.id,
          crypto_type: baseCryptoType,
          network: staticNetwork || 'TRC20',
          deposit_address: addressData.address,
          memo: addressData.dest_tag || null
        })
        .select()
        .single()
        .then(result => {
          if (result.error) {
            console.warn('⚠️  Could not save static address (may already exist):', result.error.message);
          } else {
            console.log('✅ Saved as static address for future reuse');
          }
        });
    }

    // Save deposit record with network info
    const { data: depositRecord, error: depositError } = await supabase.from('deposits').insert({
      user_id: user.id,
      order_id: label,
      amount,
      crypto_type: finalCryptoType,
      payment_id: addressData.dest_tag || '',
      status: 'pending',
      payment_url: addressData.address,
    }).select().single();

    if (depositError) {
      console.error('❌ Failed to create deposit record:', depositError);
      throw new Error(`Failed to create deposit: ${depositError.message}`);
    }

    console.log('✅ Deposit record created:', label, finalCryptoType, amount);

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
    console.log('🔄 Processing callback for label:', label);
    console.log('   Status:', status);
    console.log('   TX Data:', JSON.stringify(txData, null, 2));

    // STRATEGY 1: Try to find by label first (exact match)
    let { data: deposit, error: depositFetchError } = await supabase
      .from('deposits')
      .select('*, users(*)')
      .eq('order_id', label)
      .maybeSingle();

    if (depositFetchError) {
      console.error('❌ Error fetching deposit:', depositFetchError);
      throw new Error(`Failed to fetch deposit: ${depositFetchError.message}`);
    }

    // STRATEGY 2: If not found by label, try to find by ADDRESS (for reused addresses)
    if (!deposit && txData.address) {
      console.log('⚠️  Deposit not found by label, trying to find by address:', txData.address);

      // Find the most recent pending deposit for this address
      const { data: addressMatch } = await supabase
        .from('deposits')
        .select('*, users(*)')
        .eq('payment_url', txData.address)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);

      if (addressMatch && addressMatch.length > 0) {
        deposit = addressMatch[0];
        console.log('✅ Found deposit by address match:', deposit.order_id);
      }
    }

    // STRATEGY 3: If still not found, extract user_id from label and find latest pending deposit
    if (!deposit) {
      const userId = label.split('_')[1]; // Extract user_id from label (e.g., "deposit_13_xxx" -> "13")
      console.log('⚠️  Trying to find latest pending deposit for user:', userId);

      const { data: userDeposits } = await supabase
        .from('deposits')
        .select('*, users(*)')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .eq('crypto_type', txData.currency || 'USDTTRC')
        .order('created_at', { ascending: false })
        .limit(1);

      if (userDeposits && userDeposits.length > 0) {
        deposit = userDeposits[0];
        console.log('✅ Found deposit by user_id + crypto match:', deposit.order_id);
        console.log('   Note: Original label was', label, 'but using', deposit.order_id);
      }
    }

    // STRATEGY 4: Check if this is a static address from user_deposit_addresses
    // If WestWallet sent a payment to a permanent address, create the deposit record now
    if (!deposit && txData.address) {
      console.log('⚠️  Checking if this is a static/permanent address...');

      const { data: staticAddress } = await supabase
        .from('user_deposit_addresses')
        .select('*, users:user_id(*)')
        .eq('deposit_address', txData.address)
        .maybeSingle();

      if (staticAddress) {
        console.log('✅ Found static address for user:', staticAddress.user_id);
        console.log('   Creating deposit record automatically...');

        // Create deposit record for this payment
        const { data: newDeposit, error: createError } = await supabase
          .from('deposits')
          .insert({
            user_id: staticAddress.user_id,
            order_id: label, // Use the label from WestWallet
            amount: txData.amount || 0,
            crypto_type: txData.currency || staticAddress.crypto_type || 'USDTTRC',
            payment_url: txData.address,
            payment_id: txData.id?.toString() || '',
            status: 'pending',
            blockchain_hash: txData.blockchain_hash || '',
            blockchain_confirmations: txData.blockchain_confirmations || 0,
          })
          .select('*, users(*)')
          .single();

        if (createError) {
          console.error('❌ Failed to create deposit record:', createError);
          throw new Error(`Failed to auto-create deposit: ${createError.message}`);
        }

        deposit = newDeposit;
        console.log('✅ Auto-created deposit record:', deposit.order_id);

        // Update last_used_at for the static address
        await supabase
          .from('user_deposit_addresses')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', staticAddress.id);
      }
    }

    if (!deposit) {
      console.error('❌ Deposit not found for label:', label);
      console.error('   Address:', txData.address);
      console.error('   Currency:', txData.currency);

      // DEBUG: Check if ANY deposits exist for this user
      const userId = label.split('_')[1];
      const { data: allUserDeposits } = await supabase
        .from('deposits')
        .select('order_id, payment_url, crypto_type, created_at, status')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);

      console.error('   Recent deposits for user', userId, ':', allUserDeposits);

      // Also check static addresses
      const { data: staticAddresses } = await supabase
        .from('user_deposit_addresses')
        .select('*')
        .eq('user_id', userId);

      console.error('   Static addresses for user', userId, ':', staticAddresses);
      throw new Error(`Deposit not found for label: ${label}. No matching deposit record or static address found.`);
    }

    console.log('✅ Deposit found:', {
      id: deposit.id,
      user_id: deposit.user_id,
      amount: deposit.amount,
      crypto_type: deposit.crypto_type,
      status: deposit.status
    });

    if (deposit.status === 'completed') {
      console.log('⚠️  Deposit already processed:', label);

      // CRITICAL FIX: Check if there are OTHER pending deposits for this address
      // This happens when user creates multiple deposits to the same static address
      if (txData.address && txData.blockchain_hash && status === 'completed') {
        console.log('   🔍 Checking for other pending deposits to the same address...');

        const { data: otherPendingDeposits } = await supabase
          .from('deposits')
          .select('id, order_id, user_id, amount, crypto_type')
          .eq('payment_url', txData.address)
          .eq('user_id', deposit.user_id)
          .eq('status', 'pending')
          .neq('order_id', label); // Exclude current deposit

        if (otherPendingDeposits && otherPendingDeposits.length > 0) {
          console.log(`   ✅ Found ${otherPendingDeposits.length} other pending deposit(s) for same address`);

          for (const pendingDep of otherPendingDeposits) {
            console.log(`   📝 Processing pending deposit: ${pendingDep.order_id}`);

            const depositAmount = parseFloat(txData.amount || pendingDep.amount);
            const cryptoType = (txData.currency || pendingDep.crypto_type || 'USDT').toUpperCase();
            const blockchainHash = txData.blockchain_hash;

            console.log(`   🔍 DEBUG: txData.currency='${txData.currency}', pendingDep.crypto_type='${pendingDep.crypto_type}', final cryptoType='${cryptoType}'`);

            // Check if this specific deposit was already credited
            const { data: existingCredit } = await supabase
              .from('operation_history')
              .select('id')
              .eq('user_id', pendingDep.user_id)
              .eq('operation_type', 'deposit')
              .eq('amount', depositAmount)
              .eq('crypto_type', cryptoType)
              .eq('description', `Deposit completed: ${depositAmount} ${cryptoType} - ${blockchainHash}`)
              .maybeSingle();

            if (existingCredit) {
              console.log(`   ⏭️  Deposit ${pendingDep.order_id} already credited, just updating status`);

              // Just update status
              await supabase
                .from('deposits')
                .update({
                  status: 'completed',
                  amount: depositAmount,
                  payment_id: txData.id || '',
                  blockchain_hash: blockchainHash || '',
                  blockchain_confirmations: txData.blockchain_confirmations || 0,
                  updated_at: new Date().toISOString()
                })
                .eq('id', pendingDep.id);

              console.log(`   ✅ Updated ${pendingDep.order_id} status to completed (already credited)`);
              continue;
            }

            // Credit the balance
            console.log(`   💰 Crediting ${depositAmount} ${cryptoType} for ${pendingDep.order_id}`);
            console.log(`      User ID: ${pendingDep.user_id}, Crypto: ${cryptoType}, Amount: ${depositAmount}`);

            // Get user data
            const { data: user } = await supabase
              .from('users')
              .select('*')
              .eq('id', pendingDep.user_id)
              .single();

            if (!user) {
              console.error(`   ❌ User not found: ${pendingDep.user_id}`);
              continue;
            }

            // CRITICAL: Map generic crypto types to specific networks
            // balance_usdt and balance_usdc are GENERATED COLUMNS!
            let finalCryptoTypeForPending = cryptoType;
            if (cryptoType === 'USDT') {
              finalCryptoTypeForPending = 'USDTTRC';
              console.log('   ⚠️  Generic USDT detected, mapping to USDTTRC');
            } else if (cryptoType === 'USDC') {
              finalCryptoTypeForPending = 'USDCERC';
              console.log('   ⚠️  Generic USDC detected, mapping to USDCERC');
            }

            // Map crypto type to database column
            const cryptoColumn = `balance_${finalCryptoTypeForPending.toLowerCase()}`;
            const validColumns = [
              'balance_usdtbep', 'balance_usdterc', 'balance_usdttrc', 'balance_usdtton',
              'balance_usdcerc', 'balance_usdcbep',
              'balance_bnb', 'balance_eth', 'balance_ton', 'balance_sol'
            ];

            if (!validColumns.includes(cryptoColumn)) {
              console.error(`   ❌ Invalid crypto column: ${cryptoColumn}`);
              continue;
            }

            const currentBalance = parseFloat(user[cryptoColumn] || 0);
            const newBalance = currentBalance + depositAmount;

            console.log(`   📊 Balance update: ${cryptoColumn} = ${currentBalance} + ${depositAmount} = ${newBalance}`);

            // Update user balance
            console.log(`   🔄 Executing balance update: users.${cryptoColumn} = ${newBalance} WHERE id = ${pendingDep.user_id}`);

            const { data: balanceUpdateData, error: balanceError } = await supabase
              .from('users')
              .update({ [cryptoColumn]: newBalance })
              .eq('id', pendingDep.user_id)
              .select();

            if (balanceError) {
              console.error(`   ❌ Failed to update balance: ${balanceError.message}`);
              console.error(`      Column: ${cryptoColumn}, User: ${pendingDep.user_id}, Amount: ${depositAmount}`);
              console.error(`      Error details:`, JSON.stringify(balanceError, null, 2));
              continue; // Skip this deposit
            }

            if (!balanceUpdateData || balanceUpdateData.length === 0) {
              console.error(`   ❌ Balance update returned no rows! User ${pendingDep.user_id} might not exist.`);
              continue;
            }

            console.log(`   ✅ Balance updated in database, new value: ${balanceUpdateData[0][cryptoColumn]}`);

            // Update deposit status
            const { error: depositError } = await supabase
              .from('deposits')
              .update({
                status: 'completed',
                amount: depositAmount,
                payment_id: txData.id || '',
                blockchain_hash: blockchainHash || '',
                blockchain_confirmations: txData.blockchain_confirmations || 0,
                updated_at: new Date().toISOString()
              })
              .eq('id', pendingDep.id);

            if (depositError) {
              console.error(`   ❌ Failed to update deposit: ${depositError.message}`);
            }

            // Log to operation_history
            const { error: historyError } = await supabase
              .from('operation_history')
              .insert({
                user_id: pendingDep.user_id,
                operation_type: 'deposit',
                amount: depositAmount,
                crypto_type: cryptoType,
                description: `Deposit completed: ${depositAmount} ${cryptoType} - ${blockchainHash}`,
                status: 'completed'
              });

            if (historyError) {
              console.error(`   ❌ Failed to log operation: ${historyError.message}`);
            }

            console.log(`   ✅ Credited ${depositAmount} ${cryptoType} to ${pendingDep.order_id} (${currentBalance} → ${newBalance})`);
          }
        } else {
          console.log('   ℹ️  No other pending deposits found');
        }
      }

      return; // Original deposit already processed
    }

    // If blockchain hash is provided, verify with Moralis
    let moralisVerification = null;
    if (txData.blockchain_hash && status === 'completed') {
      console.log(`🔍 Verifying transaction with Moralis: ${txData.blockchain_hash}`);
      try {
        moralisVerification = await moralisService.verifyDeposit(
          txData.blockchain_hash,
          txData.currency || deposit.crypto_type,
          txData.amount || deposit.amount,
          txData.address || deposit.payment_url
        );
        console.log('✅ Moralis verification result:', moralisVerification);
      } catch (moralisError) {
        console.error('⚠️  Moralis verification failed:', moralisError.message);
        console.error('   Continuing without verification...');
      }

      // Store verification data if successful
      if (moralisVerification?.verified) {
        const { error: verifyUpdateError } = await supabase
          .from('deposits')
          .update({
            blockchain_confirmations: moralisVerification.confirmations,
            blockchain_verified: true,
            verification_data: moralisVerification
          })
          .eq('order_id', label);

        if (verifyUpdateError) {
          console.error('❌ Failed to update verification data:', verifyUpdateError);
        }
      }
    }

    // Update deposit status with transaction details
    // IMPORTANT: Update amount to actual received amount from WestWallet
    const actualAmount = txData.amount || deposit.amount;
    const { error: statusUpdateError } = await supabase
      .from('deposits')
      .update({
        status: status === 'completed' ? 'completed' : 'pending',
        amount: actualAmount, // Update to actual received amount
        payment_id: txData.id || '',
        blockchain_hash: txData.blockchain_hash || '',
        blockchain_confirmations: txData.blockchain_confirmations || 0,
        updated_at: new Date().toISOString()
      })
      .eq('order_id', label);

    if (statusUpdateError) {
      console.error('❌ Failed to update deposit status:', statusUpdateError);
      throw new Error(`Failed to update deposit status: ${statusUpdateError.message}`);
    }

    console.log('✅ Deposit status updated to:', status);

    // If payment is complete, add balance to user
    if (status === 'completed') {
      const cryptoType = (txData.currency || deposit.crypto_type || 'USDT').toUpperCase();
      const depositAmount = parseFloat(txData.amount || deposit.amount);
      const blockchainHash = txData.blockchain_hash;

      // CRITICAL: Check if already credited to prevent double-credit
      // Check by blockchain hash first (most reliable)
      if (blockchainHash) {
        const { data: existingByHash } = await supabase
          .from('operation_history')
          .select('id, description')
          .eq('user_id', deposit.user_id)
          .eq('operation_type', 'deposit')
          .ilike('description', `%${blockchainHash}%`)
          .maybeSingle();

        if (existingByHash) {
          console.log('⏭️  SKIPPING: Already credited (found by blockchain hash)');
          console.log('   Operation ID:', existingByHash.id);
          console.log('   Description:', existingByHash.description);
          console.log('   Blockchain Hash:', blockchainHash);
          return; // Skip crediting
        }
      }

      // Fallback: Check by amount + crypto + recent time (for deposits without hash)
      const { data: recentOperations } = await supabase
        .from('operation_history')
        .select('id, amount')
        .eq('user_id', deposit.user_id)
        .eq('operation_type', 'deposit')
        .eq('crypto_type', cryptoType)
        .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()); // Last 5 minutes

      // Check if any recent operation has same amount (with tolerance for floating point)
      const hasDuplicate = recentOperations?.some(op => {
        const diff = Math.abs(parseFloat(op.amount) - depositAmount);
        return diff < 0.000001; // Very small tolerance
      });

      if (hasDuplicate) {
        console.log('⏭️  SKIPPING: Already credited (found duplicate in last 5 min)');
        return; // Skip crediting
      }

      console.log('💰 Crediting user balance:');
      console.log('   Crypto Type:', cryptoType);
      console.log('   Amount:', depositAmount);
      console.log('   User ID:', deposit.user_id);
      console.log('   Telegram ID:', deposit.users.telegram_id);

      // CRITICAL: Map generic crypto types to specific networks
      // balance_usdt and balance_usdc are GENERATED COLUMNS and cannot be updated directly!
      let finalCryptoType = cryptoType;

      if (cryptoType === 'USDT') {
        // Default USDT to TRC20 (most common)
        finalCryptoType = 'USDTTRC';
        console.log('⚠️  Generic USDT detected, mapping to USDTTRC (default)');
      } else if (cryptoType === 'USDC') {
        // Default USDC to ERC20 (most common)
        finalCryptoType = 'USDCERC';
        console.log('⚠️  Generic USDC detected, mapping to USDCERC (default)');
      }

      // Map crypto type to database column
      const cryptoColumn = `balance_${finalCryptoType.toLowerCase()}`;

      // Verify column exists (excluding generated columns)
      const validColumns = [
        'balance_usdtbep', 'balance_usdterc', 'balance_usdttrc', 'balance_usdtton',
        'balance_usdcerc', 'balance_usdcbep',
        'balance_bnb', 'balance_eth', 'balance_ton', 'balance_sol'
      ];

      if (!validColumns.includes(cryptoColumn)) {
        console.error('❌ Invalid crypto column:', cryptoColumn);
        console.error('   Valid columns:', validColumns.join(', '));
        throw new Error(`Invalid crypto type: ${cryptoType}. Column ${cryptoColumn} does not exist.`);
      }

      console.log('   Database Column:', cryptoColumn);

      const currentBalance = parseFloat(deposit.users[cryptoColumn] || 0);
      const newBalance = currentBalance + depositAmount;

      console.log('   Current Balance:', currentBalance);
      console.log('   New Balance:', newBalance);

      // Update user balance and verify it was successful
      const { data: updateResult, error: balanceUpdateError } = await supabase
        .from('users')
        .update({ [cryptoColumn]: newBalance })
        .eq('id', deposit.user_id)
        .select();

      if (balanceUpdateError) {
        console.error('❌ CRITICAL: Failed to update user balance:', balanceUpdateError);
        throw new Error(`Failed to update balance: ${balanceUpdateError.message}`);
      }

      // Verify the update actually affected a row
      if (!updateResult || updateResult.length === 0) {
        console.error('❌ CRITICAL: User not found or balance update failed!');
        console.error('   User ID:', deposit.user_id);
        console.error('   This means the user was deleted or doesn\'t exist!');
        throw new Error(`User not found (ID: ${deposit.user_id}). Cannot credit balance.`);
      }

      console.log('✅ User balance updated successfully!');

      // Log transaction with Moralis verification status
      const verificationNote = moralisVerification?.verified
        ? ` ✅ Verified (${moralisVerification.confirmations} confirmations)`
        : '';

      const { error: historyError } = await supabase.from('operation_history').insert({
        user_id: deposit.user_id,
        operation_type: 'deposit',
        amount: depositAmount,
        crypto_type: cryptoType,
        description: `Deposit completed: ${depositAmount} ${cryptoType} - ${txData.blockchain_hash || 'N/A'}${verificationNote}`,
      });

      if (historyError) {
        console.error('⚠️  Failed to log operation history:', historyError);
      }

      console.log('\n✅✅✅ DEPOSIT COMPLETED SUCCESSFULLY! ✅✅✅');
      console.log(`   User: ${deposit.users.telegram_id}`);
      console.log(`   Amount: ${depositAmount} ${cryptoType}`);
      console.log(`   New Balance: ${newBalance}`);
      if (moralisVerification?.verified) {
        console.log(`   Moralis Verified: ${moralisVerification.confirmations} confirmations`);
      }
      console.log('\n');
    }
  },

  async getDepositStatus(orderId) {
    const { data: deposit } = await supabase
      .from('deposits')
      .select('*, users(*)')
      .eq('order_id', orderId)
      .single();

    if (!deposit) throw new Error('Deposit not found');

    // If deposit is still pending, actively check WestWallet for updates
    if (deposit.status === 'pending' && deposit.payment_url) {
      console.log(`🔍 CHECK-STATUS: Deposit pending, querying WestWallet for address ${deposit.payment_url}`);

      try {
        // Query WestWallet transaction history for this crypto type
        const cryptoType = deposit.crypto_type || 'USDTTRC';
        const txHistory = await westwalletService.getTransactionHistory(cryptoType, 20, 0);

        if (txHistory && txHistory.length > 0) {
          // Find transaction(s) for this address
          const matchingTxs = txHistory.filter(tx => tx.address === deposit.payment_url && tx.status === 'completed');

          if (matchingTxs.length > 0) {
            console.log(`✅ CHECK-STATUS: Found ${matchingTxs.length} completed transaction(s) on WestWallet!`);

            // Use the most recent one
            const latestTx = matchingTxs[0];

            // Process it immediately via callback
            console.log(`🔄 CHECK-STATUS: Processing transaction ${latestTx.id} via callback...`);

            await this.processCallback(deposit.order_id, 'completed', {
              id: latestTx.id.toString(),
              amount: latestTx.amount,
              address: latestTx.address,
              currency: cryptoType,
              blockchain_hash: latestTx.blockchain_hash || '',
              blockchain_confirmations: latestTx.blockchain_confirmations || 0,
              dest_tag: latestTx.dest_tag || ''
            });

            // Fetch updated deposit after processing
            const { data: updatedDeposit } = await supabase
              .from('deposits')
              .select('*')
              .eq('order_id', orderId)
              .single();

            console.log(`✅ CHECK-STATUS: Deposit updated to '${updatedDeposit.status}'`);

            return {
              ...updatedDeposit,
              credited_amount: updatedDeposit.amount,
              currency: updatedDeposit.crypto_type
            };
          } else {
            console.log(`⏳ CHECK-STATUS: No completed transactions found yet on WestWallet`);
          }
        }
      } catch (err) {
        console.error(`⚠️  CHECK-STATUS: Error querying WestWallet:`, err.message);
      }
    }

    // Return current deposit status
    return {
      ...deposit,
      credited_amount: deposit.amount,
      currency: deposit.crypto_type
    };
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

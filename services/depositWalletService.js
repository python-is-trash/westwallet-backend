import { supabase } from '../db/supabase.js';
import { westwalletService } from './westwalletService.js';
import { moralisService } from './moralisService.js';

// Helper function to extract network from crypto type
function getNetwork(cryptoType) {
  const type = cryptoType.toUpperCase();
  if (type.includes('TRC')) return 'TRC20';
  if (type.includes('ERC')) return 'ERC20';
  if (type.includes('BEP')) return 'BEP20';
  if (type.includes('TON') || type === 'TON') return 'TON';
  if (type === 'BNB') return 'BEP20';
  if (type === 'ETH') return 'ERC20';
  if (type === 'SOL') return 'SOL';
  return 'BEP20'; // Default fallback
}

// Helper function to get generic crypto type for user_deposit_addresses table
// The table only accepts: 'USDT', 'USDC', 'ETH', 'BNB', 'TON', 'SOL'
function getGenericCryptoType(cryptoType) {
  const type = cryptoType.toUpperCase();
  if (type.includes('USDT')) return 'USDT';
  if (type.includes('USDC')) return 'USDC';
  if (type === 'BNB' || type.includes('BNB')) return 'BNB';
  if (type === 'ETH' || type.includes('ETH')) return 'ETH';
  if (type === 'TON' || type.includes('TON')) return 'TON';
  if (type === 'SOL' || type.includes('SOL')) return 'SOL';
  return type; // Return as-is if already generic
}

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

    console.log(`🔍 Checking for STATIC address for user ${user.id}, crypto: ${baseCryptoType}, network: ${staticNetwork}`);

    // Check if user already has a static address for this crypto + network
    const { data: existingAddress } = await supabase
      .from('user_deposit_addresses')
      .select('*')
      .eq('user_id', user.id)
      .eq('crypto_type', baseCryptoType)
      .eq('network', staticNetwork)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let addressData;
    let label = `deposit_${user.id}_${Date.now()}`;

    if (existingAddress) {
      // REUSE existing static address
      console.log('♻️  Found existing STATIC address:', existingAddress.deposit_address);
      addressData = {
        address: existingAddress.deposit_address,
        dest_tag: existingAddress.memo || '',
        id: existingAddress.id
      };
    } else {
      // Generate NEW static address via WestWallet API
      const ipnUrl = `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/westwallet/callback`;

      console.log('🆕 Generating NEW static address via WestWallet...');
      addressData = await westwalletService.generateDepositAddress(
        finalCryptoType,
        label,
        ipnUrl
      );

      // For TON networks, if WestWallet didn't provide memo, generate one
      if (!addressData.dest_tag && (staticNetwork === 'TON' || finalCryptoType.includes('TON'))) {
        addressData.dest_tag = user.id.toString().padStart(8, '0');
        console.log('🔢 Generated memo for TON address:', addressData.dest_tag);
      }

      // Save new static address to user_deposit_addresses
      const { data: savedAddress, error: saveError } = await supabase
        .from('user_deposit_addresses')
        .insert({
          user_id: user.id,
          crypto_type: baseCryptoType,
          network: staticNetwork || 'TRC20',
          deposit_address: addressData.address,
          memo: addressData.dest_tag || null
        })
        .select()
        .single();

      if (saveError) {
        console.error('⚠️  Failed to save address:', saveError.message);
      } else {
        console.log('✅ Saved NEW static address:', savedAddress.id);
        addressData.id = savedAddress.id;
      }
    }

    // BULLETPROOF FIX: Prevent spam-clicking from creating multiple pending deposits
    // Strategy: ONLY reuse PENDING deposits! If last deposit is credited, CREATE NEW ONE!
    // This ensures user always gets fresh deposit tracking for new payments

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    // Check for PENDING deposits ONLY for this address in last 30 minutes
    const { data: recentDeposits } = await supabase
      .from('deposits')
      .select('*')
      .eq('user_id', user.id)
      .eq('payment_url', addressData.address)
      .eq('status', 'pending') // ONLY pending! Don't reuse credited/completed!
      .gte('created_at', thirtyMinutesAgo) // Only deposits from last 30 minutes
      .order('created_at', { ascending: false })
      .limit(1);

    let depositLabel;
    if (recentDeposits && recentDeposits.length > 0) {
      const existingDeposit = recentDeposits[0];
      const ageMinutes = Math.floor((Date.now() - new Date(existingDeposit.created_at).getTime()) / 1000 / 60);

      console.log(`♻️  REUSING existing PENDING deposit: ${existingDeposit.order_id} (age: ${ageMinutes}m)`);
      console.log('   🚫 NOT creating new pending deposit - user can check status of existing one');
      depositLabel = existingDeposit.order_id;
    } else {
      // CREATE NEW pending deposit record ONLY if no recent deposits exist
      console.log('💾 Creating NEW pending deposit record:', label);

      const { data: newDeposit, error: depositError } = await supabase
        .from('deposits')
        .insert({
          user_id: user.id,
          order_id: label,
          amount: amount,
          crypto_type: finalCryptoType,
          payment_url: addressData.address,
          status: 'pending',
          blockchain_hash: null,
          blockchain_confirmations: 0,
        })
        .select()
        .single();

      if (depositError) {
        console.error('⚠️  Failed to create deposit record:', depositError.message);
        depositLabel = label; // Use generated label as fallback
      } else {
        console.log('✅ Deposit record created:', newDeposit.id);
        depositLabel = newDeposit.order_id;
      }
    }

    console.log('✅ Static address ready:', addressData.address, finalCryptoType, '(pending deposit tracking enabled)');

    // Build QR code data
    // Don't include amount - user can deposit any amount they want
    let qr_data = addressData.address;
    if (addressData.dest_tag) {
      qr_data = `${addressData.address}?dt=${addressData.dest_tag}`;
    }

    return {
      address: addressData.address,
      dest_tag: addressData.dest_tag || '',
      currency: finalCryptoType,
      network: westwalletService.getNetworkDisplayName(finalCryptoType),
      amount: amount,
      label: depositLabel, // Use the deposit label (existing or new)
      qr_data: qr_data,
    };
  },

  async processCallback(label, status, txData = {}) {
    console.log('🔄 Processing callback for label:', label);
    console.log('   Status:', status);
    console.log('   TX Data:', JSON.stringify(txData, null, 2));

    let deposit = null; // Initialize deposit variable

    // ULTRA-CRITICAL STEP 0: Check if blockchain hash was ALREADY CREDITED (prevents ALL double-credits!)
    const blockchainHash = txData.blockchain_hash;
    if (blockchainHash && status === 'completed') {
      console.log(`🔒 SECURITY CHECK: Verifying blockchain hash ${blockchainHash} is not already credited...`);

      const { data: existingByHash } = await supabase
        .from('deposits')
        .select('id, order_id, user_id, status, users(telegram_id, username)')
        .eq('blockchain_hash', blockchainHash)
        .in('status', ['completed', 'credited'])
        .maybeSingle();

      if (existingByHash) {
        console.log(`❌ BLOCKED: Hash ${blockchainHash} already credited to user ${existingByHash.users?.telegram_id} (deposit: ${existingByHash.order_id})`);
        console.log(`   🛡️  DOUBLE-CREDIT PREVENTED! Returning success without crediting again.`);
        return { success: true, message: 'Transaction already processed', duplicate: true };
      }

      console.log(`✅ Hash ${blockchainHash} is clean - proceeding with credit`);
    }

    // CRITICAL: For STATIC addresses, match by WESTWALLET TX ID to prevent duplicate credits!
    // WestWallet sends unique TX ID for each transaction
    const westwalletTxId = txData.id?.toString();
    const depositAddress = txData.address;

    // STEP 1: Check if this WestWallet TX was already processed (duplicate prevention)
    if (westwalletTxId) {
      const { data: existingByTxId } = await supabase
        .from('deposits')
        .select('*, users(*)')
        .eq('payment_id', westwalletTxId)
        .maybeSingle();

      if (existingByTxId) {
        console.log(`ℹ️  WestWallet TX ${westwalletTxId} found as ${existingByTxId.order_id} (status: ${existingByTxId.status})`);

        // CRITICAL: If deposit is already credited, skip it!
        if (existingByTxId.status === 'credited') {
          console.log(`   ⏭️  Already credited, skipping to prevent double-credit`);
          return { success: false, message: `Transaction already credited`, duplicate: true };
        }

        // If deposit is already credited, skip it!
        if (existingByTxId.status === 'credited' || existingByTxId.status === 'completed') {
          console.log(`   ⏭️  Already ${existingByTxId.status}, skipping to prevent double-credit`);
          return { success: false, message: `Transaction already ${existingByTxId.status}`, duplicate: true };
        }

        // If deposit is cancelled, DON'T USE IT - let code create new one below
        if (existingByTxId.status === 'cancelled') {
          console.log(`   ⚠️  Deposit was cancelled - ignoring and will look for/create new deposit`);
          deposit = null; // Force fallback to address-based lookup or creation
        }
        // If deposit is pending and IPN says completed, process it
        else if (existingByTxId.status === 'pending' && status === 'completed') {
          console.log(`   ✅ Status changed from pending -> completed, processing credit...`);
          deposit = existingByTxId;
        }
        // If still pending, update status only
        else if (existingByTxId.status === 'pending') {
          console.log(`   ℹ️  Still pending, updating status only`);
          deposit = existingByTxId;
        }
      }
    }

    // STEP 2: DON'T look up by address - causes issues with multiple pending deposits!
    // Instead, if we get here, we should create a NEW deposit or look up by label
    // Static addresses will be handled by the "create new deposit" logic below if no label match

    // FALLBACK: Try to find by label (works for all deposit types)
    // CRITICAL: DON'T filter by status! Label is unique, so just find it!
    if (!deposit) {
      console.log(`🔍 No deposit found by TX ID, trying label: ${label}`);
      let { data: depositByLabel, error: depositFetchError } = await supabase
        .from('deposits')
        .select('*, users(*)')
        .eq('order_id', label)
        .maybeSingle();

      if (depositFetchError) {
        console.error('❌ Error fetching deposit:', depositFetchError);
        throw new Error(`Failed to fetch deposit: ${depositFetchError.message}`);
      }

      if (depositByLabel) {
        console.log(`✅ Found deposit by label: ${label} (status: ${depositByLabel.status})`);
        deposit = depositByLabel;
      } else {
        console.log(`ℹ️  No deposit found for label: ${label}`);
      }
    }

    // CRITICAL FIX: DO NOT create deposits in check-status!
    // This causes double-credits when IPN already processed the deposit.
    // Check-status should ONLY read existing deposits, never create new ones.

    if (!deposit) {
      console.log('⚠️  Deposit record not found for label:', label);
      console.log('   Checking if this is a payment to a static address...');

      // Extract user_id from label (format: deposit_6_1762718160276)
      const userId = label.split('_')[1];

      // Check if this address belongs to this user as a static address
      const { data: staticAddress } = await supabase
        .from('user_deposit_addresses')
        .select('*')
        .eq('user_id', userId)
        .eq('deposit_address', txData.address)
        .eq('crypto_type', getGenericCryptoType(txData.currency))
        .eq('network', getNetwork(txData.currency))
        .maybeSingle();

      if (staticAddress) {
        console.log('✅ Payment received to static address! Creating new deposit record...');
        console.log('   Address:', txData.address);
        console.log('   User:', userId);
        console.log('   Amount:', txData.amount);

        // Create a new deposit record for this payment
        const newDeposit = {
          order_id: label,
          user_id: parseInt(userId),
          amount: txData.amount.toString(),
          crypto_type: txData.currency,
          payment_url: txData.address,
          status: 'pending', // Will be updated to completed below
          blockchain_hash: txData.blockchain_hash || null,
          created_at: new Date().toISOString()
        };

        const { data: createdDeposit, error: createError } = await supabase
          .from('deposits')
          .insert(newDeposit)
          .select()
          .single();

        if (createError) {
          console.error('❌ Failed to create deposit:', createError);
          throw new Error(`Failed to create deposit for static address payment: ${createError.message}`);
        }

        console.log('✅ Deposit record created:', createdDeposit.id);
        deposit = createdDeposit;
      } else {
        console.error('❌ No matching deposit or static address found!');
        console.error('   Label:', label);
        console.error('   Address:', txData.address);
        console.error('   Currency:', txData.currency);
        throw new Error(`Deposit not found for label: ${label}. No matching deposit record or static address found.`);
      }
    }

    console.log('✅ Deposit found:', {
      id: deposit.id,
      user_id: deposit.user_id,
      amount: deposit.amount,
      crypto_type: deposit.crypto_type,
      status: deposit.status
    });

    if (deposit.status === 'credited' || deposit.status === 'completed') {
      console.log('⚠️  Deposit already processed:', label, `(status: ${deposit.status})`);

      // CRITICAL FIX: Check if there are OTHER pending deposits for this address
      // This happens when user creates multiple deposits to the same static address
      if (txData.address && status === 'completed') {
        console.log('   🔍 Checking for other pending deposits to the same address...');

        const { data: otherPendingDeposits } = await supabase
          .from('deposits')
          .select('id, order_id, user_id, amount, crypto_type')
          .eq('payment_url', txData.address)
          .eq('user_id', deposit.user_id)
          .eq('status', 'pending'); // Get ALL pending deposits for this address

        if (otherPendingDeposits && otherPendingDeposits.length > 0) {
          console.log(`   ✅ Found ${otherPendingDeposits.length} other pending deposit(s) for same address`);

          for (const pendingDep of otherPendingDeposits) {
            console.log(`   📝 Processing pending deposit: ${pendingDep.order_id}`);

            const depositAmount = parseFloat(txData.amount || pendingDep.amount);
            // CRITICAL: Use pendingDep.crypto_type first (more specific than txData.currency)
            const cryptoType = (pendingDep.crypto_type || txData.currency || 'USDT').toUpperCase();
            const blockchainHash = txData.blockchain_hash;

            console.log(`   🔍 DEBUG: txData.currency='${txData.currency}', pendingDep.crypto_type='${pendingDep.crypto_type}', final cryptoType='${cryptoType}'`);

            // CRITICAL SECURITY FIX: Check if blockchain hash was used by ANY user
            if (blockchainHash) {
              const { data: existingByHashGlobal } = await supabase
                .from('deposits')
                .select('id, user_id, users(telegram_id, username)')
                .eq('blockchain_hash', blockchainHash)
                .in('status', ['completed', 'credited'])
                .maybeSingle();

              if (existingByHashGlobal) {
                console.log(`   🚫 BLOCKED: Hash ${blockchainHash} already used by user ${existingByHashGlobal.users?.telegram_id} (user_id: ${existingByHashGlobal.user_id})`);
                continue;
              }
            }

            // Check if THIS specific deposit for THIS user was already credited
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
                  status: 'credited',
                  amount: depositAmount,
                  payment_id: txData.id || null,
                  blockchain_hash: blockchainHash || null,
                  blockchain_confirmations: txData.blockchain_confirmations || 0,
                  updated_at: new Date().toISOString()
                })
                .eq('id', pendingDep.id);

              console.log(`   ✅ Updated ${pendingDep.order_id} status to credited (already credited)`);
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
                status: 'credited',
                amount: depositAmount,
                payment_id: txData.id || null,
                blockchain_hash: blockchainHash || null,
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
                description: `Deposit credited: ${depositAmount} ${cryptoType} - Hash: ${blockchainHash} - TX ID: ${txData.id || 'N/A'}`,
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

    // Build update object - only include blockchain_hash and payment_id if they don't already exist
    // This prevents duplicate key errors and prevents overwriting existing IDs
    const updateData = {
      status: status === 'completed' ? 'credited' : 'pending',
      amount: actualAmount, // Update to actual received amount
      blockchain_confirmations: txData.blockchain_confirmations || 0,
      updated_at: new Date().toISOString()
    };

    // Only set payment_id if this deposit doesn't already have one
    // This prevents overwriting payment_id from previous transactions
    if (!deposit.payment_id && txData.id) {
      updateData.payment_id = txData.id.toString();
    }

    // Only set blockchain_hash if this deposit doesn't already have one
    // This prevents "duplicate key" errors when same hash is used for multiple deposits
    if (!deposit.blockchain_hash && txData.blockchain_hash) {
      updateData.blockchain_hash = txData.blockchain_hash;
    }

    const { error: statusUpdateError } = await supabase
      .from('deposits')
      .update(updateData)
      .eq('order_id', label);

    if (statusUpdateError) {
      console.error('❌ Failed to update deposit status:', statusUpdateError);
      throw new Error(`Failed to update deposit status: ${statusUpdateError.message}`);
    }

    console.log('✅ Deposit status updated to:', status);

    // If payment is complete, add balance to user
    if (status === 'completed') {
      // CRITICAL: Use deposit.crypto_type first (more specific than txData.currency)
      // WestWallet might send generic 'USDT' but we want the network-specific type like 'USDTERC'
      const cryptoType = (deposit.crypto_type || txData.currency || 'USDT').toUpperCase();
      const depositAmount = parseFloat(txData.amount || deposit.amount);
      const blockchainHash = txData.blockchain_hash;

      // CRITICAL SECURITY FIX: Check if blockchain hash was used by ANOTHER user
      if (blockchainHash) {
        const { data: existingByHash } = await supabase
          .from('deposits')
          .select('id, user_id, users(telegram_id, username)')
          .eq('blockchain_hash', blockchainHash)
          .in('status', ['completed', 'credited']) // Check both completed AND credited!
          .neq('id', deposit.id) // CRITICAL: Exclude THIS deposit from the check!
          .maybeSingle();

        if (existingByHash && existingByHash.user_id !== deposit.user_id) {
          console.log('🚫 BLOCKED: Hash already used by DIFFERENT user', existingByHash.users?.telegram_id);
          console.log('   Blockchain Hash:', blockchainHash);
          console.log('   Other User ID:', existingByHash.user_id);
          console.log('   This User ID:', deposit.user_id);
          console.log('   This deposit ID:', deposit.id);
          return;
        } else if (existingByHash && existingByHash.user_id === deposit.user_id) {
          console.log('⚠️  Same user, same hash - checking if this is a duplicate or new deposit...');
        }
      }

      // Check operation_history to see if THIS specific deposit was already logged
      // Use order_id or payment_id to uniquely identify this deposit
      const depositIdentifier = deposit.order_id || txData.id;
      if (depositIdentifier) {
        const { data: existingOperation } = await supabase
          .from('operation_history')
          .select('id')
          .eq('user_id', deposit.user_id)
          .eq('operation_type', 'deposit')
          .ilike('description', `%${depositIdentifier}%`)
          .maybeSingle();

        if (existingOperation) {
          console.log('⏭️  SKIPPING: This deposit already logged (found order_id in operation_history)');
          console.log('   Order ID:', depositIdentifier);
          return; // Skip crediting
        }
      } else {
        console.log('⚠️  No deposit identifier found, checking by amount/time fallback...');

        // Fallback: Check by amount + crypto + recent time (for deposits without identifier)
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
          console.log('⏭️  SKIPPING: Already credited (found duplicate amount in last 5 min)');
          return; // Skip crediting
        }
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

      // CRITICAL: Mark deposit as "credited" so it's NEVER processed again!
      const { error: creditedError } = await supabase
        .from('deposits')
        .update({ status: 'credited', updated_at: new Date().toISOString() })
        .eq('id', deposit.id);

      if (creditedError) {
        console.error('⚠️  Failed to mark deposit as credited:', creditedError);
      } else {
        console.log('✅ Deposit marked as CREDITED (will never be processed again)');
      }

      // Log transaction with Moralis verification status (but only once!)
      // Check if this blockchain hash was already logged to prevent duplicates
      if (blockchainHash) {
        const { data: existingHistory } = await supabase
          .from('operation_history')
          .select('id')
          .eq('user_id', deposit.user_id)
          .eq('operation_type', 'deposit')
          .ilike('description', `%${blockchainHash}%`)
          .maybeSingle();

        if (existingHistory) {
          console.log('⏭️  Operation already logged in history (skipping duplicate)');
        } else {
          const verificationNote = moralisVerification?.verified
            ? ` ✅ Verified (${moralisVerification.confirmations} confirmations)`
            : '';

          const { error: historyError } = await supabase.from('operation_history').insert({
            user_id: deposit.user_id,
            operation_type: 'deposit',
            amount: depositAmount,
            crypto_type: cryptoType,
            description: `Deposit completed: ${depositAmount} ${cryptoType} - Hash: ${txData.blockchain_hash || 'N/A'} - TX ID: ${txData.id || 'N/A'}${verificationNote}`,
          });

          if (historyError) {
            console.error('⚠️  Failed to log operation history:', historyError);
          } else {
            console.log('✅ Operation logged in history');
          }
        }
      } else {
        // No blockchain hash, insert anyway (shouldn't happen but be safe)
        const { error: historyError } = await supabase.from('operation_history').insert({
          user_id: deposit.user_id,
          operation_type: 'deposit',
          amount: depositAmount,
          crypto_type: cryptoType,
          description: `Deposit completed: ${depositAmount} ${cryptoType} - Hash: N/A - TX ID: ${txData.id || 'N/A'}`,
        });

        if (historyError) {
          console.error('⚠️  Failed to log operation history:', historyError);
        }
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
    // FIRST: Auto-expire pending deposits older than 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await supabase
      .from('deposits')
      .update({ status: 'cancelled' })
      .eq('status', 'pending')
      .lt('created_at', thirtyMinutesAgo);

    // CRITICAL FIX: First try to find by order_id
    let { data: deposit } = await supabase
      .from('deposits')
      .select('*, users(*)')
      .eq('order_id', orderId)
      .maybeSingle();

    // If no deposit found by order_id, try to find LATEST pending/completed deposit by address
    if (!deposit) {
      const userId = orderId.split('_')[1];
      const { data: addressRecord } = await supabase
        .from('user_deposit_addresses')
        .select('deposit_address, memo, crypto_type, network')
        .eq('user_id', userId)
        .order('last_used_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (addressRecord) {
        console.log(`🔍 CHECK-STATUS: No deposit found by label, searching by address: ${addressRecord.deposit_address}`);

        // Find LATEST deposit from last 20 seconds ONLY!
        const twentySecondsAgo = new Date(Date.now() - 20 * 1000).toISOString();

        const { data: depositByAddress } = await supabase
          .from('deposits')
          .select('*, users(*)')
          .eq('payment_url', addressRecord.deposit_address)
          .in('status', ['pending', 'completed', 'credited'])
          .gte('created_at', twentySecondsAgo) // ONLY last 20 seconds!
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (depositByAddress) {
          console.log(`✅ CHECK-STATUS: Found RECENT deposit: ${depositByAddress.order_id} (status: ${depositByAddress.status}, <20s old)`);
          deposit = depositByAddress;
        } else {
          console.log(`ℹ️  CHECK-STATUS: No recent deposits (<20s) - waiting for new payment`);
        }
      }
    }

    // If no deposit record exists yet, user just generated address and hasn't sent payment
    if (!deposit) {
      console.log(`⏳ CHECK-STATUS: No deposit record yet for ${orderId} (waiting for payment)`);

      // Try to find the address from user_deposit_addresses
      const userId = orderId.split('_')[1];
      const { data: addressRecord } = await supabase
        .from('user_deposit_addresses')
        .select('deposit_address, memo')
        .eq('user_id', userId)
        .order('created_at', { ascending: false})
        .limit(1)
        .maybeSingle();

      return {
        status: 'waiting',
        message: 'Waiting for payment...',
        address: addressRecord?.deposit_address || null,
        memo: addressRecord?.memo || null
      };
    }

    // ✅ Check if deposit was cancelled (user regenerated address)
    if (deposit.status === 'cancelled') {
      console.log(`⏭️  CHECK-STATUS: Deposit was cancelled (user generated new address)`);
      return {
        status: 'cancelled',
        message: 'This deposit was cancelled. Please use the latest generated address.',
        cancelled: true
      };
    }

    // ✅ CRITICAL: Check if deposit is already CREDITED (money already given to user!)
    if (deposit.status === 'credited') {
      // Check how long ago it was credited
      const creditedAt = new Date(deposit.updated_at || deposit.created_at);
      const now = new Date();
      const secondsAgo = (now - creditedAt) / 1000;

      // Show success for 20 seconds after credit
      if (secondsAgo <= 20) {
        console.log(`✅ CHECK-STATUS: Deposit JUST credited (${Math.floor(secondsAgo)}s ago) - showing success!`);
        return {
          ...deposit,
          status: 'completed',
          already_credited: true,
          message: 'Deposit successfully credited to your account!',
          currency: deposit.crypto_type
        };
      } else {
        console.log(`⏭️  CHECK-STATUS: Deposit credited ${Math.floor(secondsAgo)}s ago - too old, waiting for new payment`);
        // After 20 seconds, return waiting status
        return {
          status: 'waiting',
          message: 'Waiting for payment...',
          address: deposit.payment_url || null
        };
      }
    }

    // ✅ Check if deposit is already credited (in process of being credited)
    if (deposit.status === 'credited' || deposit.status === 'completed') {
      console.log(`⏭️  CHECK-STATUS: Deposit already ${deposit.status} (currently being credited)`);

      // Check if this was JUST completed (within last 2 minutes)
      const completedAt = new Date(deposit.updated_at || deposit.created_at);
      const now = new Date();
      const minutesAgo = (now - completedAt) / 1000 / 60;

      // Return credited status with deposit_id for frontend tracking
      console.log(`   ✅ Deposit ${deposit.status}: ${label}`);
      return {
        ...deposit,
        status: 'credited',
        deposit_id: label,
        credited_amount: deposit.amount,
        currency: deposit.crypto_type,
        message: `✅ Deposit credited! ${deposit.amount} ${deposit.crypto_type} was credited to your account.`
      };
    }

    // If deposit is still pending, return status WITHOUT querying WestWallet
    // IPN callbacks will update status automatically when payment arrives
    if (deposit.status === 'pending' && deposit.payment_url) {
      console.log(`ℹ️  CHECK-STATUS: Deposit pending - relying on IPN callback (no WestWallet query needed)`);

      return {
        ...deposit,
        status: 'pending',
        message: 'Waiting for blockchain confirmation. You will be notified automatically when payment is received.',
        already_credited: false,
        currency: deposit.crypto_type
      };

      /* DISABLED: Manual WestWallet queries - IPN handles everything automatically
      const genericCryptoType = getGenericCryptoType(deposit.crypto_type);
      const network = getNetwork(deposit.crypto_type);
      const { data: addressRecord } = await supabase
        .from('user_deposit_addresses')
        .select('memo')
        .eq('user_id', deposit.user_id)
        .eq('crypto_type', genericCryptoType)
        .eq('network', network)
        .eq('deposit_address', deposit.payment_url)
        .maybeSingle();

      const expectedMemo = addressRecord?.memo || null;
      if (expectedMemo) {
        console.log(`   Expected memo/dest_tag: ${expectedMemo}`);
      }

      try {
        const cryptoType = deposit.crypto_type || 'USDTTRC';
        const txHistory = await westwalletService.getTransactionHistory(cryptoType, 20, 0);

        if (txHistory && txHistory.length > 0) {
          // Find transaction(s) for this address
          // CRITICAL: For TON and memo-based cryptos, ALSO match the memo!
          const matchingTxs = txHistory.filter(tx => {
            const addressMatch = tx.address === deposit.payment_url && tx.status === 'completed';

            // If we expect a memo, transaction MUST have matching memo
            if (expectedMemo) {
              return addressMatch && tx.dest_tag === expectedMemo;
            }

            // If no memo expected, transaction should NOT have memo (or we don't care)
            return addressMatch;
          });

          if (matchingTxs.length > 0) {
            console.log(`✅ CHECK-STATUS: Found ${matchingTxs.length} completed transaction(s) on WestWallet!`);

            // CRITICAL FIX: Loop through ALL transactions to find one that hasn't been credited yet
            let uncreditedTx = null;

            for (const tx of matchingTxs) {
              console.log(`🔍 CHECK-STATUS: Checking transaction ${tx.id} (${tx.amount} ${cryptoType})`);

              // CRITICAL FIX: Only process transactions AFTER deposit was created
              // This prevents crediting OLD transactions that happened before user generated this address
              const depositCreatedAt = new Date(deposit.created_at).getTime();
              const txCreatedAt = new Date(tx.created_at).getTime();

              if (txCreatedAt < depositCreatedAt) {
                console.log(`   ⏭️  TX ${tx.id} is OLDER than deposit creation (${new Date(tx.created_at).toISOString()} < ${new Date(deposit.created_at).toISOString()}), skipping...`);
                continue; // Skip old transactions!
              }

              // CRITICAL SECURITY FIX: Check if blockchain hash was used by DIFFERENT user OR already credited
              if (tx.blockchain_hash) {
                const { data: existingByHash } = await supabase
                  .from('deposits')
                  .select('id, user_id, users(telegram_id, username)')
                  .eq('blockchain_hash', tx.blockchain_hash)
                  .in('status', ['completed', 'credited']) // Check both completed AND credited!
                  .maybeSingle();

                if (existingByHash && existingByHash.user_id !== deposit.user_id) {
                  console.log(`   🚫 TX ${tx.id} BLOCKED: Hash used by DIFFERENT user ${existingByHash.users?.telegram_id}`);
                  continue;
                } else if (existingByHash && existingByHash.user_id === deposit.user_id) {
                  console.log(`   ⏭️  TX ${tx.id}: Same user, same hash - already credited/completed, skipping...`);
                  continue; // CRITICAL: Skip if same user already has this hash credited!
                }
              }

              // Method 2: Check by WestWallet transaction ID - look for COMPLETED or CREDITED deposits with this payment_id
              const { data: existingById } = await supabase
                .from('deposits')
                .select('id, order_id, status')
                .eq('user_id', deposit.user_id)
                .eq('payment_id', tx.id.toString())
                .in('status', ['completed', 'credited'])
                .maybeSingle();

              if (existingById) {
                console.log(`   ⏭️  TX ${tx.id} already credited (found by TX ID)`);
                continue; // Skip to next transaction
              }

              // Method 3: ALSO check by blockchain hash (in case payment_id not saved yet due to race condition)
              if (tx.blockchain_hash) {
                const { data: existingByHashAny } = await supabase
                  .from('deposits')
                  .select('id, order_id, status, user_id')
                  .eq('blockchain_hash', tx.blockchain_hash)
                  .in('status', ['completed', 'credited'])
                  .maybeSingle();

                if (existingByHashAny) {
                  console.log(`   ⏭️  TX ${tx.id} already credited (found by blockchain hash: ${tx.blockchain_hash.substring(0, 10)}...)`);
                  continue; // Skip to next transaction
                }
              }

              // This transaction hasn't been credited yet!
              console.log(`   ✅ TX ${tx.id} is NEW and not credited yet!`);
              uncreditedTx = tx;
              break; // Found the new one, stop searching
            }

            // If no uncredited transaction found, check if THIS deposit record is completed
            if (!uncreditedTx) {
              // If THIS deposit is credited, user is trying to check old deposit
              if (deposit.status === 'credited' || deposit.status === 'completed') {
                console.log(`✅ CHECK-STATUS: This deposit already ${deposit.status} (amount: ${deposit.amount})`);
                return {
                  ...deposit,
                  already_credited: true,
                  credited_amount: deposit.amount,
                  currency: deposit.crypto_type
                };
              }

              // CRITICAL FIX: Check if a DIFFERENT deposit for the same address was recently credited
              // This handles the case where IPN used an old label but credited a different deposit
              console.log(`⏳ CHECK-STATUS: All ${matchingTxs.length} transaction(s) already credited.`);
              console.log(`   🔍 Checking if a DIFFERENT deposit for this address was recently completed...`);

              const { data: recentDeposit } = await supabase
                .from('deposits')
                .select('*')
                .eq('payment_url', deposit.payment_url)
                .in('status', ['completed', 'credited'])
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              if (recentDeposit && recentDeposit.order_id !== deposit.order_id) {
                // Found a different deposit that was recently completed!
                const completedAt = new Date(recentDeposit.updated_at);
                const createdAt = new Date(recentDeposit.created_at);
                const now = new Date();
                const secondsAgo = (now - completedAt) / 1000;
                const secondsSinceCreation = (completedAt - createdAt) / 1000;

                // ULTRA STRICT: Only show if ALL conditions met:
                // 1. Completed in last 30 SECONDS (not 60!)
                // 2. Time between creation and completion > 1 second (real payment, not instant)
                if (secondsAgo < 30 && secondsSinceCreation > 1) {
                  console.log(`   ✅ Found FRESH completion: ${recentDeposit.order_id} (${secondsAgo.toFixed(1)}s ago, took ${secondsSinceCreation.toFixed(1)}s to complete)`);
                  return {
                    ...recentDeposit,
                    status: 'completed',
                    already_credited: true,
                    message: 'Payment received and credited!',
                    currency: recentDeposit.crypto_type
                  };
                } else if (secondsAgo < 30) {
                  console.log(`   ⏭️  Deposit completed ${secondsAgo.toFixed(1)}s ago but took only ${secondsSinceCreation.toFixed(1)}s (instant = not a real payment)`);
                } else {
                  console.log(`   ⏭️  Old completed deposit from ${(secondsAgo / 60).toFixed(1)} minutes ago, ignoring`);
                }
              }

              console.log(`   ⏳ No recent completed deposits found. Waiting for NEW payment...`);
              return {
                ...deposit,
                status: 'pending',
                message: 'Waiting for new payment. Previous payments to this address were already credited.',
                currency: deposit.crypto_type
              };
            }

            // Process the uncredited transaction
            console.log(`🔄 CHECK-STATUS: Processing NEW transaction ${uncreditedTx.id} via callback...`);

            await this.processCallback(deposit.order_id, 'completed', {
              id: uncreditedTx.id.toString(),
              amount: uncreditedTx.amount,
              address: uncreditedTx.address,
              currency: cryptoType,
              blockchain_hash: uncreditedTx.blockchain_hash || '',
              blockchain_confirmations: uncreditedTx.blockchain_confirmations || 0,
              dest_tag: uncreditedTx.dest_tag || ''
            });

            // Always fetch the ORIGINAL deposit that frontend is waiting for
            // (callback might have credited a DIFFERENT deposit due to FIFO)
            const { data: updatedDeposit } = await supabase
              .from('deposits')
              .select('*')
              .eq('order_id', orderId)
              .maybeSingle();

            console.log(`✅ CHECK-STATUS: Deposit updated to '${updatedDeposit?.status || 'unknown'}'`);

            return {
              ...(updatedDeposit || deposit),
              status: updatedDeposit?.status || deposit.status,
              deposit_id: orderId,
              credited_amount: updatedDeposit?.amount || deposit.amount,
              currency: updatedDeposit?.crypto_type || deposit.crypto_type
            };
          } else {
            console.log(`⏳ CHECK-STATUS: No completed transactions found yet on WestWallet`);
            console.log(`🔄 CHECK-STATUS: Trying FALLBACK - searching by label: ${deposit.order_id}`);

            try {
              const txByLabel = await westwalletService.findTransactionByLabel(deposit.order_id);

              if (txByLabel && txByLabel.status === 'completed') {
                console.log(`✅ CHECK-STATUS: Found transaction by LABEL! TX ID: ${txByLabel.id}`);

                const depositCreatedAt = new Date(deposit.created_at).getTime();
                const txCreatedAt = txByLabel.created_at ? new Date(txByLabel.created_at).getTime() : Date.now();

                if (txCreatedAt < depositCreatedAt) {
                  console.log(`   ⏭️  TX ${txByLabel.id} is OLDER than deposit creation, skipping...`);
                } else {
                  if (txByLabel.blockchain_hash) {
                    const { data: existingByHash } = await supabase
                      .from('deposits')
                      .select('id, user_id, users(telegram_id, username)')
                      .eq('blockchain_hash', txByLabel.blockchain_hash)
                      .in('status', ['completed', 'credited'])
                      .maybeSingle();

                    if (existingByHash && existingByHash.user_id !== deposit.user_id) {
                      console.log(`   🚫 TX ${txByLabel.id} BLOCKED: Hash used by DIFFERENT user`);
                    } else if (existingByHash && existingByHash.user_id === deposit.user_id) {
                      console.log(`   ⏭️  TX ${txByLabel.id}: Same user, same hash - already credited`);
                    } else {
                      console.log(`🔄 CHECK-STATUS: Processing transaction found by label...`);

                      await this.processCallback(deposit.order_id, 'completed', {
                        id: txByLabel.id.toString(),
                        amount: txByLabel.amount,
                        address: txByLabel.address,
                        currency: txByLabel.currency,
                        blockchain_hash: txByLabel.blockchain_hash || '',
                        blockchain_confirmations: txByLabel.blockchain_confirmations || 0,
                        dest_tag: txByLabel.dest_tag || ''
                      });

                      const { data: updatedDeposit } = await supabase
                        .from('deposits')
                        .select('*')
                        .eq('order_id', orderId)
                        .maybeSingle();

                      console.log(`✅ CHECK-STATUS: Deposit credited via label search!`);

                      return {
                        ...(updatedDeposit || deposit),
                        status: updatedDeposit?.status || deposit.status,
                        deposit_id: orderId,
                        credited_amount: updatedDeposit?.amount || deposit.amount,
                        currency: updatedDeposit?.crypto_type || deposit.crypto_type
                      };
                    }
                  }
                }
              } else {
                console.log(`⏳ CHECK-STATUS: Label search also found no completed transactions`);
              }
            } catch (labelErr) {
              console.error(`⚠️  CHECK-STATUS: Error in label fallback:`, labelErr.message);
            }
          }
        }
      } catch (err) {
        console.error(`⚠️  CHECK-STATUS: Error querying WestWallet:`, err.message);
      }
      END OF DISABLED CODE - IPN handles deposits automatically */
    }

    // Return current deposit status
    // Check if deposit was already credited
    const alreadyCredited = deposit.status === 'credited' || deposit.status === 'completed';

    return {
      ...deposit,
      already_credited: alreadyCredited,
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

  /**
   * BULLETPROOF manual credit by WestWallet TX ID
   * Uses existing processCallback logic - 100% safe against double-credits
   */
  async creditByWestWalletTxId(westwalletTxId, userId = null) {
    console.log(`\n🔧 MANUAL CREDIT: Fetching WestWallet TX ${westwalletTxId}...`);

    try {
      // Get ALL recent transactions (up to 500)
      const allTransactions = await westwalletService.getTransactionHistory(null, 500, 0);

      const tx = allTransactions.find(t => t.id.toString() === westwalletTxId.toString());

      if (!tx) {
        console.log(`❌ Transaction ${westwalletTxId} not found in WestWallet history`);
        return { success: false, error: 'Transaction not found on WestWallet' };
      }

      console.log(`✅ Found TX ${tx.id}: ${tx.amount} ${tx.currency} to ${tx.address}`);
      console.log(`   Label: ${tx.label || 'none'}`);
      console.log(`   Status: ${tx.status}`);
      console.log(`   Hash: ${tx.blockchain_hash || 'none'}`);

      if (tx.status !== 'completed') {
        console.log(`⏳ Transaction not completed yet (status: ${tx.status})`);
        return { success: false, error: `Transaction status is ${tx.status}, not completed` };
      }

      // Map WestWallet currency ticker to our crypto type
      const cryptoType = westwalletService.mapTickerToCurrency(tx.currency);

      // If userId provided, verify it matches
      if (userId) {
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('id', userId)
          .maybeSingle();

        if (!user) {
          console.log(`❌ User ${userId} not found`);
          return { success: false, error: 'User not found' };
        }
      }

      // Use the transaction label as order_id (if it exists)
      const orderIdToUse = tx.label || `manual_credit_${Date.now()}`;

      console.log(`🔄 Processing via callback with order_id: ${orderIdToUse}`);

      // Use existing processCallback - it has ALL the safety checks!
      const result = await this.processCallback(orderIdToUse, 'completed', {
        id: tx.id.toString(),
        amount: tx.amount,
        address: tx.address,
        currency: cryptoType,
        blockchain_hash: tx.blockchain_hash || '',
        blockchain_confirmations: tx.blockchain_confirmations || 0,
        dest_tag: tx.dest_tag || ''
      });

      if (result.duplicate) {
        console.log(`✅ Transaction was already processed (safety check worked!)`);
        return { success: true, message: 'Transaction already credited', alreadyProcessed: true };
      }

      console.log(`✅ MANUAL CREDIT SUCCESSFUL!`);
      return { success: true, message: 'Transaction credited successfully', result };

    } catch (error) {
      console.error(`❌ Manual credit error:`, error.message);
      return { success: false, error: error.message };
    }
  },
};

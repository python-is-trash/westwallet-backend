import { supabase } from '../db/supabase.js';

// Fetch live crypto prices from CoinGecko
async function getLiveCryptoPrices() {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,solana,binancecoin,ethereum&vs_currencies=usd'
    );
    const data = await response.json();

    return {
      TON: data['the-open-network']?.usd || 2.05,
      SOL: data['solana']?.usd || 150,
      BNB: data['binancecoin']?.usd || 600,
      ETH: data['ethereum']?.usd || 3000,
      USDT: 1,
      USDC: 1
    };
  } catch (error) {
    console.error('Failed to fetch live prices:', error);
    return { TON: 2.05, SOL: 150, BNB: 600, ETH: 3000, USDT: 1, USDC: 1 };
  }
}

export const exportService = {
  // Expose getLiveCryptoPrices for external use
  getLiveCryptoPrices,
  /**
   * Export all users
   */
  async exportAllUsers() {
    const { data: users } = await supabase
      .from('users')
      .select(`
        *,
        deposits (amount, status, crypto_type, created_at)
      `)
      .order('created_at', { ascending: false });

    // Calculate total deposits for each user
    const usersWithDeposits = users?.map(user => {
      const completedDeposits = user.deposits?.filter(d => d.status === 'completed' || d.status === 'credited') || [];
      const totalDeposits = completedDeposits.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);

      return {
        ...user,
        total_deposits: totalDeposits,
        deposit_count: completedDeposits.length
      };
    }) || [];

    return usersWithDeposits;
  },

  /**
   * Export users with X+ referrals
   */
  async exportUsersByReferralCount(minCount) {
    const { data: users } = await supabase
      .rpc('get_users_by_referral_count', { min_count: minCount });

    return users || [];
  },

  /**
   * Export users whose referrals made deposits
   */
  async exportUsersWithReferralDeposits() {
    const { data: users } = await supabase
      .from('users')
      .select(`
        *,
        referrals!referrals_referrer_id_fkey (
          referred_id,
          referred:users!referrals_referred_id_fkey (
            id,
            deposits (id, amount, status)
          )
        )
      `);

    // Filter users who have referrals with deposits
    const filtered = users?.filter(user => {
      return user.referrals?.some(ref =>
        ref.referred?.deposits?.length > 0
      );
    }) || [];

    return filtered;
  },

  /**
   * Export users with deposits >= min_amount
   */
  async exportUsersByDepositAmount(minAmount) {
    const { data } = await supabase
      .from('users')
      .select(`
        *,
        deposits (amount, status)
      `);

    // Calculate total deposits and filter
    const filtered = data?.map(user => {
      const totalDeposits = user.deposits
        ?.filter(d => d.status === 'completed' || d.status === 'credited')
        ?.reduce((sum, d) => sum + parseFloat(d.amount), 0) || 0;

      return {
        ...user,
        total_deposits: totalDeposits
      };
    }).filter(user => user.total_deposits >= minAmount) || [];

    return filtered;
  },

  /**
   * Export users with active investments
   */
  async exportActiveInvestors() {
    const { data: users } = await supabase
      .from('users')
      .select(`
        *,
        investments!investments_user_id_fkey (
          id, amount, status, crypto_type
        ),
        deposits (amount, status, crypto_type, created_at)
      `)
      .order('created_at', { ascending: false });

    // Calculate deposits for ALL users first
    const usersWithData = users?.map(user => {
      const completedDeposits = user.deposits?.filter(d => d.status === 'completed' || d.status === 'credited') || [];
      const totalDeposits = completedDeposits.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
      const hasActiveInvestments = user.investments?.some(inv => inv.status === 'active');

      return {
        ...user,
        total_deposits: totalDeposits,
        deposit_count: completedDeposits.length,
        has_active_investments: hasActiveInvestments
      };
    }) || [];

    // Filter: Include users who have active investments OR users who have made deposits
    const filtered = usersWithData.filter(user =>
      user.has_active_investments || user.deposit_count > 0
    );

    return filtered;
  },

  /**
   * Export top earners by referral earnings
   */
  async exportTopEarners(limit = 100) {
    const { data } = await supabase
      .from('users')
      .select(`
        *,
        referral_earnings!referral_earnings_referrer_id_fkey (amount)
      `);

    // Calculate total earnings and sort
    const withEarnings = data?.map(user => {
      const totalEarnings = user.referral_earnings
        ?.reduce((sum, e) => sum + parseFloat(e.amount), 0) || 0;

      return {
        ...user,
        total_earnings: totalEarnings
      };
    }).sort((a, b) => b.total_earnings - a.total_earnings)
      .slice(0, limit) || [];

    return withEarnings;
  },

  /**
   * Export deposits made today
   */
  async exportDepositsToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: deposits } = await supabase
      .from('deposits')
      .select(`
        *,
        users (telegram_id, username, first_name, last_name)
      `)
      .in('status', ['completed', 'credited'])
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false });

    return deposits || [];
  },

  /**
   * Export deposits in last X hours
   */
  async exportDepositsByTime(hours) {
    const timeAgo = new Date();
    timeAgo.setHours(timeAgo.getHours() - hours);

    const { data: deposits } = await supabase
      .from('deposits')
      .select(`
        *,
        users (telegram_id, username, first_name, last_name)
      `)
      .in('status', ['completed', 'credited'])
      .gte('created_at', timeAgo.toISOString())
      .order('created_at', { ascending: false });

    return deposits || [];
  },

  /**
   * Export deposits in date range
   */
  async exportDepositsByDateRange(startDate, endDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const { data: deposits } = await supabase
      .from('deposits')
      .select(`
        *,
        users (telegram_id, username, first_name, last_name)
      `)
      .in('status', ['completed', 'credited'])
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false });

    return deposits || [];
  },

  /**
   * Export all deposits with filters
   */
  async exportAllDeposits(status = 'all') {
    let query = supabase
      .from('deposits')
      .select(`
        *,
        users (telegram_id, username, first_name, last_name)
      `);

    // Filter by status if not 'all'
    if (status !== 'all') {
      if (status === 'completed') {
        // Include both 'completed' and 'credited' for completed deposits
        query = query.in('status', ['completed', 'credited']);
      } else {
        query = query.eq('status', status);
      }
    }

    const { data: deposits } = await query.order('created_at', { ascending: false });

    return deposits || [];
  },

  /**
   * Export withdrawals - today
   */
  async exportWithdrawalsToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: withdrawals } = await supabase
      .from('withdrawals')
      .select(`
        *,
        users (telegram_id, username, first_name, last_name)
      `)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false });

    return withdrawals || [];
  },

  /**
   * Export withdrawals in last X hours
   */
  async exportWithdrawalsByTime(hours) {
    const timeAgo = new Date();
    timeAgo.setHours(timeAgo.getHours() - hours);

    const { data: withdrawals } = await supabase
      .from('withdrawals')
      .select(`
        *,
        users (telegram_id, username, first_name, last_name)
      `)
      .gte('created_at', timeAgo.toISOString())
      .order('created_at', { ascending: false });

    return withdrawals || [];
  },

  /**
   * Export withdrawals in date range
   */
  async exportWithdrawalsByDateRange(startDate, endDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const { data: withdrawals } = await supabase
      .from('withdrawals')
      .select(`
        *,
        users (telegram_id, username, first_name, last_name)
      `)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false });

    return withdrawals || [];
  },

  /**
   * Export all withdrawals by status
   */
  async exportAllWithdrawals(status = 'approved') {
    const { data: withdrawals } = await supabase
      .from('withdrawals')
      .select(`
        *,
        users (telegram_id, username, first_name, last_name)
      `)
      .eq('status', status)
      .order('created_at', { ascending: false });

    return withdrawals || [];
  },

  /**
   * Convert UTC timestamp to UTC+3 (Moscow time)
   */
  toUTC3(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    // Add 3 hours in milliseconds
    const utc3Date = new Date(date.getTime() + (3 * 60 * 60 * 1000));
    return utc3Date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC+3';
  },

  /**
   * Convert crypto amount to USD equivalent using provided live prices
   * This is a SYNC helper function
   */
  convertToUSDSync(amount, cryptoType, livePrices) {
    const rates = {
      'USDT': 1,
      'USDTBEP': 1,
      'USDTERC': 1,
      'USDTTRC': 1,
      'USDTTON': 1,
      'USDC': 1,
      'USDCERC': 1,
      'USDCBEP': 1,
      'BNB': livePrices.BNB,
      'ETH': livePrices.ETH,
      'TON': livePrices.TON,
      'SOL': livePrices.SOL
    };

    const rate = rates[cryptoType] || 1;
    return (parseFloat(amount) * rate).toFixed(2);
  },

  /**
   * Format deposits as CSV with USD conversion using LIVE prices
   */
  async formatDepositsAsCSV(deposits) {
    if (!deposits || deposits.length === 0) {
      return 'No deposits found';
    }

    // Fetch live prices ONCE at the beginning
    const livePrices = await getLiveCryptoPrices();
    console.log('📊 Deposits export using live prices:', livePrices);

    const headers = [
      'Deposit ID',
      'User Telegram ID',
      'Username',
      'First Name',
      'Amount USD',
      'Amount Crypto',
      'Crypto Type',
      'Status',
      'Order ID',
      'Payment ID',
      'Blockchain Hash',
      'Confirmations',
      'Verified',
      'Created At',
      'Updated At'
    ].join(',');

    const rows = deposits.map(deposit => {
      const amountUSD = this.convertToUSDSync(deposit.amount, deposit.crypto_type, livePrices);
      return [
        deposit.id,
        deposit.users?.telegram_id || 'N/A',
        deposit.users?.username || '',
        deposit.users?.first_name || '',
        amountUSD,
        deposit.amount,
        deposit.crypto_type,
        deposit.status,
        deposit.order_id || '',
        deposit.payment_id || '',
        deposit.blockchain_hash || '',
        deposit.blockchain_confirmations || 0,
        deposit.blockchain_verified ? 'Yes' : 'No',
        this.toUTC3(deposit.created_at),
        this.toUTC3(deposit.updated_at)
      ].join(',');
    });

    // Calculate totals in USD using LIVE prices
    const totalUSD = deposits.reduce((sum, d) => {
      return sum + parseFloat(this.convertToUSDSync(d.amount, d.crypto_type, livePrices));
    }, 0);

    const summary = [
      '',
      'TOTAL',
      '',
      '',
      totalUSD.toFixed(2),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      `Count: ${deposits.length}`,
      ''
    ].join(',');

    return [headers, ...rows, '', summary].join('\n');
  },

  /**
   * Format withdrawals as CSV with USD conversion using LIVE prices
   */
  async formatWithdrawalsAsCSV(withdrawals) {
    if (!withdrawals || withdrawals.length === 0) {
      return 'No withdrawals found';
    }

    // Fetch live prices ONCE
    const livePrices = await getLiveCryptoPrices();
    console.log('📊 Withdrawals export using live prices:', livePrices);

    const headers = [
      'Withdrawal ID',
      'User Telegram ID',
      'Username',
      'First Name',
      'Amount USD',
      'Amount Crypto',
      'Crypto Type',
      'Status',
      'Wallet Address',
      'Memo',
      'Network',
      'Blockchain Hash',
      'Admin Notes',
      'Created At',
      'Processed At'
    ].join(',');

    const rows = withdrawals.map(withdrawal => {
      const amountUSD = this.convertToUSDSync(withdrawal.amount, withdrawal.crypto_type, livePrices);
      return [
        withdrawal.id,
        withdrawal.users?.telegram_id || 'N/A',
        withdrawal.users?.username || '',
        withdrawal.users?.first_name || '',
        amountUSD,
        withdrawal.amount,
        withdrawal.crypto_type,
        withdrawal.status,
        withdrawal.wallet_address || '',
        withdrawal.memo || '',
        withdrawal.network || '',
        withdrawal.blockchain_hash || '',
        withdrawal.admin_notes || '',
        this.toUTC3(withdrawal.created_at),
        this.toUTC3(withdrawal.processed_at)
      ].join(',');
    });

    // Calculate totals in USD using LIVE prices
    const totalUSD = withdrawals.reduce((sum, w) => {
      return sum + parseFloat(this.convertToUSDSync(w.amount, w.crypto_type, livePrices));
    }, 0);

    const summary = [
      '',
      'TOTAL',
      '',
      '',
      totalUSD.toFixed(2),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      `Count: ${withdrawals.length}`,
      ''
    ].join(',');

    return [headers, ...rows, '', summary].join('\n');
  },

  /**
   * Format users as CSV
   */
  formatAsCSV(users) {
    if (!users || users.length === 0) {
      return 'No users found';
    }

    const headers = [
      'ID',
      'Telegram ID',
      'Username',
      'First Name',
      'Total Deposits',
      'Deposit Count',
      'Balance USDT',
      'Balance USDTBEP',
      'Balance USDTERC',
      'Balance USDTTRC',
      'Balance USDTTON',
      'Balance USDC',
      'Balance TON',
      'Balance SOL',
      'Balance BNB',
      'Balance ETH',
      'Balance STARS',
      'IP Address',
      'Device Fingerprint',
      'Referral Code',
      'Registration Date',
      'Last Activity'
    ].join(',');

    const rows = users.map(user => [
      user.id,
      user.telegram_id,
      user.username || '',
      user.first_name || '',
      user.total_deposits || 0,
      user.deposit_count || 0,
      user.balance_usdt || 0,
      user.balance_usdtbep || 0,
      user.balance_usdterc || 0,
      user.balance_usdttrc || 0,
      user.balance_usdtton || 0,
      user.balance_usdc || 0,
      user.balance_ton || 0,
      user.balance_sol || 0,
      user.balance_bnb || 0,
      user.balance_eth || 0,
      user.balance_stars || 0,
      user.ip_address || '',
      user.device_fingerprint || '',
      user.referral_code || '',
      user.created_at,
      user.last_activity || ''
    ].join(','));

    return [headers, ...rows].join('\n');
  },

  /**
   * Get help message for export command
   */
  getHelpMessage() {
    return `
📊 *Команда /exportusers - Экспорт пользователей, депозитов и выводов*

*Использование:*
\`/exportusers <тип> [параметр]\`

*📋 ЭКСПОРТ ПОЛЬЗОВАТЕЛЕЙ:*

1️⃣ \`/exportusers all\`
2️⃣ \`/exportusers refs <число>\`
3️⃣ \`/exportusers refs_deposits\`
4️⃣ \`/exportusers deposits <сумма>\`
5️⃣ \`/exportusers investors\`
6️⃣ \`/exportusers top <лимит>\`

*💰 ЭКСПОРТ ДЕПОЗИТОВ:*

7️⃣ \`/exportusers deposits_today\`
8️⃣ \`/exportusers deposits_time <часы>\`
9️⃣ \`/exportusers deposits_range <дата_от> <дата_до>\`
🔟 \`/exportusers deposits_all\`
1️⃣1️⃣ \`/exportusers deposits_pending\`

*💸 ЭКСПОРТ ВЫВОДОВ:*

1️⃣2️⃣ \`/exportusers withdrawals_today\`
   Все выводы за сегодня

1️⃣3️⃣ \`/exportusers withdrawals_time <часы>\`
   Выводы за последние X часов
   Пример: \`/exportusers withdrawals_time 24\`

1️⃣4️⃣ \`/exportusers withdrawals_range <дата_от> <дата_до>\`
   Выводы в диапазоне дат (YYYY-MM-DD)
   Пример: \`/exportusers withdrawals_range 2025-11-01 2025-11-06\`

1️⃣5️⃣ \`/exportusers withdrawals_approved\`
   Все одобренные выводы

1️⃣6️⃣ \`/exportusers withdrawals_pending\`
   Все pending выводы

*Примеры:*
• \`/exportusers deposits_today\` - депозиты за сегодня
• \`/exportusers withdrawals_today\` - выводы за сегодня
• \`/exportusers withdrawals_time 6\` - выводы за 6 часов

💡 *Все депозиты и выводы конвертируются в USD!*
📝 Результат будет отправлен в формате CSV файла.
    `.trim();
  }
};

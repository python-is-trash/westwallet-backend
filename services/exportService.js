import { supabase } from '../db/supabase.js';

export const exportService = {
  /**
   * Export all users
   */
  async exportAllUsers() {
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    return users || [];
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
        ?.filter(d => d.status === 'completed')
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
        )
      `);

    // Filter users with active investments
    const filtered = users?.filter(user =>
      user.investments?.some(inv => inv.status === 'active')
    ) || [];

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
      'Balance USDT',
      'Balance TON',
      'Balance SOL',
      'Balance STARS',
      'Referral Code',
      'Registration Date',
      'Last Activity'
    ].join(',');

    const rows = users.map(user => [
      user.id,
      user.telegram_id,
      user.username || '',
      user.first_name || '',
      user.balance_usdt || 0,
      user.balance_ton || 0,
      user.balance_sol || 0,
      user.balance_stars || 0,
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
📊 *Команда /exportusers - Экспорт пользователей*

*Использование:*
\`/exportusers <тип> [параметр]\`

*Доступные типы экспорта:*

1️⃣ \`/exportusers all\`
   Экспортировать всех пользователей

2️⃣ \`/exportusers refs <число>\`
   Пользователи с X+ рефералами
   Пример: \`/exportusers refs 10\`

3️⃣ \`/exportusers refs_deposits\`
   Пользователи, чьи рефералы сделали депозиты

4️⃣ \`/exportusers deposits <сумма>\`
   Пользователи с депозитами >= X
   Пример: \`/exportusers deposits 100\`

5️⃣ \`/exportusers investors\`
   Пользователи с активными инвестициями

6️⃣ \`/exportusers top <лимит>\`
   Топ пользователей по заработку
   Пример: \`/exportusers top 50\`

*Примеры:*
• \`/exportusers all\` - все пользователи
• \`/exportusers refs 5\` - пользователи с 5+ рефералами
• \`/exportusers deposits 50\` - пользователи с депозитом $50+
• \`/exportusers top 100\` - топ 100 по заработку

📝 Результат будет отправлен в формате CSV файла.
    `.trim();
  }
};

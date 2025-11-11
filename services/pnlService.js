import { supabase } from '../db/supabase.js';

export const pnlService = {
  async getPNL(telegramId) {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    if (!user) throw new Error('User not found');

    const now = new Date();
    const day24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const day7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const day30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const { data: earnings24h } = await supabase
      .from('operation_history')
      .select('amount')
      .eq('user_id', user.id)
      .eq('operation_type', 'claim')
      .gte('created_at', day24h.toISOString());

    const { data: earnings7d } = await supabase
      .from('operation_history')
      .select('amount')
      .eq('user_id', user.id)
      .eq('operation_type', 'claim')
      .gte('created_at', day7d.toISOString());

    const { data: earnings30d } = await supabase
      .from('operation_history')
      .select('amount')
      .eq('user_id', user.id)
      .eq('operation_type', 'claim')
      .gte('created_at', day30d.toISOString());

    const { data: investments } = await supabase
      .from('investments')
      .select('amount, status, return_amount')
      .eq('user_id', user.id);

    const totalInvested = investments?.reduce((sum, inv) => sum + parseFloat(inv.amount), 0) || 0;
    const totalClaimed = earnings30d?.reduce((sum, e) => sum + parseFloat(e.amount), 0) || 0;
    const activeCount = investments?.filter(i => i.status === 'active').length || 0;

    const earnings24hTotal = earnings24h?.reduce((sum, e) => sum + parseFloat(e.amount), 0) || 0;
    const earnings7dTotal = earnings7d?.reduce((sum, e) => sum + parseFloat(e.amount), 0) || 0;
    const earnings30dTotal = earnings30d?.reduce((sum, e) => sum + parseFloat(e.amount), 0) || 0;

    return {
      earnings_24h: earnings24hTotal,
      earnings_7d: earnings7dTotal,
      earnings_30d: earnings30dTotal,
      total_invested: totalInvested,
      total_claimed: totalClaimed,
      active_investments_count: activeCount,
      roi_percentage: totalInvested > 0 ? ((totalClaimed / totalInvested) * 100).toFixed(2) : 0,
    };
  },

  async createSnapshot(userId) {
    const { data: user } = await supabase
      .from('users')
      .select('id, telegram_id')
      .eq('id', userId)
      .single();

    if (!user) return;

    const pnl = await this.getPNL(user.telegram_id.toString());

    await supabase
      .from('pnl_snapshots')
      .insert({
        user_id: userId,
        earnings_24h: pnl.earnings_24h,
        earnings_7d: pnl.earnings_7d,
        earnings_30d: pnl.earnings_30d,
        total_invested: pnl.total_invested,
        total_claimed: pnl.total_claimed,
        active_investments_count: pnl.active_investments_count,
        snapshot_date: new Date().toISOString().split('T')[0],
      })
      .select()
      .single();
  },

  async getDailySnapshots(telegramId, days = 30) {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', parseInt(telegramId))
      .single();

    if (!user) throw new Error('User not found');

    const { data: snapshots } = await supabase
      .from('pnl_snapshots')
      .select('*')
      .eq('user_id', user.id)
      .order('snapshot_date', { ascending: false })
      .limit(days);

    return snapshots || [];
  },
};

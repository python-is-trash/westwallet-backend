import { supabase } from '../db/supabase.js';
import { nanoid } from 'nanoid';
import { userService } from './userService.js';
import dotenv from 'dotenv';

dotenv.config();

const CLAIM_DURATION_HOURS = parseInt(process.env.CLAIM_DURATION_HOURS) || 24;
const CLAIM_INTEREST_RATE = parseFloat(process.env.CLAIM_INTEREST_RATE) || 0.05;

export const claimService = {
  async start(userId, amount) {
    const user = await userService.getOrCreate(userId);

    const now = new Date();
    const endTime = new Date(now.getTime() + CLAIM_DURATION_HOURS * 60 * 60 * 1000);

    const claimId = `claim_${nanoid(10)}`;
    const interest = amount * CLAIM_INTEREST_RATE;
    const totalReturn = amount + interest;

    const { data: claim } = await supabase
      .from('claims')
      .insert({
        id: claimId,
        user_id: user.id,
        amount: totalReturn,
        status: 'active',
        end_time: endTime.toISOString(),
      })
      .select()
      .single();

    return {
      success: true,
      claim: {
        id: claim.id,
        amount: totalReturn,
        principal: amount,
        interest: interest,
        interestRate: CLAIM_INTEREST_RATE,
        durationHours: CLAIM_DURATION_HOURS,
        endTime: endTime.toISOString(),
      },
    };
  },

  async status(claimId) {
    const { data: claim } = await supabase
      .from('claims')
      .select('*, users(*)')
      .eq('id', claimId)
      .single();

    if (!claim) {
      throw new Error('Claim not found');
    }

    const now = new Date();
    const endTime = new Date(claim.end_time);
    const isComplete = now >= endTime;

    if (isComplete && claim.status === 'active') {
      const newBalance = parseFloat(claim.users.balance) + parseFloat(claim.amount);

      await supabase
        .from('claims')
        .update({ status: 'completed' })
        .eq('id', claimId);

      await userService.updateBalance(claim.users.telegram_id.toString(), newBalance);

      const txId = `tx_${nanoid(10)}`;
      await supabase.from('transactions').insert({
        id: txId,
        user_id: claim.user_id,
        type: 'claim',
        amount: claim.amount,
        status: 'completed',
        description: `Claim completed: $${claim.amount} (${CLAIM_INTEREST_RATE * 100}% interest)`,
      });

      claim.status = 'completed';
    }

    return {
      claim: {
        ...claim,
        endTime: claim.end_time,
      },
      isComplete,
    };
  },

  async getActiveClaims(userId) {
    const user = await userService.getOrCreate(userId);

    const { data: claims } = await supabase
      .from('claims')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    return claims || [];
  },
};

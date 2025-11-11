import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const COINGATE_API_KEY = process.env.COINGATE_API_KEY;
const COINGATE_ENV = process.env.COINGATE_ENV || 'sandbox';
const API_URL = COINGATE_ENV === 'sandbox'
  ? 'https://api-sandbox.coingate.com/v2'
  : 'https://api.coingate.com/v2';

export const coingateService = {
  async createPayment(userId, amount, currency = 'USD') {
    try {
      const response = await axios.post(
        `${API_URL}/orders`,
        {
          order_id: `deposit_${userId}_${Date.now()}`,
          price_amount: amount,
          price_currency: currency,
          receive_currency: 'USDT',
          title: 'Crypto Deposit',
          description: `Deposit for user ${userId}`,
          callback_url: `${process.env.WEBAPP_URL || 'http://localhost:4000'}/api/coingate/callback`,
          cancel_url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/deposit?status=cancelled`,
          success_url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/deposit?status=success`,
        },
        {
          headers: {
            'Authorization': `Bearer ${COINGATE_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        success: true,
        data: {
          paymentId: response.data.id,
          paymentUrl: response.data.payment_url,
          amount: response.data.price_amount,
          currency: response.data.price_currency,
          status: response.data.status,
        },
      };
    } catch (error) {
      console.error('CoinGate API Error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || 'Failed to create payment',
      };
    }
  },

  async getPaymentStatus(paymentId) {
    try {
      const response = await axios.get(`${API_URL}/orders/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${COINGATE_API_KEY}`,
        },
      });

      return {
        success: true,
        data: {
          id: response.data.id,
          status: response.data.status,
          amount: response.data.price_amount,
          currency: response.data.price_currency,
          receivedAmount: response.data.receive_amount,
          receivedCurrency: response.data.receive_currency,
        },
      };
    } catch (error) {
      console.error('CoinGate Status Error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Failed to get payment status',
      };
    }
  },

  async verifyCallback(payload) {
    return payload.status === 'paid';
  },
};

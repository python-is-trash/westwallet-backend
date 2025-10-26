import express from 'express';
import { userService } from '../services/userService.js';
import { withdrawalService } from '../services/withdrawalService.js';
import { adminService } from '../services/adminService.js';
import { depositWalletService } from '../services/depositWalletService.js';
import { claimService } from '../services/claimService.js';
import { investmentService } from '../services/investmentService.js';
import { pnlService } from '../services/pnlService.js';

const router = express.Router();

// Deposit endpoints
router.post('/deposit/create', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { amount, crypto_type, network } = req.body;
    if (!userId || !amount || amount <= 0) {
      throw new Error('Invalid userId or amount');
    }
    const data = await depositWalletService.createDeposit(userId, amount, crypto_type || 'USDTTRC', network);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/westwallet/callback', async (req, res) => {
  try {
    console.log('🔔 WestWallet IPN Received!');
    console.log('   Headers:', req.headers);
    console.log('   Body:', JSON.stringify(req.body, null, 2));

    // WestWallet IPN data structure
    const { id, amount, address, label, currency, status, blockchain_hash, blockchain_confirmations } = req.body;

    if (!label) {
      console.error('❌ Missing label in callback');
      return res.status(200).json({ success: false, error: 'Missing label' });
    }

    console.log(`💰 Processing payment: ${id}, label: ${label}, status: ${status}`);
    await depositWalletService.processCallback(label, status, {
      id,
      amount: parseFloat(amount),
      address,
      currency,
      blockchain_hash,
      blockchain_confirmations: parseInt(blockchain_confirmations || 0)
    });

    console.log('✅ Callback processed successfully');
    res.status(200).json({ success: true, message: 'Callback processed' });
  } catch (error) {
    console.error('❌ Callback error:', error.message);
    console.error('   Stack:', error.stack);
    res.status(200).json({ success: true, error: error.message });
  }
});

router.get('/westwallet/test', (req, res) => {
  console.log('🧪 Test endpoint hit!');
  res.json({
    success: true,
    message: 'WestWallet IPN endpoint is reachable!',
    timestamp: new Date().toISOString(),
    url: req.originalUrl
  });
});

router.get('/deposit/status/:orderId', async (req, res) => {
  try {
    const data = await depositWalletService.getDepositStatus(req.params.orderId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/deposits', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const data = await depositWalletService.getUserDeposits(userId);
    res.json({ success: true, data: { deposits: data } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/withdraw', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { amount, address } = req.body;
    if (!userId || !amount || amount <= 0) {
      throw new Error('Invalid userId or amount');
    }
    const data = await withdrawalService.request(userId, amount, address);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/admin/withdrawals', async (req, res) => {
  try {
    const data = await adminService.listWithdrawals();
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/admin/withdrawals/:id/approve', async (req, res) => {
  try {
    const data = await adminService.approve(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/admin/withdrawals/:id/reject', async (req, res) => {
  try {
    const data = await adminService.reject(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/auth', async (req, res) => {
  try {
    const { telegramId, username, firstName } = req.body;

    if (!telegramId) {
      throw new Error('Telegram ID is required');
    }

    const data = await userService.getOrCreateUser(
      telegramId.toString(),
      username || `user${telegramId}`,
      firstName || 'User'
    );

    res.json({ success: true, data: { user: data, userId: telegramId } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/user', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const data = await userService.getUser(userId);
    res.json({ success: true, data: { user: data } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/plans', async (req, res) => {
  try {
    const data = await investmentService.getPlans();
    res.json({ success: true, data: { plans: data } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/investments/create', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const { plan_id, amount, crypto_type } = req.body;
    const data = await investmentService.createInvestment(userId, plan_id, amount, crypto_type || 'USDT');
    res.json({ success: true, data: { investment: data } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/investments', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const data = await investmentService.getInvestments(userId);
    res.json({ success: true, data: { investments: data } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/investments/:id/claim', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const { claim_type } = req.body;
    const data = await investmentService.claimProfit(userId, parseInt(req.params.id), claim_type || 'profit');
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/investments/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const data = await investmentService.getInvestmentStats(userId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Auto-complete matured investments (called by cron or manually)
router.post('/investments/auto-complete', async (req, res) => {
  try {
    const result = await investmentService.autoCompleteMaturedInvestments();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/pnl', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const data = await pnlService.getPNL(userId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/pnl/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const stats = await pnlService.getPNL(userId);
    res.json({ success: true, data: { stats } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/pnl/history', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const days = parseInt(req.query.days) || 30;
    const data = await pnlService.getDailySnapshots(userId, days);
    res.json({ success: true, data: { snapshots: data } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/referrals/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const data = await userService.getReferralStats(userId);
    res.json({ success: true, data: { stats: data } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/admin/check', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const isAdmin = await adminService.isAdmin(userId);
    res.json({ success: true, data: { isAdmin } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/claims/create', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const { amount } = req.body;
    if (!amount || amount <= 0) throw new Error('Valid amount required');
    const data = await claimService.start(userId, amount);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/claims/status/:claimId', async (req, res) => {
  try {
    const data = await claimService.status(req.params.claimId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/claims', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) throw new Error('User ID required');
    const data = await claimService.getActiveClaims(userId);
    res.json({ success: true, data: { claims: data } });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/config', (req, res) => {
  res.json({
    success: true,
    data: {
      claimDurationHours: parseInt(process.env.CLAIM_DURATION_HOURS) || 24,
      claimInterestRate: parseFloat(process.env.CLAIM_INTEREST_RATE) || 0.05,
    },
  });
});

export default router;

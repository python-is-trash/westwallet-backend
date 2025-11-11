import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/api.js';
import { supabase } from './db/supabase.js';
import { initWestWallet } from './services/depositWalletService.js';
import { investmentService } from './services/investmentService.js';
import { autoDepositCrediter } from './services/autoDepositCrediter.js';
import bot, { startAdminNotifications } from './bot/bot.js';

const app = express();
const PORT = process.env.PORT || 4000;

console.log('🚀 Starting Crypto Investment Platform Backend...');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Parse form data from WestWallet

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Crypto Investment Platform API',
    version: '3.0.0',
    endpoints: {
      api: '/api',
      health: '/health'
    },
    telegram_bot: bot ? 'running' : 'not configured',
    database: 'supabase'
  });
});

app.get('/health', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);

    if (error) throw error;

    res.json({
      status: 'healthy',
      database: 'connected',
      telegram_bot: bot ? 'running' : 'not configured',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      database: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

const WESTWALLET_PUBLIC_KEY = process.env.WESTWALLET_PUBLIC_KEY;
const WESTWALLET_PRIVATE_KEY = process.env.WESTWALLET_PRIVATE_KEY;
initWestWallet(WESTWALLET_PUBLIC_KEY, WESTWALLET_PRIVATE_KEY);

app.listen(PORT, () => {
  console.log(`✅ Express API server running on port ${PORT}`);
  console.log(`📊 Supabase connected: ${process.env.SUPABASE_URL ? 'YES' : 'NO'}`);

  // Start bot only once when server starts
  if (bot) {
    bot.start().catch(err => {
      console.error('❌ Bot start error:', err.message);
    });
    console.log(`🤖 Telegram Bot: RUNNING`);

    // Start admin notification system
    startAdminNotifications();
  } else {
    console.log(`🤖 Telegram Bot: NOT CONFIGURED`);
  }

  // Auto-complete matured investments every 5 minutes
  setInterval(async () => {
    try {
      const result = await investmentService.autoCompleteMaturedInvestments();
      if (result.processed > 0) {
        console.log(`✅ Auto-completed ${result.processed} matured investments`);
      }
    } catch (error) {
      console.error('❌ Auto-complete investments error:', error.message);
    }
  }, 5 * 60 * 1000); // Run every 5 minutes

  // AUTO-CREDITER: ENABLED (runs every 5 minutes)
  // Scans WestWallet for completed transactions and credits users automatically
  setInterval(async () => {
    try {
      await autoDepositCrediter.creditCompletedDeposits();
    } catch (error) {
      console.error('❌ Auto-crediter error:', error.message);
    }
  }, 5 * 60 * 1000); // Run every 5 minutes

  console.log('✅ AUTO-CREDITER: ENABLED (scans WestWallet every 5 minutes)');

  console.log(`\n🌐 API Endpoints:`);
  console.log(`   http://localhost:${PORT}/`);
  console.log(`   http://localhost:${PORT}/api`);
  console.log(`   http://localhost:${PORT}/health`);
  console.log(`\n⏰ Auto-complete matured investments: ENABLED (every 5 minutes)`);
  console.log(`⏰ Auto-credit deposits: ENABLED (scans WestWallet every 5 minutes)`);
  console.log(`\n✨ Server ready!\n`);
});

export default app;

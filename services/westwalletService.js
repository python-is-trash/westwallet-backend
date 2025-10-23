import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const WESTWALLET_API_URL = 'https://api.westwallet.io';
const WESTWALLET_PUBLIC_KEY = process.env.WESTWALLET_PUBLIC_KEY;
const WESTWALLET_PRIVATE_KEY = process.env.WESTWALLET_PRIVATE_KEY;
const IPN_ALLOWED_IP = '5.188.51.47';

// Currency ticker mapping
const CURRENCY_TICKERS = {
  'USDT': 'USDTTRC',  // USDT TRC-20 (default)
  'USDTTRC': 'USDTTRC',  // USDT TRC-20
  'USDTERC': 'USDTERC',  // USDT ERC-20
  'USDTBEP': 'USDTBEP',  // USDT BEP-20
  'TON': 'TON',
  'SOL': 'SOL'
};

/**
 * WestWallet API Service
 */
export const westwalletService = {
  /**
   * Generate HMAC-SHA256 signature
   */
  generateSignature(timestamp, body) {
    const message = timestamp + JSON.stringify(body);
    return crypto
      .createHmac('sha256', WESTWALLET_PRIVATE_KEY)
      .update(message)
      .digest('hex');
  },

  /**
   * Get headers for API requests
   */
  getHeaders(timestamp, body) {
    return {
      'X-API-KEY': WESTWALLET_PUBLIC_KEY,
      'X-ACCESS-TIMESTAMP': timestamp.toString(),
      'X-ACCESS-SIGN': this.generateSignature(timestamp, body),
      'Content-Type': 'application/json'
    };
  },

  /**
   * Make API request to WestWallet
   */
  async makeRequest(endpoint, method = 'POST', body = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const url = `${WESTWALLET_API_URL}${endpoint}`;

    const options = {
      method,
      headers: this.getHeaders(timestamp, body)
    };

    if (method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (data.error && data.error !== 'ok') {
      throw new Error(`WestWallet API Error: ${data.error}`);
    }

    return data;
  },

  /**
   * Get currency ticker for WestWallet API
   */
  getCurrencyTicker(currency) {
    return CURRENCY_TICKERS[currency.toUpperCase()] || currency.toUpperCase();
  },

  /**
   * Generate deposit address
   */
  async generateDepositAddress(currency, label, ipnUrl) {
    const ticker = this.getCurrencyTicker(currency);

    const result = await this.makeRequest('/address/generate', 'POST', {
      currency: ticker,
      label,
      ipn_url: ipnUrl
    });

    return {
      address: result.address,
      dest_tag: result.dest_tag || '',
      currency: result.currency,
      label: result.label
    };
  },

  /**
   * Create withdrawal transaction
   */
  async createWithdrawal(currency, amount, address, description, destTag = '') {
    const ticker = this.getCurrencyTicker(currency);

    const body = {
      currency: ticker,
      amount: amount.toString(),
      address,
      description: description || '',
      priority: 'medium'
    };

    // Add dest_tag if provided (required for some currencies like XRP)
    if (destTag) {
      body.dest_tag = destTag;
    }

    const result = await this.makeRequest('/wallet/create_withdrawal', 'POST', body);

    return {
      id: result.id,
      amount: parseFloat(result.amount),
      address: result.address,
      dest_tag: result.dest_tag || '',
      currency: result.currency,
      status: result.status,
      blockchain_hash: result.blockchain_hash || '',
      fee: parseFloat(result.fee || 0)
    };
  },

  /**
   * Get transaction status
   */
  async getTransactionStatus(transactionId) {
    const result = await this.makeRequest('/wallet/transaction', 'POST', {
      id: transactionId
    });

    return {
      id: result.id,
      type: result.type,
      amount: parseFloat(result.amount),
      address: result.address,
      dest_tag: result.dest_tag || '',
      currency: result.currency,
      status: result.status,
      blockchain_confirmations: result.blockchain_confirmations || 0,
      blockchain_hash: result.blockchain_hash || '',
      fee: parseFloat(result.fee || 0)
    };
  },

  /**
   * Get wallet balance
   */
  async getBalance(currency) {
    const ticker = this.getCurrencyTicker(currency);
    const timestamp = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({ currency: ticker });

    const response = await fetch(
      `${WESTWALLET_API_URL}/wallet/balance?${params}`,
      {
        method: 'GET',
        headers: this.getHeaders(timestamp, {})
      }
    );

    const data = await response.json();

    if (data.error && data.error !== 'ok') {
      throw new Error(`WestWallet API Error: ${data.error}`);
    }

    return {
      balance: parseFloat(data.balance),
      currency: data.currency
    };
  },

  /**
   * Get all wallet balances
   */
  async getAllBalances() {
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await fetch(
      `${WESTWALLET_API_URL}/wallet/balances`,
      {
        method: 'GET',
        headers: this.getHeaders(timestamp, {})
      }
    );

    const data = await response.json();
    return data;
  },

  /**
   * Verify IPN notification
   */
  verifyIPNRequest(requestIP) {
    if (requestIP !== IPN_ALLOWED_IP) {
      throw new Error(`Invalid IPN IP: ${requestIP}. Expected: ${IPN_ALLOWED_IP}`);
    }
    return true;
  },

  /**
   * Process IPN notification for deposit (incoming transaction)
   */
  async processDepositIPN(ipnData) {
    // Verify transaction with separate API call (security measure)
    const txStatus = await this.getTransactionStatus(ipnData.id);

    return {
      id: txStatus.id,
      amount: txStatus.amount,
      address: txStatus.address,
      dest_tag: txStatus.dest_tag,
      label: ipnData.label,
      currency: this.mapTickerToCurrency(txStatus.currency),
      status: txStatus.status,
      blockchain_confirmations: txStatus.blockchain_confirmations,
      blockchain_hash: txStatus.blockchain_hash,
      fee: txStatus.fee
    };
  },

  /**
   * Process IPN notification for withdrawal (outgoing transaction)
   */
  async processWithdrawalIPN(ipnData) {
    // Verify transaction with separate API call
    const txStatus = await this.getTransactionStatus(ipnData.id);

    return {
      id: txStatus.id,
      amount: txStatus.amount,
      address: txStatus.address,
      currency: this.mapTickerToCurrency(txStatus.currency),
      status: txStatus.status,
      blockchain_hash: txStatus.blockchain_hash,
      fee: txStatus.fee,
      description: ipnData.description || ''
    };
  },

  /**
   * Map WestWallet ticker back to our currency code
   */
  mapTickerToCurrency(ticker) {
    const mapping = {
      'USDTTRC': 'USDTTRC',
      'USDTERC': 'USDTERC',
      'USDTBEP': 'USDTBEP',
      'TON': 'TON',
      'SOL': 'SOL'
    };
    return mapping[ticker] || ticker;
  },

  /**
   * Get network display name
   */
  getNetworkDisplayName(ticker) {
    const names = {
      'USDTTRC': 'USDT (TRC-20)',
      'USDTERC': 'USDT (ERC-20)',
      'USDTBEP': 'USDT (BEP-20)',
      'TON': 'TON',
      'SOL': 'SOL'
    };
    return names[ticker] || ticker;
  },

  /**
   * Get transaction history
   */
  async getTransactionHistory(currency, limit = 100, offset = 0) {
    const ticker = currency ? this.getCurrencyTicker(currency) : null;

    const body = {
      limit,
      offset,
      order: 'desc'
    };

    if (ticker) {
      body.currency = ticker;
    }

    const result = await this.makeRequest('/wallet/transactions', 'POST', body);

    return result.result || [];
  },

  /**
   * Get currency data (min/max limits, fees, etc.)
   */
  async getCurrenciesData() {
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await fetch(
      `${WESTWALLET_API_URL}/wallet/currencies_data`,
      {
        method: 'GET',
        headers: this.getHeaders(timestamp, {})
      }
    );

    const data = await response.json();
    return data;
  }
};

// For backward compatibility
export class WestWalletService {
  constructor(publicKey, privateKey) {
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  generateSignature(timestamp, body) {
    return westwalletService.generateSignature(timestamp, body);
  }

  async generateDepositAddress(currency, label, ipnUrl) {
    return westwalletService.generateDepositAddress(currency, label, ipnUrl);
  }

  async createWithdrawal(currency, amount, address, description) {
    return westwalletService.createWithdrawal(currency, amount, address, description);
  }
}

export const createWestWalletService = (publicKey, privateKey) => {
  return new WestWalletService(publicKey, privateKey);
};

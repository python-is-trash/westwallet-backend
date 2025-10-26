import dotenv from 'dotenv';

dotenv.config();

const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
const MORALIS_API_URL = 'https://deep-index.moralis.io/api/v2.2';

/**
 * Moralis chain mapping for different networks
 */
const CHAIN_MAPPING = {
  // USDT Networks
  'USDTBEP': { chain: 'bsc', contract: '0x55d398326f99059fF775485246999027B3197955' }, // BSC (BEP-20)
  'USDTERC': { chain: 'eth', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, // Ethereum (ERC-20)
  'USDTTRC': { chain: 'tron', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }, // Tron (TRC-20) - needs special handling

  // Native tokens
  'ETH': { chain: 'eth', contract: null },
  'BNB': { chain: 'bsc', contract: null },
  'MATIC': { chain: 'polygon', contract: null },
  'AVAX': { chain: 'avalanche', contract: null },
  'FTM': { chain: 'fantom', contract: null },
  'SOL': { chain: 'solana', contract: null }, // Moralis supports Solana

  // Other tokens
  'USDC': { chain: 'eth', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, // USDC ERC-20
  'DAI': { chain: 'eth', contract: '0x6B175474E89094C44Da98b954EedeAC495271d0F' } // DAI
};

/**
 * Moralis API Service for transaction verification
 */
export const moralisService = {
  /**
   * Get headers for Moralis API requests
   */
  getHeaders() {
    return {
      'X-API-Key': MORALIS_API_KEY,
      'accept': 'application/json'
    };
  },

  /**
   * Verify transaction by hash
   * @param {string} txHash - Transaction hash from WestWallet
   * @param {string} currency - Currency ticker (e.g., 'USDTBEP', 'ETH')
   * @returns {Promise<Object>} Transaction details and verification status
   */
  async verifyTransaction(txHash, currency) {
    if (!MORALIS_API_KEY) {
      console.warn('⚠️ Moralis API key not set - skipping verification');
      return { verified: false, error: 'Moralis not configured' };
    }

    const chainInfo = CHAIN_MAPPING[currency];

    if (!chainInfo) {
      console.warn(`⚠️ Chain mapping not found for ${currency}`);
      return { verified: false, error: 'Unsupported currency' };
    }

    try {
      // TRC-20 (Tron) requires different handling
      if (chainInfo.chain === 'tron') {
        return await this.verifyTronTransaction(txHash);
      }

      // For EVM chains (Ethereum, BSC, Polygon, etc.)
      const url = `${MORALIS_API_URL}/transaction/${txHash}?chain=${chainInfo.chain}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`Moralis API error for ${txHash}:`, error);
        return { verified: false, error: `API error: ${response.status}` };
      }

      const txData = await response.json();

      return {
        verified: true,
        hash: txData.hash,
        blockNumber: txData.block_number,
        blockTimestamp: txData.block_timestamp,
        confirmations: txData.confirmations || 0,
        status: this.mapTransactionStatus(txData),
        from: txData.from_address,
        to: txData.to_address,
        value: txData.value,
        gasUsed: txData.gas_used,
        gasPrice: txData.gas_price,
        nonce: txData.nonce,
        chain: chainInfo.chain
      };
    } catch (error) {
      console.error('Moralis verification error:', error);
      return { verified: false, error: error.message };
    }
  },

  /**
   * Verify Tron transaction (TRC-20)
   * Note: Moralis has limited Tron support, may need alternative
   */
  async verifyTronTransaction(txHash) {
    // For now, return unverified - can integrate TronGrid API if needed
    console.warn('⚠️ Tron transaction verification not fully implemented');
    return {
      verified: false,
      chain: 'tron',
      note: 'Tron verification requires TronGrid integration'
    };
  },

  /**
   * Map transaction status from Moralis response
   */
  mapTransactionStatus(txData) {
    // Check if transaction was successful
    if (txData.receipt_status === '1' || txData.receipt_status === 1) {
      return 'confirmed';
    } else if (txData.receipt_status === '0' || txData.receipt_status === 0) {
      return 'failed';
    }
    return 'pending';
  },

  /**
   * Get wallet transactions
   * @param {string} address - Wallet address
   * @param {string} currency - Currency ticker
   * @returns {Promise<Array>} List of transactions
   */
  async getWalletTransactions(address, currency, limit = 10) {
    if (!MORALIS_API_KEY) {
      return [];
    }

    const chainInfo = CHAIN_MAPPING[currency];
    if (!chainInfo) {
      return [];
    }

    try {
      let url = `${MORALIS_API_URL}/wallets/${address}/history?chain=${chainInfo.chain}&limit=${limit}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.result || [];
    } catch (error) {
      console.error('Error fetching wallet transactions:', error);
      return [];
    }
  },

  /**
   * Check if transaction is confirmed (minimum confirmations met)
   * @param {number} confirmations - Number of confirmations
   * @param {string} currency - Currency ticker
   * @returns {boolean} True if meets minimum confirmation threshold
   */
  isTransactionConfirmed(confirmations, currency) {
    const MIN_CONFIRMATIONS = {
      'ETH': 12,
      'BNB': 15,
      'MATIC': 128,
      'AVAX': 1,
      'FTM': 1,
      'USDC': 12,
      'DAI': 12,
      'USDTERC': 12,
      'USDTBEP': 15
    };

    const required = MIN_CONFIRMATIONS[currency] || 12;
    return confirmations >= required;
  },

  /**
   * Verify deposit with enhanced checking
   * Combines WestWallet data with Moralis verification
   */
  async verifyDeposit(blockchainHash, currency, expectedAmount, toAddress) {
    const verification = await this.verifyTransaction(blockchainHash, currency);

    if (!verification.verified) {
      return {
        success: false,
        verified: false,
        error: verification.error
      };
    }

    // Check if transaction is confirmed
    const isConfirmed = this.isTransactionConfirmed(verification.confirmations, currency);

    // Verify recipient address matches
    const addressMatch = verification.to?.toLowerCase() === toAddress?.toLowerCase();

    return {
      success: true,
      verified: true,
      confirmed: isConfirmed,
      confirmations: verification.confirmations,
      blockNumber: verification.blockNumber,
      timestamp: verification.blockTimestamp,
      status: verification.status,
      addressMatch,
      hash: verification.hash,
      from: verification.from,
      to: verification.to,
      value: verification.value
    };
  }
};

export default moralisService;

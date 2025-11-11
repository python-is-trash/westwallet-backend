import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load .env file for local development and Render deployments
dotenv.config();

// Try multiple environment variable names (MCP vs manual setup)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials!');
  console.error('SUPABASE_URL:', supabaseUrl ? 'SET' : 'MISSING');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? 'SET' : 'MISSING');
  console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('SUPABASE')));
  throw new Error('Supabase credentials not found in environment');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.log('✅ Supabase client initialized');
console.log('📊 Database:', supabaseUrl);

export default supabase;

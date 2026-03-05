import { createClient } from '@supabase/supabase-js';

// Access environment variables using import.meta.env for Vite/modern bundlers
// or process.env if using a different setup. Given the context, we handle potential missing keys safely.

const getEnv = (key: string) => {
  if (import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return '';
};

const supabaseUrl = getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL');
const supabaseKey = getEnv('VITE_SUPABASE_KEY') || getEnv('SUPABASE_KEY');

export const isSupabaseConfigured = () => {
  const configured = !!supabaseUrl && !!supabaseKey;
  if (!configured) {
    console.warn("Supabase is not configured. Missing VITE_SUPABASE_URL or VITE_SUPABASE_KEY.");
  }
  return configured;
};

// Prevent "supabaseUrl is required" error during initialization if env vars are missing.
// The app checks isSupabaseConfigured() before using this client.
// We provide a fallback valid URL to satisfy the constructor when config is missing.
export const supabase = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseKey)
  : createClient('https://placeholder.supabase.co', 'placeholder');

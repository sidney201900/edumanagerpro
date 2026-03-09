import { createClient } from '@supabase/supabase-js';

// Valores fixos inseridos diretamente para contornar a cegueira do Vite no build
const supabaseUrl = 'https://ekbuvcjsfcczviqqlfit.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrYnV2Y2pzZmNjenZpcXFsZml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTU0MzIsImV4cCI6MjA4NjU3MTQzMn0.oIzBeGF-PjaviZejYb1TeOOEzMm-Jjth1XzvJrjD6us';

export const isSupabaseConfigured = () => {
  const configured = !!supabaseUrl && !!supabaseKey;
  if (!configured) {
    console.warn("Supabase is not configured. Missing VITE_SUPABASE_URL or VITE_SUPABASE_KEY.");
  }
  return configured;
};

// Cria a ligação definitiva
export const supabase = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseKey)
  : createClient('https://placeholder.supabase.co', 'placeholder');

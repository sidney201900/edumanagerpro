import { createClient } from '@supabase/supabase-js';

// Valores fixos para garantir a conexão na Oracle Cloud (4 núcleos/24GB RAM)
const supabaseUrl = 'https://ekbuvcjsfcczviqqlfit.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrYnV2Y2pzZmNjenZpcXFsZml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTU0MzIsImV4cCI6MjA4NjU3MTQzMn0.oIzBeGF-PjaviZejYb1TeOOEzMm-Jjth1XzvJrjD6us';

// Exporta o cliente pronto para uso em todo o EduManager
export const supabase = createClient(supabaseUrl, supabaseKey);

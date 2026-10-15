import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { createSubmitHandler } from '../_shared/loader-service.mjs';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false,autoRefreshToken:false}});
const origins=(Deno.env.get('LOADER_ALLOWED_ORIGINS')||'https://tayfsound.github.io').split(',').map(s=>s.trim()).filter(Boolean);
Deno.serve(createSubmitHandler(db,origins));

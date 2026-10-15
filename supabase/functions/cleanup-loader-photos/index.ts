import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { createCleanupHandler } from '../_shared/loader-service.mjs';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createCleanupHandler(db,Deno.env.get('LOADER_CLEANUP_SECRET')));

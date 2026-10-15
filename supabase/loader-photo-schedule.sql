-- Run ONLY after deploying cleanup-loader-photos and configuring its secret.
-- Create these Vault secrets in the Dashboard first (do not commit their values):
-- loader_photo_project_url = project's https://...supabase.co URL
-- loader_photo_cleanup_secret = same random value as LOADER_CLEANUP_SECRET
-- Enable pg_cron and pg_net in the Supabase Dashboard before running this file.
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='loader_photo_project_url')
    or not exists(select 1 from vault.decrypted_secrets where name='loader_photo_cleanup_secret') then
    raise exception 'Önce gerekli Vault secret değerlerini tanımlayın.';
  end if;
end;
$$;
select cron.schedule('loader-meter-photo-retention','15 * * * *',
  $job$select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='loader_photo_project_url') || '/functions/v1/cleanup-loader-photos',
    headers := jsonb_build_object('Content-Type','application/json','x-cleanup-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='loader_photo_cleanup_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );$job$);
-- Verify: select jobname, schedule, active from cron.job where jobname='loader-meter-photo-retention';

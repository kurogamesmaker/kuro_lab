alter table public.usage_events
  drop constraint if exists usage_events_service_key_check;
alter table public.usage_events
  add constraint usage_events_service_key_check
  check (service_key is null or service_key in (
    'weather','rss','ogp','youtube','supabase_data_api','supabase_auth',
    'supabase_storage','supabase_edge','gas_proxy','other_api'
  ));
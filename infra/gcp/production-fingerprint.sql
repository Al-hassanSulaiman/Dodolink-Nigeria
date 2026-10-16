-- Read-only inventory: hashes/counts only, never customer records.
-- Refresh immediately before an export. An exporter must reject another dataset.
SELECT jsonb_object_agg(table_name, jsonb_build_object('rows', row_count, 'digest', data_digest)) AS production_fingerprint
FROM (
  SELECT 'stores' AS table_name, count(*) AS row_count, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) AS data_digest FROM public.stores t
  UNION ALL SELECT 'products', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.products t
  UNION ALL SELECT 'messages', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.messages t
  UNION ALL SELECT 'conversations', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.conversations t
  UNION ALL SELECT 'media_uploads', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.media_uploads t
  UNION ALL SELECT 'push_tokens', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.push_tokens t
  UNION ALL SELECT 'portfolio_visits', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.portfolio_visits t
  UNION ALL SELECT 'admins', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.admins t
  UNION ALL SELECT 'reviews', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.reviews t
  UNION ALL SELECT 'support_messages', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.support_messages t
  UNION ALL SELECT 'subscription_payments', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.subscription_payments t
  UNION ALL SELECT 'account_deletions', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.account_deletions t
  UNION ALL SELECT 'contact_leads', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.contact_leads t
  UNION ALL SELECT 'portfolio_client_links', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) FROM public.portfolio_client_links t
) inventory;

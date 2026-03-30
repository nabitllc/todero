-- service_limits table: per-service alert thresholds
CREATE TABLE IF NOT EXISTS service_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  metric text NOT NULL,
  warning_threshold numeric,
  critical_threshold numeric,
  unit text DEFAULT 'percent',
  alert_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(service, metric)
);

-- Default thresholds
INSERT INTO service_limits (service, metric, warning_threshold, critical_threshold, unit) VALUES
  ('supabase',    'db_bytes',       419430400,  471859200,  'bytes'),    -- 400MB warn, 450MB critical (500MB limit)
  ('supabase',    'storage_bytes',  858993459,  966367641,  'bytes'),    -- 820MB warn, 922MB critical (1GB limit)
  ('openrouter',  'balance_usd',    10.00,      5.00,       'usd'),      -- $10 warn, $5 critical
  ('n8n',         'error_rate_pct', 25,         50,         'percent'),  -- 25% warn, 50% critical
  ('cloudflare',  'tunnel_status',  null,       null,       'status')    -- just up/down
ON CONFLICT (service, metric) DO NOTHING;

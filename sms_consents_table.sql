-- SMS Marketing Consent Tracking Table
-- For TCPA compliance: Records customer opt-in to receive marketing text messages

CREATE TABLE IF NOT EXISTS sms_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Customer Information
  name TEXT,
  email TEXT NOT NULL,
  phone TEXT NOT NULL, -- Normalized (digits only)
  phone_raw TEXT, -- Original format as entered
  
  -- Consent Details
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_type TEXT NOT NULL DEFAULT 'marketing', -- 'marketing' or 'transactional'
  source TEXT NOT NULL DEFAULT 'unknown', -- 'checkout_form', 'landing_page', etc.
  is_active BOOLEAN NOT NULL DEFAULT true, -- false if customer opted out
  
  -- Opt-out tracking
  opted_out_at TIMESTAMPTZ,
  opt_out_method TEXT, -- 'STOP_SMS', 'support_request', 'admin', etc.
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Indexes for fast lookups
  CONSTRAINT unique_phone_consent_type UNIQUE (phone, consent_type)
);

-- Index for fast phone lookups
CREATE INDEX IF NOT EXISTS idx_sms_consents_phone ON sms_consents(phone);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_sms_consents_email ON sms_consents(email);

-- Index for active consents
CREATE INDEX IF NOT EXISTS idx_sms_consents_active ON sms_consents(is_active) WHERE is_active = true;

-- Comments
COMMENT ON TABLE sms_consents IS 'Tracks customer consent for SMS marketing messages (TCPA compliance)';
COMMENT ON COLUMN sms_consents.phone IS 'Normalized phone number (digits only) for uniqueness';
COMMENT ON COLUMN sms_consents.phone_raw IS 'Original phone format as entered by customer';
COMMENT ON COLUMN sms_consents.consent_type IS 'Type of SMS: marketing (promotional) or transactional (order updates)';
COMMENT ON COLUMN sms_consents.is_active IS 'False if customer opted out via STOP or other method';

-- Sample Query: Get all active marketing consents
-- SELECT * FROM sms_consents WHERE is_active = true AND consent_type = 'marketing';

-- Sample Query: Check if phone number has consented
-- SELECT * FROM sms_consents WHERE phone = '8645281475' AND consent_type = 'marketing' AND is_active = true;

-- Add subtotal column to h2s_orders to track pre-discount amount for fair payout calculation
-- Subtotal = amount before promotions/discounts
-- Total = final amount paid (after discounts)

ALTER TABLE public.h2s_orders 
ADD COLUMN IF NOT EXISTS subtotal numeric;

-- Comment for documentation
COMMENT ON COLUMN public.h2s_orders.subtotal IS 'Pre-discount amount used for calculating pro payouts (60% of subtotal, not discounted total)';

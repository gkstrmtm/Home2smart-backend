import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: true },
};

async function validateSession(token) {
  const { data, error } = await supabase
    .from('h2s_sessions')
    .select('pro_id, expires_at')
    .eq('session_id', token)
    .single();

  if (error || !data) return null;
  if (new Date() > new Date(data.expires_at)) return null;

  supabase
    .from('h2s_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', token)
    .then(() => {});

  return data.pro_id;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token;
    const amount = parseFloat(body?.amount || 0);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Missing token',
        error_code: 'missing_token'
      });
    }

    const proId = await validateSession(token);
    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid amount',
        error_code: 'invalid_amount'
      });
    }

    // Check available balance (approved payouts not yet withdrawn)
    // Fallback logic: some installations may not yet have a 'state' or 'total_amount' column.
    // We derive state from paid_at/type when 'state' is missing.
    let approvedPayouts = [];
    try {
      const { data: rawPayouts, error: rawErr } = await supabase
        .from('h2s_payouts_ledger')
        .select('payout_id, total_amount, amount, paid_at, type, created_at')
        .eq('pro_id', proId);

      if (rawErr) throw rawErr;

      approvedPayouts = (rawPayouts || []).filter(p => {
        // If explicit state column exists, rely on it
        if (typeof p.state !== 'undefined') return p.state === 'approved';
        // Derive state: paid_at => approved, else pending if type == 'pending'
        const isApproved = p.paid_at != null && p.paid_at !== '';
        return isApproved;
      }).map(p => ({
        payout_id: p.payout_id,
        total_amount: (typeof p.total_amount !== 'undefined' && p.total_amount !== null)
          ? p.total_amount
          : (p.amount || 0)
      }));
    } catch (balanceError) {
      console.error('Balance check error (fallback):', balanceError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to check balance',
        error_code: 'query_error'
      });
    }

    // Calculate available balance (exclude already withdrawn)
    const { data: withdrawals, error: withdrawError } = await supabase
      .from('h2s_instant_withdrawals')
      .select('payout_ids')
      .eq('pro_id', proId)
      .in('status', ['pending', 'processing', 'completed']);

    if (withdrawError) {
      console.error('Withdrawals check error:', withdrawError);
    }

    const withdrawnPayoutIds = new Set();
    (withdrawals || []).forEach(w => {
      (w.payout_ids || []).forEach(id => withdrawnPayoutIds.add(id));
    });

    const availablePayouts = (approvedPayouts || []).filter(
      p => !withdrawnPayoutIds.has(p.payout_id)
    );

    const availableBalance = availablePayouts.reduce((sum, p) => {
      return sum + parseFloat(p.total_amount || 0);
    }, 0);

    if (amount > availableBalance) {
      return res.status(400).json({
        ok: false,
        error: `Insufficient balance. Available: $${availableBalance.toFixed(2)}`,
        error_code: 'insufficient_balance'
      });
    }

    // Calculate fee (1.5% or $0.99 minimum)
    const fee = Math.max(0.99, amount * 0.015);
    const netAmount = amount - fee;

    // Create withdrawal record
    const { data: withdrawal, error: insertError } = await supabase
      .from('h2s_instant_withdrawals')
      .insert({
        pro_id: proId,
        amount: amount,
        fee: fee,
        net_amount: netAmount,
        status: 'pending',
        payment_method: 'stripe_instant',
        payout_ids: availablePayouts.map(p => p.payout_id),
        requested_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error('Withdrawal insert error:', insertError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create withdrawal',
        error_code: 'insert_error'
      });
    }

    // TODO: Integrate with Stripe or payment processor here
    // For now, we'll just mark it as processing
    await supabase
      .from('h2s_instant_withdrawals')
      .update({ status: 'processing' })
      .eq('withdrawal_id', withdrawal.withdrawal_id);

    console.log(`✅ Instant withdrawal created for pro ${proId}: $${netAmount.toFixed(2)}`);

    return res.json({
      ok: true,
      withdrawal_id: withdrawal.withdrawal_id,
      amount: amount,
      fee: fee,
      net_amount: netAmount,
      status: 'processing'
    });

  } catch (error) {
    console.error('Instant withdraw error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}

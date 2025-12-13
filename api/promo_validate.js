import Stripe from 'stripe';

export default async function handler(req, res){
  if(req.method !== 'GET'){
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  try{
    const key = process.env.STRIPE_SECRET_KEY;
    if(!key){
      return res.status(500).json({ ok:false, error:'Missing STRIPE_SECRET_KEY' });
    }
    const code = String(req.query.code||'').trim();
    if(!code){
      return res.status(400).json({ ok:false, error:'Missing code' });
    }
    const stripe = new Stripe(key, { apiVersion: '2023-10-16' });
    const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
    const promo = list.data?.[0];
    if(!promo){
      return res.status(200).json({ ok:true, valid:false, reason:'not_found' });
    }
    const c = promo.coupon;
    // Basic validity checks
    if(c.redeem_by && (Date.now() > (c.redeem_by*1000))){
      return res.status(200).json({ ok:true, valid:false, reason:'expired' });
    }
    if(c.valid === false){
      return res.status(200).json({ ok:true, valid:false, reason:'inactive' });
    }
    return res.status(200).json({
      ok: true,
      valid: true,
      promo: {
        id: promo.id,
        code: promo.code,
        restrictions: promo.restrictions||{},
        coupon: {
          id: c.id,
          name: c.name||'',
          percent_off: c.percent_off||null,
          amount_off: c.amount_off||null,
          currency: c.currency||'usd',
          duration: c.duration||'once',
          duration_in_months: c.duration_in_months||null
        }
      }
    });
  }catch(err){
    console.error('[promo_validate] Error:', err);
    return res.status(500).json({ ok:false, error: err.message||'Error' });
  }
}

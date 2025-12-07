// Payout Policy Configuration
const PAYOUT_POLICY = {
  materials_pct_estimate: {
    BYO: 0.00,
    BASE: 0.28,
    H2S: 0.38
  },
  pro_pct_on_labor: {
    BYO: 0.65,
    BASE: 0.55,
    H2S: 0.50
  },
  min_payout_floor: 35,
  max_payout_cap_pct: 0.80
};

function _tierFromVariant(variantCode) {
  const v = String(variantCode || '').trim().toUpperCase();
  if (v === 'BYO') return 'BYO';
  if (v === 'BASE') return 'BASE';
  if (v === 'H2S') return 'H2S';
  return 'BASE';
}

function _computeProPayoutForLine(lineCustomerTotal, variantCode) {
  const price = Number(lineCustomerTotal || 0) || 0;
  const tier = _tierFromVariant(variantCode);
  
  const matPct = PAYOUT_POLICY.materials_pct_estimate[tier] || 0;
  const laborBase = Math.max(0, price - (price * matPct));
  
  const pct = PAYOUT_POLICY.pro_pct_on_labor[tier] || 0.55;
  const raw = laborBase * pct;
  
  // Guardrails
  const capped = Math.min(raw, price * PAYOUT_POLICY.max_payout_cap_pct);
  const finalAmt = Math.max(PAYOUT_POLICY.min_payout_floor, capped);
  
  return Math.round(finalAmt * 100) / 100;
}

export function calculatePayout(job, lines, teamSplit) {
  let totalJobPayout = 0;
  
  // Calculate from lines
  if (lines && lines.length > 0) {
    lines.forEach(line => {
      // Use pre-calculated if available, otherwise compute
      let linePayout = Number(line.calc_pro_payout_total || 0);
      if (linePayout === 0) {
        linePayout = _computeProPayoutForLine(line.customer_total, line.variant_code);
      }
      totalJobPayout += linePayout;
    });
  } else {
    // Fallback to job-level metadata if no lines
    if (job.metadata && job.metadata.estimated_payout) {
      totalJobPayout = parseFloat(job.metadata.estimated_payout);
    }
  }

  // Handle Team Split
  let primaryAmount = totalJobPayout;
  let secondaryAmount = 0;
  let splitDetails = null;

  if (teamSplit && teamSplit.secondary_pro_id) {
    const splitMode = (teamSplit.split_mode || 'percent').toLowerCase();
    
    if (splitMode === 'percent') {
      const primaryPercent = Number(teamSplit.primary_percent || 50);
      const secondaryPercent = 100 - primaryPercent;
      
      primaryAmount = Math.round(totalJobPayout * (primaryPercent / 100) * 100) / 100;
      secondaryAmount = Math.round(totalJobPayout * (secondaryPercent / 100) * 100) / 100;
      
      splitDetails = {
        mode: 'percent',
        primary_percent: primaryPercent,
        secondary_percent: secondaryPercent
      };
    } else {
      // Flat split
      primaryAmount = Number(teamSplit.primary_flat || 0);
      secondaryAmount = Number(teamSplit.secondary_flat || 0);
      
      splitDetails = {
        mode: 'flat',
        primary_flat: primaryAmount,
        secondary_flat: secondaryAmount
      };
    }
  }

  return {
    total: totalJobPayout,
    primary_amount: primaryAmount,
    secondary_amount: secondaryAmount,
    split_details: splitDetails
  };
}

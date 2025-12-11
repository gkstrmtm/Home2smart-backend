/**
 * Bundle Definitions - What each package includes
 * This is the source of truth for what technicians need to know about each service
 */

const BUNDLE_DEFINITIONS = {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SECURITY CAMERA PACKAGES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  cam_basic: {
    name: 'Basic Coverage',
    price: 599, // This is in DOLLARS (not cents)
    category: 'security',
    summary: '2 cameras + doorbell',
    description: 'Front door secure. See who\'s there, every time.',
    techDetails: [
      '2 cameras + 1 doorbell camera',
      'Mobile alerts',
      '7-day cloud storage',
      'App setup and training'
    ],
    installNotes: 'Basic installation - front door coverage'
  },
  
  cam_standard: {
    name: 'Standard Coverage',
    price: 1199,
    category: 'security',
    summary: '4 cameras + doorbell',
    description: 'Front, driveway, and backyard—full visibility where it matters.',
    techDetails: [
      '4 cameras + 1 doorbell camera',
      'Mobile alerts',
      '30-day cloud storage',
      'App + professional setup'
    ],
    installNotes: 'Standard installation - front, sides, and back coverage'
  },
  
  cam_premium: {
    name: 'Premium Coverage',
    price: 2199,
    category: 'security',
    summary: '8 cameras + doorbell',
    description: 'Full perimeter + NVR recording. Total property protection.',
    techDetails: [
      '8 cameras + 1 doorbell camera',
      'Local NVR recording system',
      '60-day cloud storage',
      'Dedicated support'
    ],
    installNotes: 'Premium installation - full perimeter coverage with local recording'
  },
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TV MOUNTING PACKAGES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  tv_single: {
    name: 'Single TV Mount',
    category: 'tv',
    summary: '1 TV mounted',
    description: 'Professional TV mounting with wire concealment',
    techDetails: [
      '1 TV mounted (up to 85")',
      'Wire concealment',
      'Level and secure mounting',
      'All hardware included'
    ],
    installNotes: 'Standard single TV mount'
  },
  
  tv_multi: {
    name: 'Multi-TV Package',
    category: 'tv',
    summary: 'Multiple TVs mounted',
    description: 'Mount multiple TVs throughout your home',
    techDetails: [
      'Multiple TV mounts',
      'Wire concealment per TV',
      'Professional installation',
      'All hardware included'
    ],
    installNotes: 'Multi-room TV installation'
  }
};

/**
 * Get bundle definition by ID
 */
function getBundleDefinition(bundleId) {
  return BUNDLE_DEFINITIONS[bundleId] || null;
}

/**
 * Enrich a line item with bundle details for technician display
 */
function enrichLineItemWithBundleDetails(item) {
  const bundle = getBundleDefinition(item.bundle_id || item.service_id);
  
  if (!bundle) {
    return item; // Return as-is if no bundle definition
  }
  
  return {
    ...item,
    // Keep original data
    title: item.service_name || item.title || bundle.name,
    name: item.service_name || item.name || bundle.name,
    
    // Add enriched bundle data
    bundle_name: bundle.name,
    bundle_summary: bundle.summary,
    bundle_description: bundle.description,
    tech_details: bundle.techDetails,
    install_notes: bundle.installNotes,
    category: bundle.category
  };
}

/**
 * Format bundle details for display in portal/mobile
 */
function formatBundleForDisplay(bundleId, qty = 1) {
  const bundle = getBundleDefinition(bundleId);
  if (!bundle) return null;
  
  const qtyPrefix = qty > 1 ? `${qty}x ` : '';
  
  return {
    summary: `${qtyPrefix}${bundle.summary}`,
    bullets: bundle.techDetails.map(detail => `• ${detail}`),
    description: bundle.description,
    installNotes: bundle.installNotes
  };
}

export {
  BUNDLE_DEFINITIONS,
  getBundleDefinition,
  enrichLineItemWithBundleDetails,
  formatBundleForDisplay
};

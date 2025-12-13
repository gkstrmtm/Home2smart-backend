/**
 * Purchasing Logic Utility
 * Analyzes job details to suggest required inventory/purchases.
 */

function getRecommendedItems(serviceName, notes, variantCode, units = 1, tvSize = 0, lineItems = null) {
  const serviceLC = String(serviceName || '').toLowerCase();
  const notesLC = String(notes || '').toLowerCase();
  const variantLC = String(variantCode || '').toLowerCase();
  
  const expected = [];

  // 1. Analyze Line Items from metadata.items_json (MOST ACCURATE)
  if (lineItems && Array.isArray(lineItems)) {
    lineItems.forEach(item => {
      const bundleId = (item.bundle_id || item.service_name || '').toLowerCase();
      const itemMeta = item.metadata || {};
      const qty = item.qty || 1;
      
      // TV MOUNT PACKAGES
      if (bundleId.includes('tv')) {
        const mountsNeeded = itemMeta.mounts_needed || qty;
        const tvSize = itemMeta.tv_size || 'unknown';
        const mountProvider = itemMeta.mount_provider;
        const mountType = itemMeta.mount_type || 'tilt'; // full_motion, tilt, fixed
        
        // Mount type display names
        const mountTypeLabels = {
          full_motion: 'Full Motion',
          tilt: 'Tilt',
          fixed: 'Fixed/Flat'
        };
        const mountTypeLabel = mountTypeLabels[mountType] || 'Tilt';
        
        // Only suggest if H2S is providing the mount
        if (mountProvider === 'h2s') {
          expected.push({
            category: 'PRIMARY',
            item_name: `TV Wall Mount - ${mountTypeLabel} (${tvSize}" compatible)`,
            suggested_id: `TV_MOUNT_${tvSize}_${mountType}`,
            why_needed: `${mountsNeeded}x ${mountTypeLabel.toLowerCase()} mounts needed for TV installation (H2S provided)`,
            typical_brands: ['Sanus', 'Mounting Dream', 'ECHOGEAR'],
            search_terms: `tv wall mount ${tvSize} inch ${mountType.replace('_', ' ')}`,
            priority: 1,
            quantity: mountsNeeded,
            mount_type: mountType,
            tv_size: tvSize
          });
          
          // Wall anchors/hardware - REMOVED: Tech carries these in vehicle (varies by wall type)
        }
        
        // HDMI cables - REMOVED: Customer typically provides these
      }
      
      // CAMERA PACKAGES
      if (bundleId.includes('cam')) {
        let cameraCount = 0;
        let packageType = '';
        
        if (bundleId === 'cam_basic') {
          cameraCount = 2 * qty;
          packageType = 'Basic';
        } else if (bundleId === 'cam_standard') {
          cameraCount = 4 * qty;
          packageType = 'Standard';
        } else if (bundleId === 'cam_premium') {
          cameraCount = 8 * qty;
          packageType = 'Premium';
        }
        
        if (cameraCount > 0) {
          expected.push({
            category: 'PRIMARY',
            item_name: `Security Camera System (${cameraCount}-camera ${packageType})`,
            suggested_id: `CAM_SYSTEM_${cameraCount}`,
            why_needed: `${packageType} security package requires ${cameraCount} cameras with NVR/DVR`,
            typical_brands: ['Reolink', 'Lorex', 'Swann', 'Amcrest'],
            search_terms: `${cameraCount} camera security system nvr`,
            priority: 1,
            quantity: 1
          });
          
          // Ethernet cables for PoE cameras
          expected.push({
            category: 'SUPPLIES',
            item_name: `Cat6 Ethernet Cables (${cameraCount}x 100ft)`,
            suggested_id: 'CAT6_CABLE',
            why_needed: 'PoE ethernet cables to power and connect cameras',
            typical_brands: ['Mediabridge', 'Cable Matters', 'Monoprice'],
            search_terms: 'cat6 ethernet cable 100ft outdoor',
            priority: 2,
            quantity: cameraCount
          });
          
          // Camera mounting brackets - REMOVED: Usually included with camera systems
        }
      }
    });
  }

  // Mesh WiFi
  if (serviceLC.includes('mesh') || serviceLC.includes('wifi')) {
    // Smart quantity: 3-pack for units=1, scale up for multiple units
    const packSize = units > 1 ? (units * 3) : 3;
    const packLabel = packSize > 3 ? `${packSize}-node system` : '3-pack';
    
    expected.push({
      category: 'PRIMARY',
      item_name: `Mesh WiFi Router System (${packLabel})`,
      suggested_id: packSize > 3 ? `MESH_ROUTER_${packSize}NODE` : 'MESH_ROUTER_3PACK',
      why_needed: `Main equipment for whole-home mesh network (${units} unit${units > 1 ? 's' : ''})`,
      typical_brands: ['TP-Link Deco X20', 'Google Nest WiFi', 'Eero Pro 6'],
      search_terms: `mesh wifi system ${packLabel}`,
      priority: 1,
      quantity_logic: `${packSize} nodes needed for ${units} installation unit(s)`
    });
    
    // Scale Ethernet cables based on units
    expected.push({
      category: 'INSTALLATION',
      item_name: `Ethernet Cable 25ft (Cat6) ${units > 1 ? 'x' + units : ''}`,
      suggested_id: 'ETH_CABLE_25FT',
      why_needed: 'Connect main node to modem/router',
      typical_brands: ['Amazon Basics', 'Cable Matters'],
      search_terms: 'cat6 ethernet cable 25ft',
      priority: 2,
      quantity_logic: `${units} cable(s) for ${units} unit(s)`
    });
    
    // Cable clips - REMOVED: Optional accessory, not core to service delivery
  }
  
  // TV Mounting
  if (serviceLC.includes('tv') || serviceLC.includes('mount')) {
    // Use actual TV size from job data, fallback to variant parsing
    let size = '32-55"';
    if (tvSize > 0) {
      size = tvSize + '"';
    } else if (variantLC.includes('75')) {
      size = '75"';
    } else if (variantLC.includes('65')) {
      size = '65"';
    } else if (variantLC.includes('55')) {
      size = '55"';
    }
    
    // Scale hardware for multiple units
    expected.push({
      category: 'PRIMARY',
      item_name: `TV Wall Mount Bracket (${size})${units > 1 ? ' x' + units : ''}`,
      suggested_id: `TV_MOUNT_${size.replace(/"/g, '').replace('-', '_')}`,
      why_needed: `Main mounting hardware for ${size} TV${units > 1 ? ' (' + units + ' units)' : ''}`,
      typical_brands: ['Mounting Dream', 'ECHOGEAR', 'Sanus'],
      search_terms: `tv wall mount ${size}`,
      priority: 1,
      quantity_logic: `${units} mount(s) for ${units} TV(s) at ${size}`
    });
    // Lag bolts/anchors - REMOVED: Tech carries various hardware for different wall types
    
    // Cable management kit - REMOVED: Optional, not core equipment
    /*
    expected.push({
      category: 'OPTIONAL',
      item_name: 'Cable Management Kit',
      suggested_id: 'CABLE_MGMT_KIT',
      why_needed: 'Hide cables for clean look',
      typical_brands: ['Legrand', 'Cable Concealer'],
      search_terms: 'cable management kit tv',
      priority: 3
    });
  }
  
  // Camera Installation
  if (serviceLC.includes('cam') || serviceLC.includes('camera')) {
    const isExterior = serviceLC.includes('outdoor') || serviceLC.includes('exterior') || notesLC.includes('outside');
    expected.push({
      category: 'PRIMARY',
      item_name: isExterior ? 'Outdoor Security Camera' : 'Indoor Security Camera',
      suggested_id: isExterior ? 'CAM_OUTDOOR_1080P' : 'CAM_INDOOR_1080P',
      why_needed: 'Main camera unit',
      typical_brands: ['Wyze Cam', 'Ring', 'Arlo'],
      search_terms: isExterior ? 'outdoor security camera 1080p' : 'indoor security camera 1080p',
      priority: 1
    });
    if (isExterior) {
      expected.push({
        category: 'INSTALLATION',
        item_name: 'Weatherproof Silicone Sealant',
        suggested_id: 'OUTDOOR_SEALANT',
        why_needed: 'Seal cable entry points from weather',
        typical_brands: ['DAP', 'GE Silicone II'],
        search_terms: 'outdoor silicone sealant weatherproof',
        priority: 1
      });
      expected.push({
        category: 'INSTALLATION',
        item_name: 'Masonry Drill Bit Set',
        suggested_id: 'MASONRY_BIT_SET',
        why_needed: 'Drill into brick/concrete if needed',
        typical_brands: ['DeWalt', 'Bosch'],
        search_terms: 'masonry drill bit set',
        priority: 2
      });
    }
    expected.push({
      category: 'INSTALLATION',
      item_name: 'Ethernet Cable 50ft (if wired)',
      suggested_id: 'ETH_CABLE_50FT',
      why_needed: 'Connect wired cameras to network',
      typical_brands: ['Amazon Basics', 'Cable Matters'],
      search_terms: 'cat6 ethernet cable 50ft outdoor',
      priority: 2
    });
  }
  
  // Smart Lock Installation
  if (serviceLC.includes('lock') || serviceLC.includes('smart_lock')) {
    expected.push({
      category: 'PRIMARY',
      item_name: 'Smart Lock',
      suggested_id: 'SMART_LOCK_DEADBOLT',
      why_needed: 'Main smart lock unit',
      typical_brands: ['Yale Assure Lock 2', 'August Smart Lock', 'Schlage Encode'],
      search_terms: 'smart lock deadbolt wifi',
      priority: 1
    });
    expected.push({
      category: 'INSTALLATION',
      item_name: 'Wood Screw Assortment Kit',
      suggested_id: 'WOOD_SCREW_KIT',
      why_needed: 'Various sizes for door hardware',
      typical_brands: ['Hillman', 'Grip-Rite'],
      search_terms: 'wood screw assortment kit',
      priority: 2
    });
  }
  
  // Doorbell Installation
  if (serviceLC.includes('doorbell')) {
    expected.push({
      category: 'PRIMARY',
      item_name: 'Video Doorbell',
      suggested_id: 'VIDEO_DOORBELL',
      why_needed: 'Main doorbell unit',
      typical_brands: ['Ring Video Doorbell Pro 2', 'Nest Doorbell', 'Arlo Video Doorbell'],
      search_terms: 'video doorbell wifi',
      priority: 1
    });
    if (notesLC.includes('transformer') || notesLC.includes('low voltage')) {
      expected.push({
        category: 'INSTALLATION',
        item_name: 'Doorbell Transformer 16V-30VA',
        suggested_id: 'DOORBELL_XFORMER_16V',
        why_needed: 'Power supply for video doorbell',
        typical_brands: ['Newhouse Hardware', 'Broan-NuTone'],
        search_terms: 'doorbell transformer 16v 30va',
        priority: 1
      });
    }
  }
  
  // Lighting Installation
  if (serviceLC.includes('light') || serviceLC.includes('lighting')) {
    if (serviceLC.includes('smart') || notesLC.includes('smart bulb')) {
      expected.push({
        category: 'PRIMARY',
        item_name: 'Smart Light Bulbs (4-pack)',
        suggested_id: 'SMART_BULB_4PACK',
        why_needed: 'Smart bulbs for fixtures',
        typical_brands: ['Philips Hue', 'LIFX', 'Kasa Smart'],
        search_terms: 'smart light bulbs color',
        priority: 1
      });
    }
  }

  return expected;
}

export { getRecommendedItems };

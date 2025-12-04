/**
 * Address Autocomplete Proxy
 * Uses Google Places Autocomplete API
 * 
 * GET /api/address_autocomplete?input=123+Main+St
 */

module.exports = async (req, res) => {
  try {
    const { input } = req.query;
    
    if (!input || typeof input !== 'string' || input.trim().length < 3) {
      return res.status(200).json({
        ok: true,
        predictions: []
      });
    }
    
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!apiKey) {
      console.error('[Address Autocomplete] Missing GOOGLE_MAPS_API_KEY');
      return res.status(200).json({
        ok: false,
        predictions: [],
        error: 'API key not configured'
      });
    }
    
    // Use Google Places Autocomplete API
    const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    url.searchParams.set('input', input.trim());
    url.searchParams.set('key', apiKey);
    url.searchParams.set('types', 'address');
    url.searchParams.set('components', 'country:us');
    
    console.log('[Address Autocomplete] Calling Google Places API for:', input);
    
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`Google Places API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log('[Address Autocomplete] Google Places status:', data.status);
    console.log('[Address Autocomplete] Returned', data.predictions?.length || 0, 'results');
    
    if (data.status === 'OK' && data.predictions && data.predictions.length > 0) {
      // Convert Google format to our format
      const predictions = data.predictions.map(prediction => {
        return {
          description: prediction.description,
          place_id: prediction.place_id,
          // Parse address components from description
          components: parseAddressComponents(prediction.description)
        };
      });
      
      return res.status(200).json({
        ok: true,
        predictions
      });
    } else if (data.status === 'ZERO_RESULTS') {
      return res.status(200).json({
        ok: true,
        predictions: []
      });
    } else {
      // Log any API errors for debugging
      console.error('[Address Autocomplete] API Error:', data.status, data.error_message);
      return res.status(200).json({
        ok: false,
        predictions: [],
        error: data.error_message || data.status
      });
    }
    
  } catch (error) {
    console.error('[Address Autocomplete] Error:', error);
    return res.status(200).json({
      ok: false,
      predictions: [],
      error: error.message
    });
  }
};

// Parse address components from Google's description string
function parseAddressComponents(description) {
  const components = {
    street_number: '',
    street: '',
    city: '',
    state: '',
    zip: ''
  };
  
  try {
    // Example: "123 Main Street, Springfield, IL 62701, USA"
    const parts = description.split(',').map(p => p.trim());
    
    if (parts.length >= 3) {
      // First part usually contains street number + street
      const streetPart = parts[0];
      const streetMatch = streetPart.match(/^(\d+)\s+(.+)$/);
      if (streetMatch) {
        components.street_number = streetMatch[1];
        components.street = streetMatch[2];
      }
      
      // Second part is usually city
      components.city = parts[1];
      
      // Third part usually contains state and zip
      const stateZipPart = parts[2];
      const stateZipMatch = stateZipPart.match(/^([A-Z]{2})\s+(\d{5})$/);
      if (stateZipMatch) {
        components.state = stateZipMatch[1];
        components.zip = stateZipMatch[2];
      } else {
        // Just state abbreviation
        components.state = stateZipPart;
      }
    }
  } catch (e) {
    console.error('[Address Autocomplete] Error parsing components:', e);
  }
  
  return components;
}

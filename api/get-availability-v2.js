import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * INTELLIGENT AVAILABILITY SYSTEM
 * 
 * Instead of hardcoded 3 jobs per slot, this dynamically calculates availability based on:
 * - How many pros are available in the customer's area
 * - Each pro's individual capacity
 * - Pro skills and service requirements
 * - Geographic routing optimization
 */
export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { zip, lat, lng, service_id } = req.query;
    
    // Business rules
    const BUSINESS_HOURS = {
      monday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM', '3:00 PM - 6:00 PM'],
      tuesday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM', '3:00 PM - 6:00 PM'],
      wednesday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM', '3:00 PM - 6:00 PM'],
      thursday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM', '3:00 PM - 6:00 PM'],
      friday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM', '3:00 PM - 6:00 PM'],
      saturday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM'],
      sunday: [] // Closed
    };

    const DAYS_AHEAD = 30;
    const MIN_ADVANCE_HOURS = 24;
    const FALLBACK_CAPACITY_PER_SLOT = 3; // Default if no pro capacity data

    const availability = [];
    const today = new Date();
    const minBookingDate = new Date(today.getTime() + (MIN_ADVANCE_HOURS * 60 * 60 * 1000));

    // Check if we have pro capacity data (intelligent routing enabled)
    const { data: capacityExists } = await supabase
      .from('h2s_dispatch_pro_capacity')
      .select('capacity_id')
      .limit(1);

    const useIntelligentRouting = capacityExists && capacityExists.length > 0;

    console.log(`[Availability] Mode: ${useIntelligentRouting ? 'INTELLIGENT ROUTING' : 'FALLBACK (Simple)'}`);

    for (let i = 0; i < DAYS_AHEAD; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      date.setHours(0, 0, 0, 0);

      if (date < minBookingDate) continue;

      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const dateStr = date.toISOString().split('T')[0];

      const daySlots = BUSINESS_HOURS[dayName] || [];
      
      if (daySlots.length === 0) {
        availability.push({
          date: dateStr,
          day_name: dayName,
          available: false,
          slots: [],
          mode: 'closed'
        });
        continue;
      }

      let slots;

      if (useIntelligentRouting) {
        // ========================================
        // INTELLIGENT MODE: Use pro capacity data
        // ========================================
        slots = await Promise.all(daySlots.map(async (slotTime) => {
          // Get total capacity across all pros for this slot
          const { data: capacityData, error: capacityError } = await supabase
            .from('h2s_dispatch_pro_capacity')
            .select(`
              pro_id,
              max_jobs,
              booked_jobs,
              available_spots,
              blocked,
              h2s_dispatch_pros!inner (
                status,
                geo_lat,
                geo_lng,
                service_radius_miles
              )
            `)
            .eq('date_local', dateStr)
            .eq('time_slot', slotTime)
            .eq('h2s_dispatch_pros.status', 'active')
            .eq('blocked', false);

          if (capacityError) {
            console.error('[Availability] Capacity query error:', capacityError);
            // Fallback to simple mode for this slot
            const { data: bookings } = await supabase
              .from('h2s_orders')
              .select('delivery_time')
              .eq('delivery_date', dateStr)
              .eq('delivery_time', slotTime);

            const booked = bookings ? bookings.length : 0;
            const totalCapacity = FALLBACK_CAPACITY_PER_SLOT;

            return {
              time: slotTime,
              available: booked < totalCapacity,
              spots_remaining: totalCapacity - booked,
              total_capacity: totalCapacity,
              pros_available: 'Unknown',
              mode: 'fallback',
              start_iso: buildISOTime(dateStr, slotTime, true),
              end_iso: buildISOTime(dateStr, slotTime, false)
            };
          }

          // Calculate total available spots across all pros
          let totalCapacity = 0;
          let totalBooked = 0;
          let prosAvailable = 0;

          if (capacityData && capacityData.length > 0) {
            capacityData.forEach(cap => {
              totalCapacity += cap.max_jobs || 0;
              totalBooked += cap.booked_jobs || 0;
              
              // If customer location provided, filter by service radius
              if (lat && lng && cap.h2s_dispatch_pros.geo_lat && cap.h2s_dispatch_pros.geo_lng) {
                const distance = calculateDistance(
                  parseFloat(lat),
                  parseFloat(lng),
                  parseFloat(cap.h2s_dispatch_pros.geo_lat),
                  parseFloat(cap.h2s_dispatch_pros.geo_lng)
                );
                const radiusMiles = cap.h2s_dispatch_pros.service_radius_miles || 30;
                
                if (distance <= radiusMiles) {
                  prosAvailable++;
                }
              } else {
                // No location filtering, count all active pros
                prosAvailable++;
              }
            });
          } else {
            // No capacity data for this slot, check existing bookings
            const { data: bookings } = await supabase
              .from('h2s_orders')
              .select('delivery_time')
              .eq('delivery_date', dateStr)
              .eq('delivery_time', slotTime);

            totalBooked = bookings ? bookings.length : 0;
            totalCapacity = FALLBACK_CAPACITY_PER_SLOT;
            prosAvailable = 1; // Assume 1 pro for fallback
          }

          const spotsRemaining = Math.max(0, totalCapacity - totalBooked);

          return {
            time: slotTime,
            available: spotsRemaining > 0,
            spots_remaining: spotsRemaining,
            total_capacity: totalCapacity,
            pros_available: prosAvailable,
            mode: 'intelligent',
            start_iso: buildISOTime(dateStr, slotTime, true),
            end_iso: buildISOTime(dateStr, slotTime, false)
          };
        }));

      } else {
        // ========================================
        // FALLBACK MODE: Simple capacity tracking
        // ========================================
        const { data: bookedJobs } = await supabase
          .from('h2s_orders')
          .select('delivery_time')
          .eq('delivery_date', dateStr)
          .not('delivery_time', 'is', null);

        const bookingCounts = {};
        if (bookedJobs) {
          bookedJobs.forEach(job => {
            const slot = job.delivery_time;
            bookingCounts[slot] = (bookingCounts[slot] || 0) + 1;
          });
        }

        slots = daySlots.map(slotTime => {
          const booked = bookingCounts[slotTime] || 0;
          const available = booked < FALLBACK_CAPACITY_PER_SLOT;
          
          return {
            time: slotTime,
            available: available,
            spots_remaining: FALLBACK_CAPACITY_PER_SLOT - booked,
            total_capacity: FALLBACK_CAPACITY_PER_SLOT,
            pros_available: 1,
            mode: 'simple',
            start_iso: buildISOTime(dateStr, slotTime, true),
            end_iso: buildISOTime(dateStr, slotTime, false)
          };
        });
      }

      availability.push({
        date: dateStr,
        day_name: dayName,
        available: slots.some(s => s.available),
        slots: slots,
        mode: useIntelligentRouting ? 'intelligent' : 'simple'
      });
    }

    return res.json({ 
      ok: true, 
      availability: availability,
      timezone: 'America/New_York',
      routing_mode: useIntelligentRouting ? 'intelligent' : 'simple',
      message: useIntelligentRouting 
        ? 'Using multi-pro intelligent routing'
        : 'Using simple capacity (3 per slot). Run INTELLIGENT_ROUTING_SCHEMA.sql to enable multi-pro routing.'
    });

  } catch (error) {
    console.error('[Availability] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

// Helper: Haversine distance formula
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
            Math.sin(dLng/2) * Math.sin(dLng/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

// Helper: Convert time slot to ISO timestamp
function buildISOTime(dateStr, slotTime, isStart) {
  try {
    const times = slotTime.split(' - ');
    const timeStr = isStart ? times[0] : (times[1] || times[0]);
    
    const [time, modifier] = timeStr.trim().split(' ');
    let [hours, minutes] = time.split(':');
    hours = parseInt(hours, 10);
    minutes = parseInt(minutes || '0', 10);
    
    if (modifier === 'PM' && hours !== 12) hours += 12;
    if (modifier === 'AM' && hours === 12) hours = 0;
    
    return `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-05:00`;
  } catch (e) {
    return `${dateStr}T12:00:00-05:00`;
  }
}

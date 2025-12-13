import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Get available appointment slots for booking calendar
 * Returns next 30 days with available time slots
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
    // Business rules (hardcoded for now - can move to database later)
    const BUSINESS_HOURS = {
      monday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM', '3:00 PM - 6:00 PM'],
      tuesday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM', '3:00 PM - 6:00 PM'],
      wednesday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM', '3:00 PM - 6:00 PM'],
      thursday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM', '3:00 PM - 6:00 PM'],
      friday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM', '3:00 PM - 6:00 PM'],
      saturday: ['9:00 AM - 12:00 PM', '12:00 PM - 3:00 PM'],
      sunday: [] // Closed on Sundays
    };

    const MAX_JOBS_PER_SLOT = 3; // Capacity limit per time slot
    const DAYS_AHEAD = 30;
    const MIN_ADVANCE_HOURS = 24; // Must book at least 24 hours in advance

    const availability = [];
    const today = new Date();
    const minBookingDate = new Date(today.getTime() + (MIN_ADVANCE_HOURS * 60 * 60 * 1000));

    // Generate next 30 days
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      date.setHours(0, 0, 0, 0);

      // Skip if before minimum advance booking time
      if (date < minBookingDate) continue;

      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

      // Get slots for this day of week
      const daySlots = BUSINESS_HOURS[dayName] || [];
      
      if (daySlots.length === 0) {
        // Day is closed
        availability.push({
          date: dateStr,
          day_name: dayName,
          available: false,
          slots: []
        });
        continue;
      }

      // Check how many jobs already booked for each slot
      const { data: bookedJobs, error } = await supabase
        .from('h2s_orders')
        .select('delivery_time')
        .eq('delivery_date', dateStr)
        .not('delivery_time', 'is', null);

      if (error) {
        console.error('[Availability] Query error:', error);
      }

      // Count bookings per time slot
      const bookingCounts = {};
      if (bookedJobs) {
        bookedJobs.forEach(job => {
          const slot = job.delivery_time;
          bookingCounts[slot] = (bookingCounts[slot] || 0) + 1;
        });
      }

      // Build slot availability
      const slots = daySlots.map(slotTime => {
        const booked = bookingCounts[slotTime] || 0;
        const available = booked < MAX_JOBS_PER_SLOT;
        
        return {
          time: slotTime,
          available: available,
          spots_remaining: MAX_JOBS_PER_SLOT - booked,
          start_iso: buildISOTime(dateStr, slotTime, true),
          end_iso: buildISOTime(dateStr, slotTime, false)
        };
      });

      availability.push({
        date: dateStr,
        day_name: dayName,
        available: slots.some(s => s.available),
        slots: slots
      });
    }

    return res.json({ 
      ok: true, 
      availability: availability,
      timezone: 'America/New_York'
    });

  } catch (error) {
    console.error('[Availability] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

// Helper: Convert "9:00 AM - 12:00 PM" to ISO timestamp
function buildISOTime(dateStr, slotTime, isStart) {
  try {
    const times = slotTime.split(' - ');
    const timeStr = isStart ? times[0] : (times[1] || times[0]);
    
    // Convert to 24-hour format
    const [time, modifier] = timeStr.trim().split(' ');
    let [hours, minutes] = time.split(':');
    hours = parseInt(hours, 10);
    minutes = parseInt(minutes || '0', 10);
    
    if (modifier === 'PM' && hours !== 12) hours += 12;
    if (modifier === 'AM' && hours === 12) hours = 0;
    
    // Build ISO string (assumes EST timezone)
    return `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-05:00`;
  } catch (e) {
    return `${dateStr}T12:00:00-05:00`;
  }
}

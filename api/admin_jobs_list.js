import { createClient } from '@supabase/supabase-js';
// import { getRecommendedItems } from './utils/purchasing_logic.js'; // Disabled - causing crashes

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * Validate admin session with fallback token field
 */
async function validateAdminSession(token) {
  if (!token) return false;
  
  // Try session_id first (primary)
  let { data, error } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('admin_email')
    .eq('session_id', token)
    .gte('expires_at', new Date().toISOString())
    .single();

  // Fallback to token field (backwards compatibility)
  if (error || !data) {
    const res = await supabase
      .from('h2s_dispatch_admin_sessions')
      .select('admin_email')
      .eq('token', token)
      .gte('expires_at', new Date().toISOString())
      .single();
    
    data = res.data;
    error = res.error;
  }

  if (error || !data) return false;
  
  // Update last_seen_at
  await supabase
    .from('h2s_dispatch_admin_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .or(`session_id.eq.${token},token.eq.${token}`);
  
  return true;
}

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    const { token, status, days = 14 } = body;

    console.log('[admin_jobs_list] Request:', { status, days });

    // Validate admin session
    const isValid = await validateAdminSession(token);
    if (!isValid) {
      console.log('[admin_jobs_list] Invalid or expired token');
      return res.status(401).json({
        ok: false,
        error: 'Not authorized',
        error_code: 'invalid_session'
      });
    }

    console.log('[admin_jobs_list] ✅ Admin session valid');

    // Calculate cutoff date
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Build query - use SELECT * and log ALL column names
    let query = supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .gte('created_at', cutoffDate);

    // Filter by status if provided (and not 'all')
    if (status && status !== 'all') {
      query = query.eq('status', status.toLowerCase());
    }

    const { data: jobs, error: jobsError } = await query.order('created_at', { ascending: false }).limit(200);

    if (jobsError) {
      console.error('[admin_jobs_list] Jobs query error:', jobsError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch jobs',
        error_code: 'query_failed',
        details: jobsError.message
      });
    }

    console.log('[admin_jobs_list] ✅ Found', jobs?.length || 0, 'jobs from h2s_dispatch_jobs');
    
    // Find the problem job IMMEDIATELY after SELECT to see ALL column names
    const rawProblemJob = jobs?.find(j => j.job_id === 'e5644e68-3995-40fa-bf75-69842e69042d');
    if (rawProblemJob) {
      console.log('[admin_jobs_list] RAW FROM DATABASE - ALL COLUMNS:');
      console.log(JSON.stringify(Object.keys(rawProblemJob)));
      console.log('[admin_jobs_list] RAW VALUES:');
      console.log(JSON.stringify(rawProblemJob, null, 2));
      console.log('  address:', rawProblemJob.address);
      console.log('  city:', rawProblemJob.city);
      console.log('  ALL KEYS:', Object.keys(rawProblemJob).sort().join(', '));
    }
    
    // DEBUG: Log specific problematic job
    if (jobs && jobs.length > 0) {
      const problemJob = jobs.find(j => j.job_id === 'e5644e68-3995-40fa-bf75-69842e69042d');
      if (problemJob) {
        console.log('[admin_jobs_list] PROBLEM JOB RAW DATA:');
        console.log('[admin_jobs_list]   job_id:', problemJob.job_id);
        console.log('[admin_jobs_list]   customer_name:', problemJob.customer_name);
        console.log('[admin_jobs_list]   address:', problemJob.address);
        console.log('[admin_jobs_list]   city:', problemJob.city);
        console.log('[admin_jobs_list]   state:', problemJob.state);
        console.log('[admin_jobs_list]   service_address:', problemJob.service_address);
        console.log('[admin_jobs_list]   service_city:', problemJob.service_city);
        console.log('[admin_jobs_list]   ALL KEYS:', Object.keys(problemJob).join(', '));
      }
    }
    
    // Legacy h2s_jobs fetch removed as per user instruction (finance/legacy data no longer needed)
    const legacyJobs = [];
    
    // Merge both sources, prioritizing dispatch_jobs
    const allJobsMap = {};
    // h2s_dispatch_jobs has: customer_name, service_address, service_city, service_state, service_zip
    (jobs || []).forEach(j => {
      allJobsMap[j.job_id] = {
        ...j,
        // Map service columns to standard names expected by portal
        address: j.service_address || j.address || '',
        city: j.service_city || j.city || '',
        state: j.service_state || j.state || '',
        zip: j.service_zip || j.zip || ''
      };
    });
    
    // h2s_jobs (legacy) has: service_address, service_city, service_state, service_zip
    (legacyJobs || []).forEach(j => {
      if (!allJobsMap[j.job_id]) {
        // Convert legacy job format to match dispatch_jobs column names
        allJobsMap[j.job_id] = {
          ...j,
          // Map legacy columns to standard names
          customer_name: j.customer_name || '',
          address: j.service_address || j.address || '',
          city: j.service_city || j.city || '',
          state: j.service_state || j.state || '',
          zip: j.service_zip || j.zip || '',
          metadata: j.metadata || {},
          source: 'h2s_jobs'
        };
      }
    });
    
    const allJobs = Object.values(allJobsMap);
    console.log('[admin_jobs_list] ✅ Total jobs after merge:', allJobs.length, '(dispatch:', jobs?.length || 0, '+ legacy:', (legacyJobs?.length || 0) - (allJobs.length - (jobs?.length || 0)), ')');

    // Fetch all job assignments for these jobs
    const jobIds = allJobs.map(j => j.job_id);
    let assignments = [];
    let pros = [];
    
    if (jobIds.length > 0) {
      const { data: assignmentsData } = await supabase
        .from('h2s_dispatch_job_assignments')
        .select('job_id, pro_id, state, accepted_at, completed_at')
        .in('job_id', jobIds)
        .in('state', ['accepted', 'completed']);
      
      assignments = assignmentsData || [];

      // Fetch pro details - try h2s_pros first, then h2s_dispatch_pros
      const proIds = [...new Set(assignments.map(a => a.pro_id).filter(Boolean))];
      if (proIds.length > 0) {
        // Try h2s_pros table (main table used by portal_login)
        const { data: prosMain } = await supabase
          .from('h2s_pros')
          .select('pro_id, name, email, phone')
          .in('pro_id', proIds);
        
        if (prosMain && prosMain.length > 0) {
          pros = prosMain.map(p => ({
            pro_id: p.pro_id,
            pro_name: p.name,
            pro_email: p.email,
            pro_phone: p.phone
          }));
        } else {
          // Fallback to h2s_dispatch_pros
          const { data: prosDispatch } = await supabase
            .from('h2s_dispatch_pros')
            .select('pro_id, pro_name, pro_email')
            .in('pro_id', proIds);
          
          pros = prosDispatch || [];
        }
      }
    }

    // Create lookup maps
    const assignmentsByJob = {};
    if (assignments) {
      assignments.forEach(a => {
        if (!assignmentsByJob[a.job_id]) assignmentsByJob[a.job_id] = [];
        assignmentsByJob[a.job_id].push(a);
      });
    }

    const prosById = {};
    if (pros) {
      pros.forEach(p => {
        prosById[p.pro_id] = p;
      });
    }

    // Format jobs for frontend
    const formattedJobs = allJobs.map(job => {
      let lineItems = [];
      try {
          // Try metadata.items_json first (shop orders)
          if (job.metadata?.items_json) {
              lineItems = Array.isArray(job.metadata.items_json) 
                  ? job.metadata.items_json 
                  : (typeof job.metadata.items_json === 'string' ? JSON.parse(job.metadata.items_json) : []);
          } 
          // Fallback to line_items_json (legacy dispatch jobs)
          else if (job.line_items_json) {
              lineItems = typeof job.line_items_json === 'string' 
                  ? JSON.parse(job.line_items_json) 
                  : job.line_items_json;
          }
      } catch (e) {
          console.warn('Failed to parse line items for job', job.job_id);
      }

      // Extract technician info from assignments
      let assignedProName = null;
      let assignedProId = null;
      let assignedProEmail = null;
      let assignedProPhone = null;
      
      const jobAssignments = assignmentsByJob[job.job_id] || [];
      if (jobAssignments.length > 0) {
        // Get the most recent accepted/completed assignment
        const activeAssignment = jobAssignments.sort((a, b) => 
          new Date(b.accepted_at || b.completed_at) - new Date(a.accepted_at || a.completed_at)
        )[0];
        
        if (activeAssignment && activeAssignment.pro_id) {
          assignedProId = activeAssignment.pro_id;
          const pro = prosById[assignedProId];
          if (pro) {
            assignedProName = pro.pro_name;
            assignedProEmail = pro.pro_email;
            assignedProPhone = pro.pro_phone;
          }
        }
      }
      
      // Fallback: Check if job.assigned_pro_id exists but no name was found
      if (!assignedProName && job.assigned_pro_id) {
        assignedProId = job.assigned_pro_id;
        const pro = prosById[job.assigned_pro_id];
        if (pro) {
          assignedProName = pro.pro_name;
          assignedProEmail = pro.pro_email;
          assignedProPhone = pro.pro_phone;
        }
      }
      
      // Final fallback: Use whatever was in the job record itself
      if (!assignedProName && job.assigned_pro_name) {
        assignedProName = job.assigned_pro_name;
      }

      let suggestions = [];
      // Disabled - causing crashes
      // try {
      //   if (lineItems && lineItems.length > 0) {
      //     suggestions = getRecommendedItems(...);
      //   }
      // } catch (e) {
      //   suggestions = [];
      // }

      // Service name mapping for bundles and services
      const serviceNameMap = {
        'tv_multi': 'Multi-TV Installation',
        'tv_single': 'Single TV Installation',
        'soundbar': 'Soundbar Installation',
        'soundbar-install': 'Soundbar Installation',
        'tv-mount-55': '55" TV Mount',
        'tv-mount-65': '65" TV Mount',
        'tv-mount-75': '75" TV Mount',
        'tv-mount-85': '85" TV Mount',
        'cable-management': 'Cable Management',
        'smart-home-setup': 'Smart Home Setup',
        'svc_maintenance': 'General Service'
      };

      // Extract service name from metadata.items_json if main fields are empty or look like codes
      let serviceName = job.service_name || '';
      
      // CRITICAL: Ensure metadata is properly accessed as object
      const jobMetadata = job.metadata || {};
      
      // Check if service name is a code or generic placeholder
      const isGenericOrCode = !serviceName || 
                             serviceName === 'svc_maintenance' || 
                             serviceName === 'Service Order' ||
                             (serviceName.includes('_') && !serviceName.includes(' '));

      if (isGenericOrCode && jobMetadata.items_json) {
        try {
          const items = typeof jobMetadata.items_json === 'string' 
            ? JSON.parse(jobMetadata.items_json) 
            : jobMetadata.items_json;
          
          if (Array.isArray(items) && items.length > 0) {
            // Aggregate all service names and map them to readable names
            const names = items
              .map(item => {
                if (!item || item.type === 'product') return null; // Skip products
                
                const rawName = item.service_name || item.bundle_id || item.service_id || item.name || '';
                
                // Special handling for bundles
                if (rawName === 'tv_multi' || rawName === 'tv_single') {
                    const meta = item.metadata || {};
                    const count = meta.mounts_needed || item.qty || 1;
                    const size = meta.tv_size ? `${meta.tv_size}" ` : '';
                    return `${count}x ${size}TV Install`;
                }
                
                // Check if it's in our mapping, otherwise clean it up
                return serviceNameMap[rawName] || rawName.replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              })
              .filter(n => n);
            
            if (names.length > 0) {
                // Deduplicate service names and add quantity if multiple of same service
                const nameCounts = {};
                names.forEach(name => {
                  nameCounts[name] = (nameCounts[name] || 0) + 1;
                });
                
                const uniqueNames = Object.entries(nameCounts).map(([name, count]) => {
                  return count > 1 ? `${name} (${count}x)` : name;
                });
                
                serviceName = uniqueNames.join(' + ');
            }
          }
        } catch (e) {
          console.error('[admin_jobs_list] Failed to parse items_json:', e);
          // Keep original serviceName if parsing fails
        }
      }

      // Extract address from metadata if direct columns are empty
      const metadata = job.metadata || {};
      const customerName = job.customer_name || metadata.customer_name || '';
      const address = job.address || metadata.service_address || '';
      const city = job.city || metadata.city || '';
      const state = job.state || metadata.state || '';
      const zip = job.zip || metadata.zip || '';

      // Return job with extracted metadata
      return {
        job_id: job.job_id,
        status: job.status || '',
        service_id: job.service_id || '',
        service_name: serviceName || job.service_id || 'Unnamed Service',
        customer_name: customerName,
        customer_email: job.customer_email || '',
        address: address,
        city: city,
        state: state,
        zip: zip,
        start_iso: job.start_iso || '',
        end_iso: job.end_iso || '',
        variant_code: job.variant_code || '',
        resources_needed: job.resources_needed || '',
        option_id: job.option_id || '',
        qty: job.qty || 1,
        assigned_pro_name: assignedProName,
        assigned_pro_id: assignedProId,
        assigned_pro_email: assignedProEmail,
        assigned_pro_phone: assignedProPhone,
        line_items_json: job.line_items_json || null,
        metadata: jobMetadata, // Pass through the actual metadata object
        created_at: job.created_at,
        purchasing_suggestions: suggestions
      };
    });

    // INTELLIGENT SORTING: Organize jobs by priority and timeline
    formattedJobs.sort((a, b) => {
      // Status priority order (higher number = higher priority)
      const statusPriority = {
        'pending': 5,           // Needs immediate action
        'accepted': 4,          // Scheduled, upcoming
        'in_progress': 6,       // Actively being worked on
        'completed': 2,         // Done, waiting for payment
        'pending_payment': 3,   // Waiting for payout approval
        'paid': 1,              // Fully complete
        'cancelled': 0          // Archived
      };
      
      const aPriority = statusPriority[a.status] || 0;
      const bPriority = statusPriority[b.status] || 0;
      
      // 1. Sort by status priority first
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      // 2. Within same status, sort by scheduled time
      // For pending/accepted: earliest scheduled jobs first
      if (a.status === 'pending' || a.status === 'accepted') {
        const aTime = a.start_iso || a.created_at;
        const bTime = b.start_iso || b.created_at;
        if (aTime && bTime) {
          return new Date(aTime) - new Date(bTime); // Ascending (soonest first)
        }
      }
      
      // For completed/paid: most recent first
      if (a.status === 'completed' || a.status === 'paid' || a.status === 'pending_payment') {
        return new Date(b.created_at) - new Date(a.created_at); // Descending
      }
      
      // 3. Fallback: newest first
      return new Date(b.created_at) - new Date(a.created_at);
    });

    console.log('[admin_jobs_list] ✅ Sorted', formattedJobs.length, 'jobs by priority');

    return res.status(200).json({
      ok: true,
      jobs: formattedJobs
    });

  } catch (error) {
    console.error('[admin_jobs_list] Unexpected error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      error_code: 'internal_error',
      details: error.message
    });
  }
}

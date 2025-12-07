# Bug Analysis: Accepted Jobs Disappearing from Upcoming Tab

## Symptom
When pro accepts a job from the Offers tab, it appears in the Upcoming tab for ~1-10 seconds, then disappears completely. The job DOES appear in the Customers tab, proving the backend state is correct.

---

## Root Cause Analysis (ALL Possible Reasons)

### **REASON 1: Cache Loading Race Condition** 🔥 **MOST LIKELY**
**Location:** `portalv3.html` lines 7750-7760 + 6490-6510

**Problem Flow:**
1. User accepts job → optimistic UI update (line 7014)
2. Backend updates assignment state to 'accepted' → success
3. `invalidateCache('dash')` called (line 7030)
4. `setTimeout(() => loadJobs(), 1000)` scheduled (line 7031)
5. **BUG:** `loadJobs()` checks cache FIRST (line 7750)
6. If `loadCacheFromStorage()` runs and finds OLD cached data from localStorage
7. The STALE cache gets loaded, overwriting the optimistic update
8. Job disappears because old cache shows it in 'offered' state

**Evidence:**
```javascript
// Line 7750 - loadJobs() ALWAYS checks cache first
const cached = getCache('dash');
const cacheAge = cached ? Date.now() - (cached._timestamp || 0) : Infinity;

if (cached && cacheAge < CACHE_MAX_AGE) {
  console.log(`[Dashboard] 🎯 Using cached data`);
  currentJobsData = cached; // ⚠️ OVERWRITES optimistic update
  renderUpcoming(cached.upcoming); // ⚠️ Job not in cached.upcoming
}
```

**Fix Applied:** Modified `invalidateCache()` to also delete from localStorage (lines 5563-5580)

**STILL POSSIBLE IF:** `saveCacheToStorage()` runs AFTER acceptance but BEFORE the 1-second setTimeout completes

---

### **REASON 2: Backend Status Filter Mismatch** ⚠️ **POSSIBLE**
**Location:** `api/portal_jobs.js` line 106

**Problem Flow:**
1. Job accepted → backend sets assignment `state: 'accepted'`
2. Backend query: `.in('status', ['pending_assign', 'pending', 'accepted', 'scheduled'])`
3. **BUG:** If job's `status` field is NOT updated to 'accepted' in `h2s_dispatch_jobs` table
4. Job may be excluded from backend response

**Evidence:**
```javascript
// portal_accept.js lines 183-189
const { error: jobUpdateError } = await supabase
  .from('h2s_dispatch_jobs')
  .update({ status: 'accepted' })
  .eq('job_id', jobId);

if (jobUpdateError) {
  console.error('[portal_accept] Warning: Failed to update job status:', jobUpdateError);
  // ⚠️ Silent failure - job's status field might still be 'pending_assign'
}
```

**Check:** Does the job's `status` column in `h2s_dispatch_jobs` get updated successfully?

---

### **REASON 3: Assignment Categorization Logic**
**Location:** `api/portal_jobs.js` lines 310-320

**Problem Flow:**
1. Backend fetches job assignments ordered by `offer_sent_at DESC`
2. `assignmentMap` built from assignments (line 295)
3. **BUG:** If duplicate assignments exist with DIFFERENT states
4. Older 'offered' assignment might overwrite newer 'accepted' state
5. Job categorized incorrectly → not included in `upcoming` array

**Evidence:**
```javascript
// Lines 310-320 - Skip logic for non-'offered' jobs from jobsWithinRadius
if (assignment && assignment.state !== 'offered') {
  console.log('[portal_jobs] Skipping job', job.job_id, 'from jobsWithinRadius - has assignment state:', assignment.state);
  return; // ⚠️ Job skipped from offers
}

// Lines 450-455 - Categorization based on state
if (state === 'accepted') {
  upcoming.push(jobWithAssignment);
} else if (state === 'offered') {
  offersMap.set(job.job_id, jobWithAssignment);
}
```

**Fix Applied:** `assignmentMap` only keeps FIRST (newest) assignment per job (line 295)

**STILL POSSIBLE IF:** Database returns assignments in wrong order

---

### **REASON 4: Polling Overwrite** 🔥 **HIGHLY LIKELY**
**Location:** `portalv3.html` lines 8733-8822

**Problem Flow:**
1. Job accepted → optimistic UI update at T=0s
2. Polling interval runs every 30 seconds
3. **BUG:** If poll runs at T=10s and backend returns wrong data
4. Polling overwrites optimistic update with stale backend response
5. Job disappears

**Evidence:**
```javascript
// Lines 8733-8822 - Job polling
setInterval(async () => {
  const out = await GET("portal_jobs", {token});
  if (out.ok) {
    const offers = out.offers || [];
    const upcoming = out.upcoming || [];
    
    // Check if data changed
    if (JSON.stringify(currentJobsData) !== JSON.stringify({ offers, upcoming, completed })) {
      console.log('[Polling] Changes detected - updating UI');
      currentJobsData = { offers, upcoming, completed };
      renderUpcoming(upcoming); // ⚠️ OVERWRITES optimistic update
    }
  }
}, 30000);
```

**Fix Applied:** Added extensive logging to track what polling returns (lines 8733-8767)

**NEXT STEP:** Test and check console logs to see if polling is returning wrong data

---

### **REASON 5: Tab Switch Cache Reload**
**Location:** `portalv3.html` lines 6490-6510

**Problem Flow:**
1. Job accepted → optimistic UI shown
2. User switches to different tab (Customers, Profile, etc.)
3. User switches back to Dashboard
4. **BUG:** Tab switch logic reloads from cache (line 6507)
5. Stale cache loaded → job disappears

**Evidence:**
```javascript
// Lines 6490-6510
if (which === "dash") {
  const cached = getCache('dash');
  const cacheAge = cached ? Date.now() - (cached._timestamp || 0) : Infinity;
  
  if (!cached || cacheAge > CACHE_MAX_AGE) {
    loadJobs(); // Fresh reload
  } else {
    // ⚠️ Using cached data
    currentJobsData = cached;
    renderUpcoming(cached.upcoming); // ⚠️ OVERWRITES optimistic update
  }
}
```

**Test:** Does bug occur WITHOUT switching tabs?

---

### **REASON 6: Session/Token Expiration**
**Location:** `api/portal_accept.js` + frontend

**Problem Flow:**
1. Frontend sends accept request with token
2. Backend validates session (lines 35-41)
3. **BUG:** Session expired → backend returns 401
4. Frontend might fail silently or not update correctly
5. Subsequent `loadJobs()` call uses expired token → empty response

**Evidence:**
```javascript
// portal_accept.js lines 35-41
async function validateSession(token) {
  const { data, error } = await supabase
    .from('h2s_sessions')
    .select('pro_id, expires_at')
    .eq('session_id', token)
    .single();

  if (error || !data) return null;
  if (new Date() > new Date(data.expires_at)) return null; // ⚠️ Expired
}
```

**Check:** Console logs show any 401 errors?

---

### **REASON 7: Frontend State Mutation**
**Location:** `portalv3.html` line 7010

**Problem Flow:**
1. Optimistic update modifies `currentJobsData` directly (line 7010)
2. **BUG:** If `currentJobsData.offers` is a reference to cached object
3. Subsequent cache loads might restore original state
4. Optimistic changes lost

**Evidence:**
```javascript
// Lines 7006-7018
const offerIndex = currentJobsData.offers.findIndex(o => o.job_id === job.job_id);
if (offerIndex !== -1) {
  const offer = currentJobsData.offers[offerIndex];
  currentJobsData.offers.splice(offerIndex, 1); // ⚠️ Mutates array
  offer.assign_state = 'accepted'; // ⚠️ Mutates object
  currentJobsData.upcoming.unshift(offer); // ⚠️ Shared reference?
}
```

**Less Likely** - JavaScript arrays are mutable and this should work

---

### **REASON 8: Backend Assignment State Not Persisting**
**Location:** `api/portal_accept.js` lines 130-145

**Problem Flow:**
1. Accept request arrives
2. Backend updates assignment: `state: 'accepted'`
3. **BUG:** Update fails silently due to database error
4. Assignment stays in 'offered' state
5. Subsequent backend calls return job in offers, not upcoming

**Evidence:**
```javascript
// Lines 130-145
const { error: updateError } = await supabase
  .from('h2s_dispatch_job_assignments')
  .update({
    state: 'accepted',
    accepted_at: new Date().toISOString()
  })
  .eq('assign_id', existingAssignment.assign_id);

if (updateError) {
  console.error('Failed to update assignment:', updateError);
  return res.status(500).json({ ok: false, error: 'Failed to accept offer' });
  // ⚠️ Returns error, but frontend might not handle it correctly
}
```

**Check:** Backend console logs for any errors during accept?

---

### **REASON 9: Multiple Concurrent Accept Requests**
**Location:** `portalv3.html` line 7003

**Problem Flow:**
1. User clicks Accept button multiple times quickly
2. Multiple concurrent requests sent to backend
3. **BUG:** Race condition in backend assignment logic
4. Conflicting states written to database
5. Final state unpredictable

**Evidence:**
```javascript
// Line 7003 - No debouncing or disabled state during request
acceptBtn.onclick = async () => {
  // ⚠️ No check if already processing
  const out = await GET("portal_accept", {token, job_id: job.job_id});
}
```

**Fix Needed:** Disable accept button during request

---

### **REASON 10: Realtime Subscription Conflict** (If Active)
**Location:** Unknown - search for Supabase realtime listeners

**Problem Flow:**
1. Realtime subscription listens to `h2s_dispatch_job_assignments` changes
2. Assignment updated → realtime event fires
3. **BUG:** Realtime handler might trigger `loadJobs()` with stale data
4. Overwrites optimistic update

**Check:** Search codebase for Supabase realtime subscriptions

---

## Diagnostic Steps (In Order of Priority)

### Step 1: Test with Console Logs (DEPLOYED)
✅ **Already deployed** - extensive logging added to polling (lines 8733-8800)

**Action:** User should accept a job and paste console output showing:
- What polling returns at T=0, T=10, T=30 seconds
- Whether backend includes accepted job in `upcoming` array
- Cache hit/miss patterns

---

### Step 2: Check Backend Logs
**Action:** Check Vercel logs for `portal_accept` and `portal_jobs` endpoints

**Look for:**
- Any errors during assignment update
- Whether job status update succeeds
- Assignment state in `portal_jobs` response

---

### Step 3: Direct Database Query
**Action:** After accepting job, immediately query database:

```sql
-- Check assignment state
SELECT * FROM h2s_dispatch_job_assignments 
WHERE job_id = 'XXX' AND pro_id = 'YYY' 
ORDER BY created_at DESC;

-- Check job status
SELECT job_id, status FROM h2s_dispatch_jobs 
WHERE job_id = 'XXX';
```

**Expected:**
- Assignment `state = 'accepted'`
- Job `status = 'accepted'`

---

### Step 4: Disable Optimistic Update (Test)
**Action:** Comment out lines 7006-7018 (optimistic UI update)

**Test:** Does job appear in upcoming AFTER 1-second reload?
- **YES** → Problem is optimistic update being overwritten
- **NO** → Problem is backend not returning job correctly

---

### Step 5: Force Cache Bypass
**Action:** Modify `loadJobs()` to ALWAYS fetch fresh data:

```javascript
// Temporarily comment out cache check (line 7750-7760)
// const cached = getCache('dash');
// Force fresh load every time
const out = await GET("portal_jobs", {token});
```

**Test:** Does bug still occur without any caching?

---

## Recommended Immediate Fixes

### Fix 1: Prevent Cache Pollution After Accept ✅ CRITICAL
```javascript
// In acceptBtn.onclick (line 7030), add BEFORE invalidateCache:
localStorage.removeItem(`h2s_portal_cache_${token || adminToken || 'anon'}`);
invalidateCache('dash');
invalidateCache('schedule');
```

### Fix 2: Disable Polling During Accept
```javascript
// At start of acceptBtn.onclick:
stopJobPolling();

// After loadJobs() completes:
setTimeout(() => {
  loadJobs();
  startJobPolling(); // Resume after reload
}, 1000);
```

### Fix 3: Add Button Debouncing
```javascript
acceptBtn.onclick = async () => {
  if (acceptBtn.disabled) return; // Prevent double-click
  acceptBtn.disabled = true;
  try {
    // ... existing logic ...
  } finally {
    acceptBtn.disabled = false;
  }
};
```

### Fix 4: Force Fresh Load After Accept
```javascript
// Replace setTimeout(() => loadJobs(), 1000) with:
setTimeout(async () => {
  // Force bypass cache
  const out = await GET("portal_jobs", {token});
  if (out.ok) {
    const offers = out.offers || [];
    const upcoming = out.upcoming || [];
    const completed = out.completed || [];
    
    currentJobsData = { offers, upcoming, completed };
    setCache('dash', currentJobsData); // Update cache with fresh data
    
    renderOffers(offers);
    renderUpcoming(upcoming);
    renderCompleted(completed);
  }
}, 1000);
```

---

## Summary

**Most Likely Culprits (Ranked):**
1. **Polling Overwrite** - 30-second interval overwrites optimistic update with stale backend data
2. **Cache Race Condition** - localStorage cache loaded after optimistic update
3. **Backend Status Update Failure** - Job status not persisting in database
4. **Tab Switch Cache Reload** - User switches tabs, cache reloaded

**Next Steps:**
1. User tests with deployed logging and shares console output
2. Check Vercel backend logs for errors
3. Query database directly to verify assignment state
4. Apply Fix 1-4 above in parallel


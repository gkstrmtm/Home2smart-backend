# Git Push Instructions - Tracking Updates

## Your Repository
```
https://github.com/gkstrmtm/Home2smart-backend.git
```

## Files to Commit

### Modified Files (Tracking Updates)
- `api/track.js` - Enhanced with business entity linking
- `public/bundles.html` - Updated h2sTrack() to use new endpoint
- `public/bundles-success.html` - Added tracking client
- `public/schedule.html` - Added tracking client

### New Files (Documentation & Endpoints)
- `api/track-ping.js` - Health check endpoint
- `public/funnel-track.html` - Tracking dashboard (migrated from Apps Script)
- `TRACKING_IMPLEMENTATION_PROMPT.md` - Implementation guide
- `TRACKING_ENDPOINT.md` - Endpoint documentation
- `TRACKING_MIGRATION_COMPLETE.md` - Migration summary
- `TRACKING_STATUS.md` - Current status
- `TRACKING_VERIFICATION.md` - Verification steps
- `TRACKING_WIRED_UP.md` - Wired up summary

## Commands to Run

```bash
# 1. Stage all tracking-related files
git add api/track.js api/track-ping.js
git add public/bundles.html public/bundles-success.html public/schedule.html public/funnel-track.html
git add TRACKING_*.md

# 2. Commit with descriptive message
git commit -m "feat: Migrate tracking to Supabase-only, remove Apps Script/Sheets dependencies

- Enhanced api/track.js with intelligent business entity linking (orders, jobs, customers, revenue)
- Updated frontend pages to use new tracking endpoint
- Added tracking client to bundles-success.html and schedule.html
- Migrated funnel-track.html from Apps Script to Supabase
- Added comprehensive tracking documentation
- All tracking now flows directly to Supabase (no dual-writes)"

# 3. Push to GitHub
git push origin main
```

## Alternative: Stage Everything at Once

```bash
# Stage all changes
git add api/track.js api/track-ping.js
git add public/bundles.html public/bundles-success.html public/schedule.html public/funnel-track.html
git add TRACKING_*.md

# Commit
git commit -m "feat: Complete tracking migration to Supabase-only system"

# Push
git push origin main
```

## After Pushing

Once pushed, you can pull these changes into any environment with:
```bash
git pull origin main
```

## Verify Push

After pushing, verify on GitHub:
1. Go to: https://github.com/gkstrmtm/Home2smart-backend
2. Check the latest commit shows your tracking changes
3. Verify all files are present


# Photo Loading Fix - Part 2 (Caching)

## The Issue
Even after fixing the CORS issue, the browser was likely serving a **cached response** from when the request was failing (or returning empty).

## The Fix
1. **Cache Buster:** Added `_t=Date.now()` to all Vercel GET requests. This forces the browser to fetch fresh data every time, bypassing the cache.
2. **Refresh Button:** Added a "Refresh Gallery" button to the "No photos uploaded yet" screen, so you can manually retry without reloading the whole page.

## Verification
1. Refresh the portal page (Ctrl+Shift+R recommended).
2. Open the photo gallery.
3. It should now fetch the latest data with a unique timestamp query parameter.
4. If it still says "No photos", click the new "Refresh Gallery" button.

## Technical Details
- Modified `GET()` function in `portalv3.html` to append `_t` param.
- Modified `viewPhotos()` in `portalv3.html` to add the button.
- Deployed to production (Commit `0a0f1db`).

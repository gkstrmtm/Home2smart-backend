# H2S Website - Production Ready

## 📁 Project Structure

```
Page tracking/          # Main deployment folder (Vercel)
├── api/               # Serverless API endpoints
├── public/            # Static assets
├── bundles.html       # Production bundles page
├── bundles-app.js     # Main application JavaScript
├── config.js          # Backend configuration
└── vercel.json        # Vercel deployment config

Root HTML Pages/       # Live website pages
├── dashboard.html
├── shop.html
├── smartauto.html
└── ...other pages

_archive/             # Old files (not deployed)
```

## 🚀 Deployment

### Current Setup
- **Platform**: Vercel
- **Production URL**: `https://h2s-backend-production.vercel.app`
- **Tracking**: Server-side via Vercel (no more Google Apps Script)

### Deploy to Vercel
```bash
cd "Page tracking"
vercel --prod
```

## 🔧 Configuration

All backend endpoints are configured in `Page tracking/config.js`:

- **Shop API**: `/api/shop`
- **Tracking API**: `/api/track` 
- **Checkout**: `/api/checkout`
- **Customer Portal**: `/api/portal`
- **Reviews**: `/api/reviews`

## 📝 Key Changes

✅ **Migrated tracking from Google Apps Script → Vercel**
- Faster, more reliable
- Better analytics
- Server-side tracking

✅ **Cleaned up workspace**
- Removed 40+ markdown documentation files
- Archived old test files
- Consolidated endpoints

✅ **Production-ready**
- Single source of truth for API endpoints
- Proper Vercel configuration
- Optimized for performance

## 🔗 Important URLs

- **Calendar Booking**: `https://api.leadconnectorhq.com/widget/booking/RjwOQacM3FAjRNCfm6uU`
- **Facebook Pixel ID**: `2384221445259822`

## 📞 Support

Phone: (864) 528-1475
Website: home2smart.com

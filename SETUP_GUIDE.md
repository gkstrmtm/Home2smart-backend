# Home2Smart Backend - Setup Guide for Multi-Device Development

## 🎯 GOAL
Work on this project from **Desktop (Windows)** and **Mac (Cursor/VS Code)** without manual file syncing. Git automatically keeps everything in sync.

---

## 📋 PREREQUISITES

### Required Software
- **Git** - Version control (https://git-scm.com/)
- **Node.js** - Runtime (https://nodejs.org/)
- **npm** - Package manager (comes with Node.js)
- **Vercel CLI** - Deployment (`npm install -g vercel`)
- **Code Editor** - VS Code or Cursor (https://cursor.sh/)

### Required Accounts
- **GitHub** - Code hosting (https://github.com/)
- **Vercel** - Hosting/deployment (https://vercel.com/)
- **Supabase** - Database (https://supabase.com/)
- **Twilio** - SMS (https://twilio.com/)
- **SendGrid** - Email (https://sendgrid.com/)
- **Stripe** - Payments (https://stripe.com/)

---

## 🚀 INITIAL SETUP (First Time on Mac)

### Step 1: Clone Repository
```bash
# Open Terminal on Mac
cd ~/Documents  # or wherever you want the project

# Clone the repo
git clone https://github.com/gkstrmtm/Home2smart-backend.git

# Enter the project
cd Home2smart-backend
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Create .env File
Create a file named `.env` in the project root with these variables:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Twilio (SMS)
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+18641234567
USE_TWILIO=true

# SendGrid (Email)
SENDGRID_API_KEY=your-sendgrid-key
SENDGRID_FROM_EMAIL=noreply@home2smart.com
SENDGRID_ENABLED=true

# Dispatch
DISPATCH_PHONES=8644502445,9513318992,8643239776

# Stripe
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-webhook-secret

# Vercel (auto-set during deployment)
VERCEL_URL=h2s-backend.vercel.app
```

**WHERE TO FIND THESE VALUES:**
- Supabase: Dashboard → Settings → API
- Twilio: Console → Account Info
- SendGrid: Settings → API Keys
- Stripe: Developers → API Keys

### Step 4: Link Vercel Project
```bash
vercel link
# Follow prompts to link to existing h2s-backend project
```

### Step 5: Test Locally
```bash
vercel dev
# Open http://localhost:3000 in browser
```

---

## 🔄 DAILY WORKFLOW (Desktop ↔ Mac Sync)

### ✅ THE MAGIC RULE
**ALWAYS `git pull` before starting work!**

This downloads the latest changes from the other device.

---

### 📱 Working on Desktop (Windows)

**1. Pull latest changes:**
```powershell
git pull
```

**2. Make your changes** (edit files, add features, fix bugs)

**3. Check what changed:**
```powershell
git status
```

**4. Stage all changes:**
```powershell
git add .
```

**5. Commit with message:**
```powershell
git commit -m "Fixed SMS bug in notify-customer.js"
```

**6. Push to GitHub:**
```powershell
git push
```

**7. Deploy to production (if needed):**
```powershell
vercel --prod
```

---

### 💻 Working on Mac (Cursor)

**1. Pull latest changes:**
```bash
git pull
```

**2. Make your changes** (edit files, add features, fix bugs)

**3. Check what changed:**
```bash
git status
```

**4. Stage all changes:**
```bash
git add .
```

**5. Commit with message:**
```bash
git commit -m "Added new email template"
```

**6. Push to GitHub:**
```bash
git push
```

**7. Deploy to production (if needed):**
```bash
vercel --prod
```

---

## ⚡ AUTOMATIC SYNC (No Manual Work!)

### How It Works
1. **You edit on Desktop** → `git push` → Changes go to GitHub
2. **Switch to Mac** → `git pull` → Mac gets Desktop changes automatically
3. **You edit on Mac** → `git push` → Changes go to GitHub
4. **Switch to Desktop** → `git pull` → Desktop gets Mac changes automatically

### Golden Rules
✅ **ALWAYS `git pull` before starting work**
✅ **ALWAYS `git push` when done working**
✅ **Commit frequently** (small changes are easier to track)
✅ **Write clear commit messages** ("Fixed login bug" not "stuff")

---

## 🛠️ COMMON SCENARIOS

### Scenario 1: You Forgot to Pull
**Problem:** You edited on Mac without pulling Desktop changes first.

**Solution:**
```bash
# Try to pull
git pull

# If there are conflicts, Git will tell you which files
# Open those files in Cursor - you'll see conflict markers:
# <<<<<<< HEAD
# Your Mac changes
# =======
# Desktop changes
# >>>>>>> origin/main

# Choose which version to keep (or merge both)
# Then:
git add .
git commit -m "Merged desktop and mac changes"
git push
```

### Scenario 2: You Edited Same File on Both Devices
**Problem:** Edited `api/send-sms.js` on Desktop, then edited same file on Mac without pulling.

**Solution:**
Git will show a **merge conflict**. Cursor has a built-in UI to resolve:
1. Open the file with conflicts
2. Cursor shows buttons: "Accept Current" | "Accept Incoming" | "Accept Both"
3. Click the one you want
4. Save, commit, push

### Scenario 3: You Want to Deploy from Mac
**Solution:**
```bash
# Mac deployment works exactly like Desktop
vercel --prod

# Same Vercel project, same environment variables
# No extra setup needed after initial `vercel link`
```

### Scenario 4: You Added New Files
**Solution:**
```bash
# New files are automatically tracked
git add .
git commit -m "Added new API endpoint"
git push

# Other device will get them on next `git pull`
```

---

## 📁 FILES THAT DON'T SYNC (By Design)

These are in `.gitignore` and **won't sync** between devices:

- `.env` - Environment variables (you must create manually on each device)
- `node_modules/` - Dependencies (run `npm install` on each device)
- `*.sql` - SQL files (run directly in Supabase, not deployed)
- `test-*.js` - Test scripts (local only)
- `.vercel/` - Vercel cache (auto-generated)

**Why?** Security (.env has secrets), size (node_modules is huge), and local-only files.

---

## 🎨 CURSOR-SPECIFIC SETUP

### Using GitHub Copilot in Cursor
1. Sign in to Cursor with your GitHub account
2. GitHub Copilot will automatically work (same subscription as VS Code)
3. No extra payment needed!

### Recommended Cursor Extensions
- **GitHub Copilot** - AI code completion
- **ESLint** - JavaScript linting
- **Prettier** - Code formatting
- **GitLens** - Advanced Git features

### Cursor Settings for This Project
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "javascript.updateImportsOnFileMove.enabled": "always"
}
```

---

## 🚨 TROUBLESHOOTING

### "Permission denied (publickey)" when pushing
**Solution:**
```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "tabariroper14@icloud.com"

# Add to GitHub: Settings → SSH Keys → New SSH Key
# Paste contents of ~/.ssh/id_ed25519.pub
```

### "npm install" fails on Mac
**Solution:**
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### "vercel: command not found" on Mac
**Solution:**
```bash
# Install Vercel CLI globally
npm install -g vercel

# Or use npx
npx vercel --prod
```

### Changes not showing on other device
**Solution:**
```bash
# Make sure you pushed from first device
git push

# Make sure you pulled on second device
git pull

# Check Git status
git status
```

### Merge conflicts everywhere
**Solution:**
```bash
# If you want to keep Mac version and discard Desktop
git checkout --theirs .
git add .
git commit -m "Kept Mac version"

# If you want to keep Desktop version and discard Mac
git checkout --ours .
git add .
git commit -m "Kept Desktop version"

# Or resolve manually file-by-file in Cursor
```

---

## 📊 DEPLOYMENT WORKFLOW

### Development → Production Pipeline

**1. Local Development**
```bash
# Work on feature locally
vercel dev  # Test at http://localhost:3000
```

**2. Commit Changes**
```bash
git add .
git commit -m "Added pro assignment email feature"
git push
```

**3. Deploy to Production**
```bash
vercel --prod
```

**4. Verify Deployment**
- Check https://h2s-backend.vercel.app
- Test API endpoints
- Check logs: `vercel logs`

### Environment Variables (Vercel)
Already configured - same across all deployments:
```bash
# View current env vars
vercel env ls

# Add new env var
vercel env add MY_NEW_VAR

# Pull env vars to local .env
vercel env pull
```

---

## 🎯 CHEAT SHEET

### Most Common Commands

```bash
# === START WORK ===
git pull                    # Get latest changes

# === SAVE WORK ===
git add .                   # Stage all changes
git commit -m "message"     # Commit with message
git push                    # Push to GitHub

# === CHECK STATUS ===
git status                  # See what changed
git log                     # See commit history
git diff                    # See exact changes

# === DEPLOYMENT ===
vercel dev                  # Run locally
vercel --prod               # Deploy to production
vercel logs                 # View production logs

# === UNDO MISTAKES ===
git reset HEAD~1            # Undo last commit (keep changes)
git checkout .              # Discard all local changes
git stash                   # Temporarily save changes
git stash pop               # Restore stashed changes
```

---

## 📚 ADDITIONAL RESOURCES

- **Git Documentation:** https://git-scm.com/doc
- **Vercel Docs:** https://vercel.com/docs
- **Cursor Docs:** https://cursor.sh/docs
- **GitHub Copilot:** https://github.com/features/copilot

---

## 🎓 PASTE THIS TO CHATGPT

```
I have a Node.js backend project on GitHub at:
https://github.com/gkstrmtm/Home2smart-backend.git

I need help setting up the project on my Mac using Cursor (or VS Code).

The project uses:
- Node.js & npm
- Vercel for deployment
- Supabase for database
- Twilio for SMS
- SendGrid for email
- Stripe for payments

I need:
1. Step-by-step instructions to clone and set up the project
2. How to create the .env file with all required environment variables
3. How to sync changes between my Mac and Windows desktop using Git
4. How to deploy to Vercel from Mac
5. Common Git commands for daily workflow

Please provide detailed instructions assuming I'm new to Git.
```

---

## ✅ VERIFICATION CHECKLIST

After setup, verify everything works:

- [ ] `git pull` works without errors
- [ ] `npm install` completed successfully
- [ ] `.env` file created with all required keys
- [ ] `vercel dev` runs locally at http://localhost:3000
- [ ] `vercel link` connected to h2s-backend project
- [ ] Can make a change, commit, and push
- [ ] Can pull changes from other device
- [ ] `vercel --prod` deploys successfully

---

## 🎉 YOU'RE READY!

You can now work seamlessly between Desktop and Mac. Git handles all the syncing automatically!

**Remember:** `git pull` before work, `git push` after work. That's it! 🚀

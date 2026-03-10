# 🚀 GitHub Animated Stats Card

A self-hosted animated SVG stats card for your GitHub profile README.

## 📦 What's inside

```
github-stats-card/
├── api/
│   └── stats.js       ← Serverless function (Vercel)
├── vercel.json        ← Vercel config
├── package.json
└── README.md
```

---

## 🛠️ Deployment Steps

### Step 1 — Create a GitHub Personal Access Token

1. Go to → https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. Give it a name like `stats-card`
4. Select these scopes:
   - ✅ `read:user`
   - ✅ `repo` (for language data)
5. Click **Generate token**
6. **Copy the token** — you won't see it again!

---

### Step 2 — Push this project to GitHub

1. Create a new GitHub repo (e.g. `github-stats-card`)
2. Push this project:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/adityasoran0698/github-stats-card.git
git push -u origin main
```

---

### Step 3 — Deploy to Vercel

1. Go to → https://vercel.com/new
2. Import your `github-stats-card` repo
3. Click **Deploy** (no build settings needed)

---

### Step 4 — Add Environment Variables in Vercel

1. Go to your project on Vercel
2. Click **Settings → Environment Variables**
3. Add these two:

| Name | Value |
|------|-------|
| `GITHUB_TOKEN` | your token from Step 1 |
| `GITHUB_USERNAME` | `adityasoran0698` |

4. Click **Save** then go to **Deployments → Redeploy**

---

### Step 5 — Update your README

Once deployed, your card URL will be:
```
https://YOUR-PROJECT-NAME.vercel.app/api/stats
```

Replace the GitHub Stats section in your README with:

```markdown
## 📊 GitHub Stats

<div align="center">

<img src="https://YOUR-PROJECT-NAME.vercel.app/api/stats" alt="GitHub Stats" />

</div>
```

---

## ✅ Done!

Your animated stats card will now show:
- 🔥 Current Streak (with pulsing animation)
- 📈 Total Contributions (fade in)
- 🏆 Longest Streak
- 💻 Most Used Languages (animated sliding bars)

Card auto-refreshes every **1 hour** via Vercel's cache.

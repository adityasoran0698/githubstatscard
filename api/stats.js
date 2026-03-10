const https = require("https");

function fetchGitHub(query, token) {
  const body = JSON.stringify({ query });
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: "/graphql",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: `bearer ${token}`,
        "User-Agent": "github-stats-card",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function fetchLanguages(username, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: `/users/${username}/repos?per_page=100&type=owner`,
      method: "GET",
      headers: {
        Authorization: `bearer ${token}`,
        "User-Agent": "github-stats-card",
        Accept: "application/vnd.github.v3+json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const repos = JSON.parse(data);
        const langPromises = repos
          .filter((r) => !r.fork)
          .map(
            (r) =>
              new Promise((res2, rej2) => {
                const o2 = {
                  hostname: "api.github.com",
                  path: `/repos/${username}/${r.name}/languages`,
                  method: "GET",
                  headers: {
                    Authorization: `bearer ${token}`,
                    "User-Agent": "github-stats-card",
                    Accept: "application/vnd.github.v3+json",
                  },
                };
                const r2 = https.request(o2, (resp) => {
                  let d = "";
                  resp.on("data", (c) => (d += c));
                  resp.on("end", () => res2(JSON.parse(d)));
                });
                r2.on("error", rej2);
                r2.end();
              })
          );
        Promise.all(langPromises).then((results) => {
          const totals = {};
          results.forEach((langs) => {
            if (langs && !langs.message) {
              Object.entries(langs).forEach(([lang, bytes]) => {
                totals[lang] = (totals[lang] || 0) + bytes;
              });
            }
          });
          const total = Object.values(totals).reduce((a, b) => a + b, 0);
          const sorted = Object.entries(totals)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name, bytes]) => ({
              name,
              percent: Math.round((bytes / total) * 100 * 10) / 10,
            }));
          resolve(sorted);
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function generateSVG(stats) {
  const {
    username,
    totalContributions,
    currentStreak,
    longestStreak,
    streakStart,
    streakEnd,
    languages,
  } = stats;

  const langColors = {
    JavaScript: "#F7DF1E",
    TypeScript: "#3178C6",
    Python: "#3572A5",
    Java: "#B07219",
    HTML: "#E34C26",
    CSS: "#563D7C",
    "C++": "#F34B7D",
    C: "#555555",
    Go: "#00ADD8",
    Rust: "#DEA584",
    Ruby: "#CC342D",
    PHP: "#4F5D95",
    Shell: "#89E051",
    EJS: "#A91E50",
    Vue: "#41B883",
    Kotlin: "#A97BFF",
    Swift: "#FA7343",
    Dart: "#00B4AB",
  };

  const getColor = (name) => langColors[name] || "#58A6FF";

  // Build language bars
  const langBars = languages
    .map((lang, i) => {
      const barWidth = Math.max(lang.percent * 2.2, 4);
      const delay = 800 + i * 150;
      const color = getColor(lang.name);
      return `
      <g transform="translate(0, ${i * 36})">
        <circle cx="8" cy="14" r="5" fill="${color}" opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${delay}ms" fill="freeze"/>
        </circle>
        <text x="20" y="19" fill="#a0aec0" font-size="12" font-family="'Segoe UI', sans-serif" opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${delay}ms" fill="freeze"/>
          ${lang.name}
        </text>
        <text x="310" y="19" fill="#e2e8f0" font-size="12" font-family="'Segoe UI', sans-serif" text-anchor="end" opacity="0">
          <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${delay}ms" fill="freeze"/>
          ${lang.percent}%
        </text>
        <rect x="0" y="24" width="310" height="4" rx="2" fill="#2d3748"/>
        <rect x="0" y="24" width="0" height="4" rx="2" fill="${color}" opacity="0.9">
          <animate attributeName="width" from="0" to="${barWidth * (310 / 100)}" dur="0.8s" begin="${delay + 200}ms" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1"/>
          <animate attributeName="opacity" from="0" to="0.9" dur="0.3s" begin="${delay}ms" fill="freeze"/>
        </rect>
      </g>`;
    })
    .join("");

  return `<svg width="820" height="220" viewBox="0 0 820 220" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0d1117"/>
      <stop offset="100%" style="stop-color:#161b22"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#58A6FF"/>
      <stop offset="100%" style="stop-color:#a78bfa"/>
    </linearGradient>
    <linearGradient id="streakGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#58A6FF;stop-opacity:0.15"/>
      <stop offset="100%" style="stop-color:#58A6FF;stop-opacity:0"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="cardClip">
      <rect width="820" height="220" rx="16"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="820" height="220" rx="16" fill="url(#cardGrad)" stroke="#30363d" stroke-width="1"/>

  <!-- Top accent line -->
  <rect x="0" y="0" width="0" height="3" rx="0" fill="url(#accentGrad)">
    <animate attributeName="width" from="0" to="820" dur="1.2s" begin="0ms" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1"/>
  </rect>

  <!-- Divider vertical line -->
  <line x1="460" y1="20" x2="460" y2="200" stroke="#30363d" stroke-width="1" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="400ms" fill="freeze"/>
  </line>

  <!-- ===== LEFT SIDE: STREAK STATS ===== -->

  <!-- Total Contributions -->
  <g transform="translate(30, 30)" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="200ms" fill="freeze"/>
    <text x="0" y="0" fill="#58A6FF" font-size="11" font-family="'Segoe UI', sans-serif" letter-spacing="1" text-anchor="start">TOTAL CONTRIBUTIONS</text>
    <text x="0" y="40" fill="#e2e8f0" font-size="38" font-weight="700" font-family="'Segoe UI', sans-serif" filter="url(#glow)">${totalContributions}</text>
    <text x="0" y="58" fill="#4a5568" font-size="11" font-family="'Segoe UI', sans-serif">since account creation</text>
  </g>

  <!-- Divider horizontal -->
  <line x1="30" y1="105" x2="430" y2="105" stroke="#30363d" stroke-width="1" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="300ms" fill="freeze"/>
  </line>

  <!-- Current Streak -->
  <g transform="translate(30, 118)" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="400ms" fill="freeze"/>
    <text x="0" y="0" fill="#a78bfa" font-size="11" font-family="'Segoe UI', sans-serif" letter-spacing="1">CURRENT STREAK</text>
    <text x="0" y="36" fill="#e2e8f0" font-size="34" font-weight="700" font-family="'Segoe UI', sans-serif" filter="url(#glow)">${currentStreak} <tspan font-size="14" fill="#a78bfa" font-weight="400">days</tspan></text>
    <text x="0" y="56" fill="#4a5568" font-size="11" font-family="'Segoe UI', sans-serif">${streakStart} → Present</text>
  </g>

  <!-- Longest Streak -->
  <g transform="translate(230, 118)" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="500ms" fill="freeze"/>
    <text x="0" y="0" fill="#34d399" font-size="11" font-family="'Segoe UI', sans-serif" letter-spacing="1">LONGEST STREAK</text>
    <text x="0" y="36" fill="#e2e8f0" font-size="34" font-weight="700" font-family="'Segoe UI', sans-serif" filter="url(#glow)">${longestStreak} <tspan font-size="14" fill="#34d399" font-weight="400">days</tspan></text>
    <text x="0" y="56" fill="#4a5568" font-size="11" font-family="'Segoe UI', sans-serif">${streakStart} – ${streakEnd}</text>
  </g>

  <!-- Pulsing dot for current streak -->
  <circle cx="425" cy="148" r="5" fill="#a78bfa" opacity="0.8">
    <animate attributeName="r" values="5;8;5" dur="2s" repeatCount="indefinite" begin="600ms"/>
    <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2s" repeatCount="indefinite" begin="600ms"/>
  </circle>

  <!-- ===== RIGHT SIDE: LANGUAGES ===== -->
  <g transform="translate(485, 22)">
    <text x="0" y="0" fill="#e2e8f0" font-size="13" font-weight="600" font-family="'Segoe UI', sans-serif" opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="600ms" fill="freeze"/>
      Most Used Languages
    </text>
    <g transform="translate(0, 18)">
      ${langBars}
    </g>
  </g>
</svg>`;
}

module.exports = async (req, res) => {
  const username = process.env.GITHUB_USERNAME || "adityasoran0698";
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(500).send("GITHUB_TOKEN not set");
  }

  try {
    const query = `{
      user(login: "${username}") {
        contributionsCollection {
          contributionCalendar {
            totalContributions
          }
          contributionStreak: contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
      }
    }`;

    const [ghData, languages] = await Promise.all([
      fetchGitHub(query, token),
      fetchLanguages(username, token),
    ]);

    const contrib =
      ghData?.data?.user?.contributionsCollection?.contributionCalendar;
    const totalContributions = contrib?.totalContributions || 0;

    // Calculate streaks from contribution data
    const weeks =
      ghData?.data?.user?.contributionsCollection?.contributionStreak?.weeks ||
      [];
    const days = weeks.flatMap((w) => w.contributionDays).sort((a, b) => new Date(a.date) - new Date(b.date));

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let streakStart = "";
    let streakEnd = "";
    let tempStart = "";
    let bestStart = "";
    let bestEnd = "";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (d.contributionCount > 0) {
        if (tempStreak === 0) tempStart = d.date;
        tempStreak++;
        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
          bestStart = tempStart;
          bestEnd = d.date;
        }
      } else {
        tempStreak = 0;
      }
    }

    // Current streak (from end backwards)
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      const dDate = new Date(d.date);
      dDate.setHours(0, 0, 0, 0);
      const diff = Math.floor((today - dDate) / 86400000);
      if (diff > 1) break;
      if (d.contributionCount > 0) {
        currentStreak++;
        streakStart = d.date;
      } else if (diff === 0) {
        continue;
      } else {
        break;
      }
    }

    const fmt = (d) => {
      if (!d) return "N/A";
      const [y, m, day] = d.split("-");
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${months[parseInt(m) - 1]} ${parseInt(day)}`;
    };

    const svg = generateSVG({
      username,
      totalContributions,
      currentStreak,
      longestStreak,
      streakStart: fmt(streakStart || days[0]?.date),
      streakEnd: fmt(bestEnd),
      languages,
    });

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.status(200).send(svg);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating stats");
  }
};

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
          .map((r) =>
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
            .slice(0, 7)
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

const LANG_COLORS = {
  JavaScript: "#F7DF1E",
  TypeScript: "#3178C6",
  Python: "#3572A5",
  Java: "#B07219",
  HTML: "#E34C26",
  CSS: "#7B68EE",
  "C++": "#F34B7D",
  C: "#888888",
  Go: "#00ADD8",
  Rust: "#DEA584",
  Ruby: "#CC342D",
  PHP: "#4F5D95",
  Shell: "#89E051",
  EJS: "#E4405F",
  Vue: "#41B883",
  Kotlin: "#A97BFF",
  Swift: "#FA7343",
  Dart: "#00B4AB",
};
const getColor = (name) => LANG_COLORS[name] || "#58A6FF";

function buildDonutSegments(languages, cx, cy, r, sw) {
  const circumference = 2 * Math.PI * r;
  const gapFraction = 0.015; // small gap between segments
  const totalGap = gapFraction * languages.length * circumference;
  const usable = circumference - totalGap;

  let segments = "";
  // rotate so first segment starts at top
  let currentAngle = -Math.PI / 2;

  languages.forEach((lang, i) => {
    const fraction = lang.percent / 100;
    const segLen = fraction * usable;
    const gapLen = gapFraction * circumference;
    const color = getColor(lang.name);
    const delay = 500 + i * 130;

    // dasharray: segLen visible, rest hidden
    const dasharray = `${segLen} ${circumference - segLen}`;
    // dashoffset: circumference/4 - accumulated
    const dashoffset = circumference * 0.25 - (usable * (languages.slice(0, i).reduce((s, l) => s + l.percent / 100, 0))) - (gapLen * i);

    segments += `<circle
      cx="${cx}" cy="${cy}" r="${r}"
      fill="none"
      stroke="${color}"
      stroke-width="${sw}"
      stroke-linecap="butt"
      stroke-dasharray="0 ${circumference}"
      stroke-dashoffset="${dashoffset}"
      opacity="0"
    >
      <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${delay}ms" fill="freeze"/>
      <animate attributeName="stroke-dasharray"
        from="0 ${circumference}"
        to="${dasharray}"
        dur="1s" begin="${delay}ms" fill="freeze"
        calcMode="spline" keySplines="0.25 0.1 0.25 1"/>
    </circle>`;
  });

  return segments;
}

function generateSVG(stats) {
  const { totalContributions, currentStreak, longestStreak, streakStart, streakEnd, languages } = stats;

  const W = 860, H = 240;
  const divX = 450;

  // Donut params
  const cx = divX + 105, cy = 118, r = 72, sw = 20;
  const segments = buildDonutSegments(languages, cx, cy, r, sw);

  // Legend: right of donut
  const legendX = divX + 198;
  const legendItems = languages.map((lang, i) => {
    const y = 42 + i * 27;
    const delay = 600 + i * 100;
    return `<g transform="translate(${legendX}, ${y})" opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${delay}ms" fill="freeze"/>
      <rect x="0" y="0" width="10" height="10" rx="2" fill="${getColor(lang.name)}"/>
      <text x="15" y="10" fill="#c9d1d9" font-size="11.5" font-family="'Segoe UI',Arial,sans-serif">${lang.name} <tspan fill="${getColor(lang.name)}" font-weight="700">${lang.percent}%</tspan></text>
    </g>`;
  }).join("");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#58A6FF"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Card background -->
  <rect width="${W}" height="${H}" rx="16" fill="url(#bg)" stroke="#21262d" stroke-width="1"/>


  <!-- Vertical divider -->
  <line x1="${divX}" y1="18" x2="${divX}" y2="222" stroke="#21262d" stroke-width="1" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="300ms" fill="freeze"/>
  </line>

  <!-- ── LEFT: STATS ── -->

  <!-- Total Contributions -->
  <g transform="translate(30, 26)" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="150ms" fill="freeze"/>
    <text fill="#58A6FF" font-size="9.5" font-family="'Segoe UI',Arial,sans-serif" letter-spacing="1.8" font-weight="700">TOTAL CONTRIBUTIONS</text>
    <text y="50" fill="#f0f6fc" font-size="48" font-weight="800" font-family="'Segoe UI',Arial,sans-serif" filter="url(#glow)">${totalContributions}</text>
    <text y="68" fill="#484f58" font-size="11" font-family="'Segoe UI',Arial,sans-serif">since account creation</text>
  </g>

  <!-- Divider -->
  <line x1="30" y1="105" x2="${divX - 20}" y2="105" stroke="#21262d" stroke-width="1" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="250ms" fill="freeze"/>
  </line>

  <!-- Current Streak -->
  <g transform="translate(30, 126)" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="350ms" fill="freeze"/>
    <text fill="#a78bfa" font-size="9.5" font-family="'Segoe UI',Arial,sans-serif" letter-spacing="1.8" font-weight="700">CURRENT STREAK</text>
    <text y="44" fill="#f0f6fc" font-size="42" font-weight="800" font-family="'Segoe UI',Arial,sans-serif" filter="url(#glow)">${currentStreak}<tspan font-size="13" fill="#a78bfa" font-weight="500" dx="5">days</tspan></text>
    <text y="64" fill="#484f58" font-size="11" font-family="'Segoe UI',Arial,sans-serif">${streakStart} → Present</text>
  </g>

  <!-- Longest Streak -->
  <g transform="translate(235, 126)" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="450ms" fill="freeze"/>
    <text fill="#34d399" font-size="9.5" font-family="'Segoe UI',Arial,sans-serif" letter-spacing="1.8" font-weight="700">LONGEST STREAK</text>
    <text y="44" fill="#f0f6fc" font-size="42" font-weight="800" font-family="'Segoe UI',Arial,sans-serif" filter="url(#glow)">${longestStreak}<tspan font-size="13" fill="#34d399" font-weight="500" dx="5">days</tspan></text>
    <text y="64" fill="#484f58" font-size="11" font-family="'Segoe UI',Arial,sans-serif">${streakStart} – ${streakEnd}</text>
  </g>



  <!-- ── RIGHT: DONUT CHART ── -->

  <!-- Title -->
  <text x="${divX + 14}" y="28" fill="#f0f6fc" font-size="13" font-weight="700" font-family="'Segoe UI',Arial,sans-serif" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="450ms" fill="freeze"/>
    Most Used Languages
  </text>

  <!-- Background ring -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#21262d" stroke-width="${sw}" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="480ms" fill="freeze"/>
  </circle>

  <!-- Donut segments -->
  ${segments}

  <!-- Center label -->
  <text x="${cx}" y="${cy - 7}" text-anchor="middle" fill="#8b949e" font-size="10" font-weight="700" font-family="'Segoe UI',Arial,sans-serif" letter-spacing="1" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="1100ms" fill="freeze"/>
    LANGS
  </text>
  <text x="${cx}" y="${cy + 11}" text-anchor="middle" fill="#58A6FF" font-size="16" font-weight="800" font-family="'Segoe UI',Arial,sans-serif" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="1100ms" fill="freeze"/>
    ${languages.length}
  </text>

  <!-- Legend -->
  ${legendItems}

</svg>`;
}

module.exports = async (req, res) => {
  const username = process.env.GITHUB_USERNAME || "adityasoran0698";
  const token = process.env.GITHUB_TOKEN;

  if (!token) return res.status(500).send("GITHUB_TOKEN not set");

  try {
    const query = `{
      user(login: "${username}") {
        contributionsCollection {
          contributionCalendar {
            totalContributions
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

    const contrib = ghData?.data?.user?.contributionsCollection?.contributionCalendar;
    const totalContributions = contrib?.totalContributions || 0;
    const weeks = contrib?.weeks || [];
    const days = weeks
      .flatMap((w) => w.contributionDays)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    let currentStreak = 0, longestStreak = 0, tempStreak = 0;
    let streakStart = "", tempStart = "", bestStart = "", bestEnd = "";

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
      const [, m, day] = d.split("-");
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${months[parseInt(m) - 1]} ${parseInt(day)}`;
    };

    const svg = generateSVG({
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
    res.status(500).send("Error: " + err.message);
  }
};

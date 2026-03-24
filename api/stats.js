const https = require("https");

// ─────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────

/** Promisified HTTPS request — returns parsed JSON */
function httpsGet(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}\nBody: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Base GitHub API request headers */
function githubHeaders(token) {
  return {
    Authorization: `bearer ${token}`,
    "User-Agent": "github-stats-card",
    Accept: "application/vnd.github.v3+json",
  };
}

// ─────────────────────────────────────────────────────────────────
//  GITHUB DATA FETCHING
// ─────────────────────────────────────────────────────────────────

/** Fetch contribution calendar via GraphQL */
function fetchContributions(username, token) {
  const query = `{
    user(login: "${username}") {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { contributionCount date } }
        }
      }
    }
  }`;

  const body = JSON.stringify({ query });
  return httpsGet(
    {
      hostname: "api.github.com",
      path: "/graphql",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...githubHeaders(token),
      },
    },
    body
  );
}

/** Fetch language breakdown across all non-fork repos */
async function fetchLanguages(username, token) {
  const repos = await httpsGet({
    hostname: "api.github.com",
    path: `/users/${username}/repos?per_page=100&type=owner`,
    method: "GET",
    headers: githubHeaders(token),
  });

  if (!Array.isArray(repos)) {
    throw new Error(`Unexpected repos response: ${JSON.stringify(repos).slice(0, 200)}`);
  }

  const langMaps = await Promise.all(
    repos
      .filter((r) => !r.fork)
      .map((r) =>
        httpsGet({
          hostname: "api.github.com",
          path: `/repos/${username}/${r.name}/languages`,
          method: "GET",
          headers: githubHeaders(token),
        })
      )
  );

  // Aggregate byte counts across all repos
  const totals = {};
  for (const langMap of langMaps) {
    if (langMap && !langMap.message) {
      for (const [lang, bytes] of Object.entries(langMap)) {
        totals[lang] = (totals[lang] || 0) + bytes;
      }
    }
  }

  const totalBytes = Object.values(totals).reduce((a, b) => a + b, 0);
  if (totalBytes === 0) return [];

  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([name, bytes]) => ({
      name,
      percent: Math.round((bytes / totalBytes) * 1000) / 10, // 1 decimal place
    }));
}

// ─────────────────────────────────────────────────────────────────
//  STREAK CALCULATION
// ─────────────────────────────────────────────────────────────────

/**
 * Computes current streak and longest streak from sorted contribution days.
 *
 * Current streak  — the most recent unbroken run of days ending today or
 *                   yesterday. Resets to 0 the moment a day is skipped.
 *                   Today is given a free pass when it has 0 contributions
 *                   (the day may not be over yet).
 *
 * Longest streak  — the longest unbroken run across all of history. Never
 *                   resets; only updated when a new record is set.
 *
 * All date arithmetic is done in UTC to avoid timezone off-by-one errors.
 *
 * @param {{ date: string, contributionCount: number }[]} days - ascending order
 * @returns {{ currentStreak, currentStart, longestStreak, longestStart, longestEnd }}
 */
function computeStreaks(days) {
  // ── Longest streak (forward pass) ────────────────────────────
  let longestStreak = 0;
  let longestStart  = "";
  let longestEnd    = "";
  let tempStreak    = 0;
  let tempStart     = "";

  for (const day of days) {
    if (day.contributionCount > 0) {
      if (tempStreak === 0) tempStart = day.date;
      tempStreak++;
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
        longestStart  = tempStart;
        longestEnd    = day.date;
      }
    } else {
      tempStreak = 0;
      tempStart  = "";
    }
  }

  // ── Current streak (backward pass) ───────────────────────────
  //
  // `expectedDiff` tracks which day the loop should encounter next as it
  // walks backwards from today. This correctly detects gaps even when the
  // raw days array contains zero-contribution entries in the middle.
  //
  //   expectedDiff = 0  → we're looking at today
  //   expectedDiff = 1  → we're looking at yesterday
  //   expectedDiff = 2  → two days ago … and so on
  //
  // If the day we read doesn't match expectedDiff, there's a gap and the
  // streak is 0.

  let currentStreak = 0;
  let currentStart  = "";

  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  let expectedDiff = 0;

  for (let i = days.length - 1; i >= 0; i--) {
    const day      = days[i];
    const dayUTC   = new Date(day.date + "T00:00:00Z");
    const diffDays = Math.round((todayUTC - dayUTC) / 86_400_000);

    // Skip any future-dated entries
    if (diffDays < 0) continue;

    // Today has no contributions yet — the day may not be over.
    // Give it a free pass and start counting from yesterday instead.
    if (diffDays === 0 && day.contributionCount === 0) {
      expectedDiff = 1;
      continue;
    }

    // This day is not the next expected day in sequence → there is a gap.
    // The current streak is broken; reset and stop.
    if (diffDays !== expectedDiff) {
      currentStreak = 0;
      currentStart  = "";
      break;
    }

    if (day.contributionCount > 0) {
      currentStreak++;
      currentStart = day.date; // walking backwards → ends up as the earliest date
      expectedDiff++;          // next iteration should be one day further back
    } else {
      // This day exists in sequence but has 0 contributions → streak broken.
      currentStreak = 0;
      currentStart  = "";
      break;
    }
  }

  return { currentStreak, currentStart, longestStreak, longestStart, longestEnd };
}

// ─────────────────────────────────────────────────────────────────
//  THEME
// ─────────────────────────────────────────────────────────────────

const THEMES = {
  dark: {
    bgFrom:       "#0d1117",
    bgTo:         "#161b22",
    border:       "#21262d",
    divider:      "#21262d",
    bigNum:       "#f0f6fc",
    accentBlue:   "#58A6FF",
    accentPurple: "#a78bfa",
    accentGreen:  "#34d399",
    dateText:     "#484f58",
    subtext:      "#484f58",
    titleRight:   "#f0f6fc",
    centerLabel:  "#8b949e",
    centerNum:    "#58A6FF",
    ringBg:       "#21262d",
    legendText:   "#c9d1d9",
    glowFilter:   "url(#glow)",
  },
  light: {
    bgFrom:       "#1C1C1E",
    bgTo:         "#0A0A0A",
    border:       "#3A3A3C",
    divider:      "#7C6FCD",
    bigNum:       "#FFFFFF",
    accentBlue:   "#00E5FF",
    accentPurple: "#FF6D00",
    accentGreen:  "#76FF03",
    dateText:     "#80DEEA",
    subtext:      "#9E9E9E",
    titleRight:   "#FFFFFF",
    centerLabel:  "#80DEEA",
    centerNum:    "#00E5FF",
    ringBg:       "#1A0533",
    legendText:   "#EEEEEE",
    glowFilter:   "url(#glow)",
  },
};

function getTheme(name) {
  return THEMES[name] ?? THEMES.dark;
}

// ─────────────────────────────────────────────────────────────────
//  LANGUAGE COLORS
// ─────────────────────────────────────────────────────────────────

const LANG_COLORS = {
  JavaScript: "#F7DF1E",
  TypeScript: "#3178C6",
  Python:     "#3572A5",
  Java:       "#B07219",
  HTML:       "#E34C26",
  CSS:        "#7B68EE",
  "C++":      "#F34B7D",
  C:          "#888888",
  Go:         "#00ADD8",
  Rust:       "#DEA584",
  Ruby:       "#CC342D",
  PHP:        "#4F5D95",
  Shell:      "#89E051",
  EJS:        "#E4405F",
  Vue:        "#41B883",
  Kotlin:     "#A97BFF",
  Swift:      "#FA7343",
  Dart:       "#00B4AB",
};

const getLangColor = (name) => LANG_COLORS[name] ?? "#58A6FF";

// ─────────────────────────────────────────────────────────────────
//  SVG HELPERS
// ─────────────────────────────────────────────────────────────────

/** Build animated donut chart segments */
function buildDonutSegments(languages, cx, cy, r, sw) {
  const circumference = 2 * Math.PI * r;
  const gapFraction   = 0.015;
  const totalGap      = gapFraction * languages.length * circumference;
  const usable        = circumference - totalGap;

  return languages
    .map((lang, i) => {
      const segLen       = (lang.percent / 100) * usable;
      const gapLen       = gapFraction * circumference;
      const color        = getLangColor(lang.name);
      const delay        = 500 + i * 130;
      const dasharray    = `${segLen} ${circumference - segLen}`;
      const priorPercent = languages
        .slice(0, i)
        .reduce((s, l) => s + l.percent / 100, 0);
      const dashoffset   =
        circumference * 0.25 - usable * priorPercent - gapLen * i;

      return `<circle
      cx="${cx}" cy="${cy}" r="${r}"
      fill="none" stroke="${color}" stroke-width="${sw}"
      stroke-linecap="butt"
      stroke-dasharray="0 ${circumference}"
      stroke-dashoffset="${dashoffset}" opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${delay}ms" fill="freeze"/>
      <animate attributeName="stroke-dasharray"
        from="0 ${circumference}" to="${dasharray}"
        dur="1s" begin="${delay}ms" fill="freeze"
        calcMode="spline" keySplines="0.25 0.1 0.25 1"/>
    </circle>`;
    })
    .join("\n  ");
}

/** Format an ISO date string (YYYY-MM-DD) → "Jan 5" */
function fmtDate(isoDate) {
  if (!isoDate) return "N/A";
  const [, month, day] = isoDate.split("-");
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MONTHS[parseInt(month, 10) - 1]} ${parseInt(day, 10)}`;
}

// ─────────────────────────────────────────────────────────────────
//  SVG GENERATION
// ─────────────────────────────────────────────────────────────────

function generateSVG(stats, themeName = "dark") {
  const {
    totalContributions,
    currentStreak,
    currentStart,
    longestStreak,
    longestStart,
    longestEnd,
    languages,
  } = stats;

  const c = getTheme(themeName);

  const W = 860, H = 240, divX = 450;
  const cx = divX + 105, cy = 118, r = 72, sw = 20;

  const segments    = buildDonutSegments(languages, cx, cy, r, sw);
  const legendX     = divX + 198;
  const legendItems = languages
    .map((lang, i) => {
      const y     = 42 + i * 27;
      const delay = 600 + i * 100;
      const color = getLangColor(lang.name);
      return `<g transform="translate(${legendX}, ${y})" opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${delay}ms" fill="freeze"/>
      <rect x="0" y="0" width="10" height="10" rx="2" fill="${color}"/>
      <text x="15" y="10" fill="${c.legendText}" font-size="11.5" font-family="'Segoe UI',Arial,sans-serif">
        ${lang.name} <tspan fill="${color}" font-weight="700">${lang.percent}%</tspan>
      </text>
    </g>`;
    })
    .join("\n  ");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c.bgFrom}"/>
      <stop offset="100%" stop-color="${c.bgTo}"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Card background -->
  <rect width="${W}" height="${H}" rx="16" fill="url(#bg)" stroke="${c.border}" stroke-width="1.5"/>

  <!-- Vertical divider -->
  <line x1="${divX}" y1="18" x2="${divX}" y2="222" stroke="${c.divider}" stroke-width="1" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="300ms" fill="freeze"/>
  </line>

  <!-- Total Contributions -->
  <g transform="translate(30, 26)" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="150ms" fill="freeze"/>
    <text fill="${c.accentBlue}" font-size="9.5" font-family="'Segoe UI',Arial,sans-serif" letter-spacing="1.8" font-weight="700">TOTAL CONTRIBUTIONS</text>
    <text y="50" fill="${c.bigNum}" font-size="48" font-weight="800" font-family="'Segoe UI',Arial,sans-serif" filter="${c.glowFilter}">${totalContributions}</text>
    <text y="68" fill="${c.dateText}" font-size="11" font-family="'Segoe UI',Arial,sans-serif" font-weight="500">Since Account Creation!</text>
  </g>

  <!-- Horizontal divider -->
  <line x1="30" y1="105" x2="${divX - 20}" y2="105" stroke="${c.divider}" stroke-width="1" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="250ms" fill="freeze"/>
  </line>

  <!-- Current Streak -->
  <g transform="translate(30, 126)" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="350ms" fill="freeze"/>
    <text fill="${c.accentPurple}" font-size="9.5" font-family="'Segoe UI',Arial,sans-serif" letter-spacing="1.8" font-weight="700">CURRENT STREAK</text>
    <text y="44" fill="${c.bigNum}" font-size="42" font-weight="800" font-family="'Segoe UI',Arial,sans-serif" filter="${c.glowFilter}">${currentStreak}<tspan font-size="13" fill="${c.accentPurple}" font-weight="500" dx="5">days</tspan></text>
    <text y="64" fill="${c.dateText}" font-size="11" font-family="'Segoe UI',Arial,sans-serif" font-weight="500">${fmtDate(currentStart)} → Present</text>
  </g>

  <!-- Longest Streak -->
  <g transform="translate(235, 126)" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="450ms" fill="freeze"/>
    <text fill="${c.accentGreen}" font-size="9.5" font-family="'Segoe UI',Arial,sans-serif" letter-spacing="1.8" font-weight="700">LONGEST STREAK</text>
    <text y="44" fill="${c.bigNum}" font-size="42" font-weight="800" font-family="'Segoe UI',Arial,sans-serif" filter="${c.glowFilter}">${longestStreak}<tspan font-size="13" fill="${c.accentGreen}" font-weight="500" dx="5">days</tspan></text>
    <text y="64" fill="${c.dateText}" font-size="11" font-family="'Segoe UI',Arial,sans-serif" font-weight="500">${fmtDate(longestStart)} – ${fmtDate(longestEnd)}</text>
  </g>

  <!-- Donut title -->
  <text x="${divX + 14}" y="28" fill="${c.titleRight}" font-size="13" font-weight="700" font-family="'Segoe UI',Arial,sans-serif" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="450ms" fill="freeze"/>
    Most Used Languages
  </text>

  <!-- Background ring -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c.ringBg}" stroke-width="${sw}" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="480ms" fill="freeze"/>
  </circle>

  ${segments}

  <!-- Center label -->
  <text x="${cx}" y="${cy - 7}" text-anchor="middle" fill="${c.centerLabel}" font-size="10" font-weight="700" font-family="'Segoe UI',Arial,sans-serif" letter-spacing="1" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="1100ms" fill="freeze"/>
    LANGS
  </text>
  <text x="${cx}" y="${cy + 11}" text-anchor="middle" fill="${c.centerNum}" font-size="16" font-weight="800" font-family="'Segoe UI',Arial,sans-serif" opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="1100ms" fill="freeze"/>
    ${languages.length}
  </text>

  ${legendItems}
</svg>`;
}

// ─────────────────────────────────────────────────────────────────
//  VERCEL HANDLER
// ─────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  const username = process.env.GITHUB_USERNAME || "adityasoran0698";
  const token    = process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(500).send("GITHUB_TOKEN environment variable is not set.");
  }

  const themeName = req.query.theme === "light" ? "light" : "dark";

  try {
    // Fetch contributions + languages in parallel
    const [ghData, languages] = await Promise.all([
      fetchContributions(username, token),
      fetchLanguages(username, token),
    ]);

    const calendar =
      ghData?.data?.user?.contributionsCollection?.contributionCalendar;

    if (!calendar) {
      throw new Error("GitHub API returned no contribution calendar data.");
    }

    const totalContributions = calendar.totalContributions ?? 0;

    // Flatten + sort contribution days ascending by date
    const days = calendar.weeks
      .flatMap((w) => w.contributionDays)
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const { currentStreak, currentStart, longestStreak, longestStart, longestEnd } =
      computeStreaks(days);

    const svg = generateSVG(
      {
        totalContributions,
        currentStreak,
        currentStart: currentStart || days[0]?.date || "",
        longestStreak,
        longestStart,
        longestEnd,
        languages,
      },
      themeName
    );

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.status(200).send(svg);
  } catch (err) {
    console.error("[github-stats-card]", err);
    res.status(500).send(`Error generating stats card: ${err.message}`);
  }
};

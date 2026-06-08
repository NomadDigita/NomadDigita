const https = require('https');
const fs = require('fs');

const USERNAME = 'NomadDigita';

function githubAPI(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com',
      path,
      headers: {
        'User-Agent': 'NomadDigita-Dashboard',
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

async function main() {
  const user    = await githubAPI(`/users/${USERNAME}`);
  const repos   = await githubAPI(`/users/${USERNAME}/repos?sort=pushed&per_page=30`);
  const events  = await githubAPI(`/users/${USERNAME}/events?per_page=100`);

  // Language stats
  const langCount = {};
  (repos || []).forEach(r => {
    if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
  });
  const totalLangs = Object.values(langCount).reduce((a, b) => a + b, 0) || 1;
  const topLangs = Object.entries(langCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([lang, count]) => ({ lang, pct: Math.round((count / totalLangs) * 100) }));

  // Daily commit sparkline (last 14 days)
  const now = new Date();
  const commitsByDay = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    commitsByDay[d.toDateString()] = 0;
  }
  const pushEvents = (events || []).filter(e => e.type === 'PushEvent');
  pushEvents.forEach(e => {
    const day = new Date(e.created_at).toDateString();
    if (day in commitsByDay)
      commitsByDay[day] += (e.payload.commits || []).length;
  });
  const dailyCommits  = Object.values(commitsByDay);
  const maxCommits    = Math.max(...dailyCommits, 1);
  const commitsToday  = commitsByDay[now.toDateString()] || 0;
  const latestRepo    = pushEvents[0]
    ? pushEvents[0].repo.name.replace(`${USERNAME}/`, '').toUpperCase()
    : 'STANDBY';

  const publicRepos = user?.public_repos || 0;
  const followers   = user?.followers   || 0;
  const date = now.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  }).toUpperCase();

  // SVG dimensions
  const W = 900, H = 260;

  // Sparkline bars
  const barW = 20, barGap = 4;
  const barsStartX = 230, barsBaseY = 220, maxBarH = 110;

  const barCells = dailyCommits.map((c, i) => {
    const bh = Math.max(4, (c / maxCommits) * maxBarH);
    const x  = barsStartX + i * (barW + barGap);
    const y  = barsBaseY - bh;
    const fill = c === 0 ? '#161B22'
               : c < 3  ? '#0E4429'
               : c < 7  ? '#006D32'
               : c < 15 ? '#26A641' : '#39D353';
    return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" fill="${fill}"/>`;
  }).join('\n    ');

  const dayNames = ['','M','','W','','F','','','M','','W','','F',''];
  const dayLabels = dayNames.map((d, i) => {
    if (!d) return '';
    const x = barsStartX + i * (barW + barGap) + barW / 2;
    return `<text x="${x}" y="${barsBaseY + 14}" font-family="monospace" font-size="9" fill="#484F58" text-anchor="middle">${d}</text>`;
  }).join('');

  // Language bars
  const langPalette = ['#FF6B35', '#AB47BC', '#00F5FF', '#4CAF50'];
  const langBars = topLangs.map((l, i) => {
    const y      = 90 + i * 40;
    const filled = Math.round((l.pct / 100) * 130);
    return `
    <text x="730" y="${y}" font-family="monospace" font-size="10" fill="#8B949E">${l.lang.toUpperCase()}</text>
    <rect x="730" y="${y + 6}" width="130" height="6" rx="3" fill="#21262D"/>
    <rect x="730" y="${y + 6}" width="${filled}" height="6" rx="3" fill="${langPalette[i]}"/>
    <text x="868" y="${y + 13}" font-family="monospace" font-size="10" fill="${langPalette[i]}" text-anchor="end">${l.pct}%</text>`;
  }).join('');

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FF6B35" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#00F5FF" stop-opacity="0.04"/>
    </linearGradient>
    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FF6B35" stop-opacity="0.9"/>
      <stop offset="50%" stop-color="#AB47BC" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#00F5FF" stop-opacity="0.9"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" rx="10" fill="#0D1117"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10"
        fill="none" stroke="url(#borderGrad)" stroke-width="1"/>

  <!-- Header -->
  <rect width="${W}" height="48" rx="10" fill="url(#headerGrad)"/>
  <rect y="10" width="${W}" height="38" fill="url(#headerGrad)"/>
  <line x1="0" y1="48" x2="${W}" y2="48" stroke="#21262D" stroke-width="1"/>

  <text x="20" y="30" font-family="monospace" font-size="14" font-weight="bold"
        fill="#FF6B35" letter-spacing="2">NOMADDIGITA</text>
  <text x="152" y="30" font-family="monospace" font-size="11" fill="#484F58"> · MISSION CONTROL</text>
  <text x="${W - 36}" y="30" font-family="monospace" font-size="10"
        fill="#484F58" text-anchor="end">${date}</text>
  <circle cx="${W - 20}" cy="24" r="4" fill="#39D353">
    <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite"/>
  </circle>

  <!-- Dividers -->
  <line x1="200" y1="48" x2="200" y2="${H}" stroke="#21262D" stroke-width="1"/>
  <line x1="720" y1="48" x2="720" y2="${H}" stroke="#21262D" stroke-width="1"/>

  <!-- LEFT: Metrics -->
  <text x="20" y="70" font-family="monospace" font-size="9" fill="#484F58" letter-spacing="3">METRICS</text>

  <text x="20" y="97"  font-family="monospace" font-size="9"  fill="#484F58">PUBLIC REPOS</text>
  <text x="20" y="122" font-family="monospace" font-size="30" font-weight="bold" fill="#FF6B35">${publicRepos}</text>

  <text x="20" y="152" font-family="monospace" font-size="9"  fill="#484F58">FOLLOWERS</text>
  <text x="20" y="177" font-family="monospace" font-size="30" font-weight="bold" fill="#AB47BC">${followers}</text>

  <text x="20" y="207" font-family="monospace" font-size="9"  fill="#484F58">TODAY</text>
  <text x="20" y="232" font-family="monospace" font-size="30" font-weight="bold" fill="#00F5FF">${commitsToday}</text>
  <text x="20" y="${H - 8}" font-family="monospace" font-size="9" fill="#484F58">COMMITS</text>

  <!-- CENTER: Sparkline -->
  <text x="230" y="70" font-family="monospace" font-size="9" fill="#484F58" letter-spacing="3">ACTIVITY · LAST 14 DAYS</text>
  ${barCells}
  ${dayLabels}
  <text x="230" y="${barsBaseY + 30}" font-family="monospace" font-size="9"  fill="#484F58">ACTIVE MISSION</text>
  <text x="230" y="${barsBaseY + 46}" font-family="monospace" font-size="11" fill="#FF6B35">${latestRepo}</text>

  <!-- RIGHT: Languages -->
  <text x="730" y="70" font-family="monospace" font-size="9" fill="#484F58" letter-spacing="3">LANGUAGES</text>
  ${langBars}
</svg>`;

  fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/dashboard.svg', svg);
  console.log('✅ Dashboard generated!');
}

main().catch(e => { console.error(e.message); process.exit(1); });

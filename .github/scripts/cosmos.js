const https = require('https');
const fs = require('fs');

const USERNAME = 'NomadDigita';

const REPO_COLORS = {
  'mantle-agentic-core':   '#00F5FF',
  'TradeMind-AI':          '#FF6B35',
  'Asiwaju-Trading-Hub':   '#4CAF50',
  'RugGuard-AI':           '#FF4081',
  'BuildersBot':           '#FFD700',
  'NomadDigita':           '#AB47BC',
};
const DEFAULT_COLOR = '#6B7280';

function githubAPI(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: {
        'User-Agent': 'NomadDigita-Cosmos',
        'Authorization': `token ${process.env.GITHUB_TOKEN}`
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
    }).on('error', reject);
  });
}

function hash(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return Math.abs(h);
}

async function main() {
  const events = await githubAPI(`/users/${USERNAME}/events?per_page=100`);
  const pushEvents = (Array.isArray(events) ? events : [])
    .filter(e => e.type === 'PushEvent');

  // Group by date
  const dayData = {};
  pushEvents.forEach(e => {
    const date = e.created_at.split('T')[0];
    const repo = e.repo.name.replace(`${USERNAME}/`, '');
    if (!dayData[date]) dayData[date] = { commits: 0, repos: {} };
    const count = (e.payload.commits || []).length;
    dayData[date].commits += count;
    dayData[date].repos[repo] = (dayData[date].repos[repo] || 0) + count;
  });

  // Last 90 days
  const now = new Date();
  const days = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const data = dayData[dateStr];
    days.push({
      dateStr,
      index: 89 - i,
      commits: data?.commits || 0,
      topRepo: data
        ? Object.entries(data.repos).sort((a, b) => b[1] - a[1])[0]?.[0]
        : null
    });
  }

  const maxCommits = Math.max(...days.map(d => d.commits), 1);
  const W = 900, H = 280;
  const PL = 20, PR = 20, PT = 46, PB = 30;
  const plotW = W - PL - PR;
  const plotH = H - PT - PB;

  // Contribution stars
  const stars = days
    .filter(d => d.commits > 0)
    .map(d => {
      const x = PL + (d.index / 89) * plotW;
      const yRatio = (hash(d.dateStr) % 1000) / 1000;
      const y = PT + 10 + yRatio * (plotH - 20);
      const r = 1.5 + (d.commits / maxCommits) * 9;
      const color = REPO_COLORS[d.topRepo] || DEFAULT_COLOR;
      return { x, y, r, color, commits: d.commits, date: d.dateStr, repo: d.topRepo };
    });

  // Constellation lines: connect same-repo stars within proximity
  const lines = [];
  for (let i = 0; i < stars.length - 1; i++) {
    const a = stars[i], b = stars[i + 1];
    if (a.repo && a.repo === b.repo) {
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist < 70) lines.push({ ...a, x2: b.x, y2: b.y });
    }
  }

  // Background noise stars
  const bgStars = Array.from({ length: 100 }, (_, i) => ({
    x: hash(`bx${i}`) % W,
    y: hash(`by${i}`) % H,
    r: 0.3 + (hash(`br${i}`) % 8) / 10,
    op: 0.05 + (hash(`bo${i}`) % 20) / 100
  }));

  // Legend
  const usedRepos = [...new Set(stars.map(s => s.repo).filter(Boolean))].slice(0, 5);
  const totalCommits = days.reduce((s, d) => s + d.commits, 0);
  const activeDays   = days.filter(d => d.commits > 0).length;

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="space" cx="40%" cy="50%" r="70%">
    <stop offset="0%" stop-color="#0A0E1A"/>
    <stop offset="100%" stop-color="#020408"/>
  </radialGradient>
  <radialGradient id="neb1" cx="25%" cy="35%" r="40%">
    <stop offset="0%" stop-color="#FF6B35" stop-opacity="0.05"/>
    <stop offset="100%" stop-color="#FF6B35" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="neb2" cx="75%" cy="65%" r="35%">
    <stop offset="0%" stop-color="#AB47BC" stop-opacity="0.06"/>
    <stop offset="100%" stop-color="#AB47BC" stop-opacity="0"/>
  </radialGradient>
  <filter id="glow">
    <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <linearGradient id="border" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%"   stop-color="#FF6B35" stop-opacity="0.7"/>
    <stop offset="50%"  stop-color="#AB47BC" stop-opacity="0.7"/>
    <stop offset="100%" stop-color="#00F5FF" stop-opacity="0.7"/>
  </linearGradient>
</defs>

<rect width="${W}" height="${H}" rx="10" fill="url(#space)"/>
<rect width="${W}" height="${H}" rx="10" fill="url(#neb1)"/>
<rect width="${W}" height="${H}" rx="10" fill="url(#neb2)"/>
<rect x=".5" y=".5" width="${W-1}" height="${H-1}" rx="10" fill="none" stroke="url(#border)" stroke-width="1"/>

${bgStars.map(s =>
  `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="white" opacity="${s.op}"/>`
).join('\n')}

<text x="20" y="26" font-family="monospace" font-size="11" font-weight="bold" fill="#FF6B35" letter-spacing="3">THE COSMOS</text>
<text x="130" y="26" font-family="monospace" font-size="10" fill="#484F58"> · CONTRIBUTION STAR MAP · LAST 90 DAYS</text>
<text x="${W-20}" y="26" font-family="monospace" font-size="10" fill="#484F58" text-anchor="end">${activeDays} ACTIVE · ${totalCommits} COMMITS</text>
<line x1="0" y1="36" x2="${W}" y2="36" stroke="#21262D" stroke-width="1"/>

<g opacity="0.35">
${lines.map(l =>
  `<line x1="${l.x.toFixed(1)}" y1="${l.y.toFixed(1)}" x2="${l.x2.toFixed(1)}" y2="${l.y2.toFixed(1)}" stroke="${l.color}" stroke-width="0.8"/>`
).join('\n')}
</g>

<g filter="url(#glow)">
${stars.map(s =>
  `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.r.toFixed(1)}" fill="${s.color}"><title>${s.date} · ${s.commits} commits · ${s.repo || 'various'}</title></circle>`
).join('\n')}
</g>

${usedRepos.map((repo, i) => {
  const color = REPO_COLORS[repo] || DEFAULT_COLOR;
  const x = 20 + i * 175;
  return `<circle cx="${x+5}" cy="${H-12}" r="4" fill="${color}" filter="url(#glow)"/>
<text x="${x+14}" y="${H-8}" font-family="monospace" font-size="9" fill="${color}">${repo.substring(0,18).toUpperCase()}</text>`;
}).join('\n')}
</svg>`;

  fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/cosmos.svg', svg);
  console.log(`✅ Cosmos: ${stars.length} stars, ${lines.length} constellation lines`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

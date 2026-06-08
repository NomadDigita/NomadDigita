const https = require('https');
const fs = require('fs');

const USERNAME = 'NomadDigita';

function githubAPI(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: {
        'User-Agent': 'NomadDigita-Frequency',
        'Authorization': `token ${process.env.GITHUB_TOKEN}`
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
    }).on('error', reject);
  });
}

function spectrumColor(t) {
  // Purple → Orange → Cyan as t goes 0 → 1
  if (t < 0.5) {
    const p = t * 2;
    return `rgb(${Math.round(123 + 132*p)},${Math.round(47 + 60*p)},${Math.round(255 - 202*p)})`;
  } else {
    const p = (t - 0.5) * 2;
    return `rgb(${Math.round(255 - 255*p)},${Math.round(107 + 138*p)},${Math.round(53 + 202*p)})`;
  }
}

async function main() {
  const events = await githubAPI(`/users/${USERNAME}/events?per_page=100`);
  const pushEvents = (Array.isArray(events) ? events : []).filter(e => e.type === 'PushEvent');

  // Weekly buckets (last 26 weeks)
  const now = new Date();
  const weeks = Array.from({ length: 26 }, (_, i) => {
    const wStart = new Date(now);
    wStart.setDate(wStart.getDate() - (25 - i) * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wEnd.getDate() + 7);
    const commits = pushEvents
      .filter(e => { const d = new Date(e.created_at); return d >= wStart && d < wEnd; })
      .reduce((s, e) => s + (e.payload.commits || []).length, 0);
    return { commits, date: wStart };
  });

  const maxC  = Math.max(...weeks.map(w => w.commits), 1);
  const W = 900, H = 160;
  const BW  = Math.floor((W - 40) / weeks.length) - 2;
  const BH  = 95;
  const BASE = H - 32;

  const bars = weeks.map((w, i) => {
    const h    = Math.max(3, (w.commits / maxC) * BH);
    const x    = 20 + i * (BW + 2);
    const color = spectrumColor(i / (weeks.length - 1));
    return `
  <rect x="${x}" y="${BASE - h}" width="${BW}" height="${h}" rx="1" fill="${color}" opacity="0.95"/>
  <rect x="${x}" y="${BASE}"     width="${BW}" height="${(h * 0.35).toFixed(1)}" rx="1" fill="${color}" opacity="0.2"/>`;
  }).join('');

  const labels = weeks
    .filter((_, i) => i % 4 === 0)
    .map(w => {
      const i = weeks.indexOf(w);
      const x = 20 + i * (BW + 2) + BW / 2;
      const label = w.date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      return `<text x="${x}" y="${H - 8}" font-family="monospace" font-size="9" fill="#484F58" text-anchor="middle">${label}</text>`;
    }).join('');

  const total  = weeks.reduce((s, w) => s + w.commits, 0);
  const active = weeks.filter(w => w.commits > 0).length;

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="border" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%"   stop-color="#AB47BC" stop-opacity="0.7"/>
    <stop offset="50%"  stop-color="#FF6B35" stop-opacity="0.7"/>
    <stop offset="100%" stop-color="#00F5FF" stop-opacity="0.7"/>
  </linearGradient>
  <filter id="glow">
    <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>

<rect width="${W}" height="${H}" rx="10" fill="#0D1117"/>
<rect x=".5" y=".5" width="${W-1}" height="${H-1}" rx="10" fill="none" stroke="url(#border)" stroke-width="1"/>

<text x="20" y="20" font-family="monospace" font-size="9" fill="#FF6B35" letter-spacing="3">THE FREQUENCY</text>
<text x="140" y="20" font-family="monospace" font-size="9" fill="#484F58"> · COMMIT SPECTRUM · 26 WEEKS · ${total} COMMITS · ${active} ACTIVE WEEKS</text>

<line x1="20" y1="${BASE}" x2="${W-20}" y2="${BASE}" stroke="#1C2128" stroke-width="1"/>

<g filter="url(#glow)">${bars}
</g>
${labels}
</svg>`;

  fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/frequency.svg', svg);
  console.log('✅ Frequency spectrum generated!');
}

main().catch(e => { console.error(e.message); process.exit(1); });

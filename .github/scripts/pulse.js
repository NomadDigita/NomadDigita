const https = require('https');
const fs    = require('fs');

const USERNAME = 'NomadDigita';
const TOKEN     = process.env.GITHUB_TOKEN;

function githubAPI(path) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: { 'User-Agent': 'Pulse', 'Authorization': `token ${TOKEN}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

async function main() {
  const events = await githubAPI(`/users/${USERNAME}/events?per_page=100`);
  const pushEvents = (Array.isArray(events) ? events : []).filter(e => e.type === 'PushEvent');

  // Last 24 hours, hourly buckets
  const now = new Date();
  const hours = Array.from({ length: 24 }, (_, i) => {
    const hourStart = new Date(now.getTime() - (23 - i) * 3600000);
    const commits = pushEvents.filter(e => {
      const d = new Date(e.created_at);
      return d.getTime() >= hourStart.getTime() && d.getTime() < hourStart.getTime() + 3600000;
    }).reduce((s, e) => s + (e.payload.commits || []).length, 0);
    return commits;
  });

  const maxC = Math.max(...hours, 1);
  const W = 900, H = 180;
  const PL = 20, PR = 20;
  const plotW = W - PL - PR;
  const midY = 100;
  const amp = 60;

  // Build EKG-style path: flat line with spikes on commit hours
  let path = `M ${PL} ${midY}`;
  const stepX = plotW / (hours.length - 1);

  hours.forEach((c, i) => {
    const x = PL + i * stepX;
    if (c === 0) {
      path += ` L ${x.toFixed(1)} ${midY}`;
    } else {
      const spike = Math.min(amp, (c / maxC) * amp);
      const x1 = x - stepX * 0.15;
      const x2 = x;
      const x3 = x + stepX * 0.15;
      path += ` L ${x1.toFixed(1)} ${midY} L ${x2.toFixed(1)} ${(midY - spike).toFixed(1)} L ${x3.toFixed(1)} ${midY}`;
    }
  });
  path += ` L ${PL + plotW} ${midY}`;

  const totalCommitsToday = hours.reduce((a, b) => a + b, 0);
  const lastActiveHour = hours.lastIndexOf(Math.max(...hours.filter(h => h > 0), 0));
  const isAlive = totalCommitsToday > 0;
  const bpm = isAlive ? 60 + totalCommitsToday * 8 : 0;

  const pulseColor = isAlive ? '#39D353' : '#484F58';

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="border" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="#FF6B35" stop-opacity="0.7"/>
    <stop offset="50%" stop-color="#39D353" stop-opacity="0.7"/>
    <stop offset="100%" stop-color="#00F5FF" stop-opacity="0.7"/>
  </linearGradient>
  <filter id="glow">
    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>

<rect width="${W}" height="${H}" rx="10" fill="#0D1117"/>
<rect x=".5" y=".5" width="${W-1}" height="${H-1}" rx="10" fill="none" stroke="url(#border)" stroke-width="1"/>

<text x="20" y="26" font-family="monospace" font-size="11" font-weight="bold" fill="#FF6B35" letter-spacing="3">THE PULSE</text>
<text x="120" y="26" font-family="monospace" font-size="10" fill="#484F58"> · LIVE VITAL SIGNS · LAST 24 HOURS</text>

<circle cx="${W-30}" cy="22" r="5" fill="${pulseColor}">
  ${isAlive ? '<animate attributeName="opacity" values="1;0.2;1" dur="0.8s" repeatCount="indefinite"/>' : ''}
</circle>
<text x="${W-45}" y="26" font-family="monospace" font-size="10" fill="${pulseColor}" text-anchor="end">${isAlive ? 'ALIVE' : 'RESTING'}</text>

<line x1="20" y1="48" x2="${W-20}" y2="48" stroke="#21262D" stroke-width="1"/>

<path d="${path}" fill="none" stroke="${pulseColor}" stroke-width="2" filter="url(#glow)"/>

<text x="20" y="${H-14}" font-family="monospace" font-size="9" fill="#484F58">${totalCommitsToday} commits today</text>
<text x="${W/2}" y="${H-14}" font-family="monospace" font-size="9" fill="#484F58" text-anchor="middle">BUILD RATE: ${bpm} BPM</text>
<text x="${W-20}" y="${H-14}" font-family="monospace" font-size="9" fill="#484F58" text-anchor="end">SCAN: ${now.toISOString().substring(11,16)} UTC</text>
</svg>`;

  fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/pulse.svg', svg);
  console.log(`✅ Pulse: ${totalCommitsToday} commits today, ${bpm} BPM`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

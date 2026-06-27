const https = require('https');
const fs    = require('fs');

const USERNAME = 'NomadDigita';
const TOKEN     = process.env.GITHUB_TOKEN;

function githubAPI(path) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: { 'User-Agent': 'Sentinel', 'Authorization': `token ${TOKEN}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

// Real statistics — z-score anomaly detection on actual commit velocity
function mean(arr) { return arr.reduce((a,b) => a+b, 0) / (arr.length || 1); }
function stdDev(arr) {
  const m = mean(arr);
  const variance = mean(arr.map(x => (x - m) ** 2));
  return Math.sqrt(variance);
}

async function main() {
  console.log('🛰️  Sentinel scanning...');

  const events = await githubAPI(`/users/${USERNAME}/events?per_page=100`);
  const pushEvents = (Array.isArray(events) ? events : []).filter(e => e && e.type === 'PushEvent');

  // 30-day daily commit vector
  const now = new Date();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const count = pushEvents
      .filter(e => e.created_at.startsWith(dateStr))
      .reduce((s, e) => s + (e.payload.commits || []).length, 0);
    days.push(count);
  }

  const m = mean(days);
  const sd = stdDev(days) || 1;
  const zScores = days.map(d => (d - m) / sd);

  const todayZ = zScores[zScores.length - 1];
  const recentZ = zScores.slice(-7);
  const avgRecentZ = mean(recentZ);

  // Threat level = build intensity classification (creative reframe, real math)
  let threatLevel, threatColor;
  if (avgRecentZ > 1.5)      { threatLevel = 'CRITICAL';  threatColor = '#FF3B3B'; }
  else if (avgRecentZ > 0.5) { threatLevel = 'ELEVATED';  threatColor = '#FF6B35'; }
  else if (avgRecentZ > -0.5){ threatLevel = 'NOMINAL';   threatColor = '#39D353'; }
  else                       { threatLevel = 'DORMANT';   threatColor = '#484F58'; }

  const anomalyDays = zScores.filter(z => Math.abs(z) > 1.8).length;

  // SVG dimensions
  const W = 900, H = 320;
  const cx = 165, cy = 165, radius = 110;

  // Radar grid rings
  const rings = [0.25, 0.5, 0.75, 1].map(f =>
    `<circle cx="${cx}" cy="${cy}" r="${radius * f}" fill="none" stroke="#1C2128" stroke-width="1"/>`
  ).join('');

  // Radar crosshairs
  const crosshairs = `
    <line x1="${cx - radius}" y1="${cy}" x2="${cx + radius}" y2="${cy}" stroke="#1C2128" stroke-width="1"/>
    <line x1="${cx}" y1="${cy - radius}" x2="${cx}" y2="${cy + radius}" stroke="#1C2128" stroke-width="1"/>`;

  // Plot last 30 days as radar blips — angle = day index, distance = |z-score|
  const blips = days.map((d, i) => {
    const angle = (i / 30) * Math.PI * 2 - Math.PI / 2;
    const z = Math.abs(zScores[i]);
    const dist = Math.min(radius - 8, 12 + z * 28);
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    const isAnomaly = Math.abs(zScores[i]) > 1.8;
    const r = isAnomaly ? 4.5 : 2;
    const color = isAnomaly ? '#FF3B3B' : (d > 0 ? '#39D353' : '#21262D');
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${color}" opacity="${d > 0 ? 0.9 : 0.3}"/>`;
  }).join('\n  ');

  // Sweep line (decorative radar sweep, fixed angle pointing to "now")
  const sweepAngle = -Math.PI / 2 + ((days.length - 1) / 30) * Math.PI * 2;
  const sweepX = cx + Math.cos(sweepAngle) * radius;
  const sweepY = cy + Math.sin(sweepAngle) * radius;

  // Right panel: anomaly log (real flagged days)
  const anomalyEntries = days
    .map((d, i) => ({ i, d, z: zScores[i] }))
    .filter(x => Math.abs(x.z) > 1.8)
    .slice(-5)
    .reverse();

  const daysAgo = (i) => 29 - i;

  const logLines = anomalyEntries.length
    ? anomalyEntries.map(a =>
        `<text x="350" y="${0}" font-family="monospace" font-size="10" fill="#FF6B35"></text>`
      ).join('')
    : '';

  const logRows = anomalyEntries.length
    ? anomalyEntries.map((a, idx) => `
    <text x="350" y="${95 + idx * 22}" font-family="monospace" font-size="10" fill="#FF3B3B">⚠ T-${daysAgo(a.i)}d</text>
    <text x="420" y="${95 + idx * 22}" font-family="monospace" font-size="10" fill="#8B949E">${a.d} commits</text>
    <text x="520" y="${95 + idx * 22}" font-family="monospace" font-size="10" fill="${a.z > 0 ? '#39D353' : '#FF6B35'}">z=${a.z.toFixed(2)}</text>`
      ).join('')
    : `<text x="350" y="95" font-family="monospace" font-size="10" fill="#484F58">No statistical anomalies in window.</text>`;

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="radarGlow" cx="${cx}" cy="${cy}" r="${radius}" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="${threatColor}" stop-opacity="0.08"/>
    <stop offset="100%" stop-color="${threatColor}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="sweepGrad" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="${threatColor}" stop-opacity="0"/>
    <stop offset="100%" stop-color="${threatColor}" stop-opacity="0.6"/>
  </linearGradient>
  <linearGradient id="border" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="#FF3B3B" stop-opacity="0.5"/>
    <stop offset="50%" stop-color="#FF6B35" stop-opacity="0.5"/>
    <stop offset="100%" stop-color="#39D353" stop-opacity="0.5"/>
  </linearGradient>
  <filter id="blip-glow">
    <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>

<rect width="${W}" height="${H}" rx="10" fill="#05070A"/>
<rect x=".5" y=".5" width="${W-1}" height="${H-1}" rx="10" fill="none" stroke="url(#border)" stroke-width="1"/>

<text x="20" y="26" font-family="monospace" font-size="11" font-weight="bold" fill="${threatColor}" letter-spacing="3">THE SENTINEL</text>
<text x="150" y="26" font-family="monospace" font-size="10" fill="#484F58"> · BUILD-INTENSITY ANOMALY DETECTION · 30-DAY WINDOW</text>
<text x="${W-20}" y="26" font-family="monospace" font-size="10" fill="${threatColor}" text-anchor="end">LEVEL: ${threatLevel}</text>
<circle cx="${W-12}" cy="20" r="4" fill="${threatColor}">
  <animate attributeName="opacity" values="1;0.15;1" dur="1.4s" repeatCount="indefinite"/>
</circle>
<line x1="0" y1="36" x2="${W}" y2="36" stroke="#161B22" stroke-width="1"/>

<!-- RADAR -->
<circle cx="${cx}" cy="${cy}" r="${radius}" fill="url(#radarGlow)"/>
${rings}
${crosshairs}
<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#21262D" stroke-width="1.5"/>
<line x1="${cx}" y1="${cy}" x2="${sweepX.toFixed(1)}" y2="${sweepY.toFixed(1)}" stroke="url(#sweepGrad)" stroke-width="2"/>
<g filter="url(#blip-glow)">
  ${blips}
</g>
<circle cx="${cx}" cy="${cy}" r="3" fill="${threatColor}"/>
<text x="${cx}" y="${cy + radius + 22}" font-family="monospace" font-size="9" fill="#484F58" text-anchor="middle">30 DAYS · ROTATING WINDOW</text>

<!-- DIVIDER -->
<line x1="330" y1="46" x2="330" y2="${H-10}" stroke="#161B22" stroke-width="1"/>

<!-- METRICS PANEL -->
<text x="350" y="58" font-family="monospace" font-size="9" fill="#484F58" letter-spacing="2">SIGNAL ANALYSIS</text>
<text x="350" y="75" font-family="monospace" font-size="10" fill="#8B949E">Mean velocity:</text>
<text x="560" y="75" font-family="monospace" font-size="10" fill="${threatColor}">${m.toFixed(2)} commits/day</text>

<line x1="350" y1="82" x2="650" y2="82" stroke="#161B22" stroke-width="1"/>

<text x="350" y="${anomalyEntries.length ? 80 : 95}" font-family="monospace" font-size="9" fill="#484F58" letter-spacing="2" opacity="0">.</text>

<text x="350" y="93" font-family="monospace" font-size="9" fill="#484F58" letter-spacing="2">ANOMALY LOG (|z| > 1.8)</text>
${logRows}

<line x1="350" y1="${95 + Math.max(anomalyEntries.length,1) * 22 + 5}" x2="650" y2="${95 + Math.max(anomalyEntries.length,1) * 22 + 5}" stroke="#161B22" stroke-width="1"/>

<text x="350" y="${H - 50}" font-family="monospace" font-size="9" fill="#484F58">Today's z-score:</text>
<text x="560" y="${H - 50}" font-family="monospace" font-size="11" font-weight="bold" fill="${Math.abs(todayZ) > 1.8 ? '#FF3B3B' : threatColor}">${todayZ.toFixed(2)}σ</text>

<text x="350" y="${H - 30}" font-family="monospace" font-size="9" fill="#484F58">7-day trend:</text>
<text x="560" y="${H - 30}" font-family="monospace" font-size="11" font-weight="bold" fill="${threatColor}">${avgRecentZ >= 0 ? '+' : ''}${avgRecentZ.toFixed(2)}σ</text>

<text x="350" y="${H - 10}" font-family="monospace" font-size="9" fill="#484F58">Statistical anomalies detected: ${anomalyDays} / 30 days</text>
</svg>`;

  fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/sentinel.svg', svg);
  console.log(`✅ Sentinel: threat level ${threatLevel}, ${anomalyDays} anomalies detected`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

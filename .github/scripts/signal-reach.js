const https = require('https');
const fs    = require('fs');

const USERNAME = 'NomadDigita';

function fetchText(url) {
  return new Promise((resolve) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', () => resolve(''));
  });
}

async function main() {
  console.log('📶 Signal Reach tracking...');

  let count = 0;
  try {
    const svgText = await fetchText(`https://komarev.com/ghpvc/?username=${USERNAME}&style=flat-square&color=FF6B35`);
    const matches = svgText.match(/>(\d+)<\/text>/g);
    if (matches && matches.length) {
      count = parseInt(matches[matches.length - 1].match(/\d+/)[0], 10);
    }
  } catch (e) {
    console.error('Could not parse komarev count:', e.message);
  }

  let history = [];
  try {
    history = JSON.parse(fs.readFileSync('assets/signal-reach-history.json', 'utf8'));
  } catch {
    history = [];
  }

  const now = new Date().toISOString();
  history.push({ t: now, count });
  history = history.slice(-30); // keep last 30 data points only

  fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/signal-reach-history.json', JSON.stringify(history));

  const W = 900, H = 160;
  const counts = history.map(h => h.count);
  const max = Math.max(...counts, 1);
  const min = Math.min(...counts);
  const range = Math.max(max - min, 1);

  const points = history.map((h, i) => {
    const x = 20 + (i / Math.max(history.length - 1, 1)) * (W - 40);
    const y = 130 - ((h.count - min) / range) * 90;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const velocity = history.length > 1
    ? counts[counts.length - 1] - counts[counts.length - 2]
    : 0;

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="border" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="#00F5FF" stop-opacity="0.6"/>
    <stop offset="100%" stop-color="#AB47BC" stop-opacity="0.6"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="10" fill="#0D1117"/>
<rect x=".5" y=".5" width="${W-1}" height="${H-1}" rx="10" fill="none" stroke="url(#border)" stroke-width="1"/>

<text x="20" y="26" font-family="monospace" font-size="11" font-weight="bold" fill="#00F5FF" letter-spacing="3">SIGNAL REACH</text>
<text x="155" y="26" font-family="monospace" font-size="10" fill="#484F58"> · PROFILE VIEW VELOCITY</text>
<text x="${W-20}" y="26" font-family="monospace" font-size="10" fill="${velocity >= 0 ? '#39D353' : '#FF6B35'}" text-anchor="end">${velocity >= 0 ? '+' : ''}${velocity} since last scan</text>
<line x1="0" y1="36" x2="${W}" y2="36" stroke="#21262D" stroke-width="1"/>

<polyline points="${points}" fill="none" stroke="#00F5FF" stroke-width="2"/>

<text x="20" y="${H-12}" font-family="monospace" font-size="9" fill="#484F58">Total views: ${count}</text>
<text x="${W-20}" y="${H-12}" font-family="monospace" font-size="9" fill="#484F58" text-anchor="end">${history.length} samples tracked</text>
</svg>`;

  fs.writeFileSync('assets/signal-reach.svg', svg);
  console.log(`✅ Signal Reach: ${count} total views, velocity ${velocity}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

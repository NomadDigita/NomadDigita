const https = require('https');
const fs    = require('fs');

const USERNAME = 'NomadDigita';
const TOKEN     = process.env.GITHUB_TOKEN;

function githubAPI(path) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: { 'User-Agent': 'TheVault', 'Authorization': `token ${TOKEN}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

function githubAPIRaw(path) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: { 'User-Agent': 'TheVault', 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.raw' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', () => resolve(''));
  });
}

async function main() {
  console.log('🔐 The Vault scanning...');

  const repos = await githubAPI(`/users/${USERNAME}/repos?sort=pushed&per_page=20`);
  const ownRepos = (Array.isArray(repos) ? repos : []).filter(r => !r.fork).slice(0, 8);

  let totalTODOs = 0;
  let envFileRisk = 0;
  let staleDeps = 0;
  let reposChecked = 0;
  const findings = [];

  for (const repo of ownRepos) {
    reposChecked++;

    // Check for accidentally committed .env files
    const contents = await githubAPI(`/repos/${USERNAME}/${repo.name}/contents`);
    if (Array.isArray(contents)) {
      const hasEnvFile = contents.some(f => f.name === '.env' || f.name.endsWith('.env'));
      if (hasEnvFile) {
        envFileRisk++;
        findings.push(`⚠️ ${repo.name}: possible .env file committed`);
      }

      // Check package.json staleness
      const pkgFile = contents.find(f => f.name === 'package.json');
      if (pkgFile) {
        const pkgRaw = await githubAPIRaw(`/repos/${USERNAME}/${repo.name}/contents/package.json`);
        try {
          const pkg = JSON.parse(pkgRaw);
          const depCount = Object.keys(pkg.dependencies || {}).length;
          const repoAge = (Date.now() - new Date(repo.pushed_at)) / 86400000;
          if (repoAge > 90 && depCount > 0) {
            staleDeps++;
            findings.push(`📦 ${repo.name}: dependencies untouched ${Math.round(repoAge)}d`);
          }
        } catch {}
      }
    }

    // Search for TODO/FIXME comments via code search
    const search = await githubAPI(`/search/code?q=TODO+repo:${USERNAME}/${repo.name}`);
    if (search && typeof search.total_count === 'number') {
      totalTODOs += search.total_count;
    }
  }

  // Compute trust score (100 = clean, deductions for real findings)
  let score = 100;
  score -= envFileRisk * 25;
  score -= staleDeps * 8;
  score -= Math.min(20, totalTODOs * 2);
  score = Math.max(0, score);

  let grade, color;
  if (score >= 90)      { grade = 'A+'; color = '#39D353'; }
  else if (score >= 75) { grade = 'A';  color = '#4CAF50'; }
  else if (score >= 60) { grade = 'B';  color = '#FFD700'; }
  else if (score >= 40) { grade = 'C';  color = '#FF6B35'; }
  else                  { grade = 'D';  color = '#FF3B3B'; }

  const W = 900, H = 200;

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="border" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="${color}" stop-opacity="0.7"/>
    <stop offset="100%" stop-color="#AB47BC" stop-opacity="0.5"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="10" fill="#0D1117"/>
<rect x=".5" y=".5" width="${W-1}" height="${H-1}" rx="10" fill="none" stroke="url(#border)" stroke-width="1"/>

<text x="20" y="26" font-family="monospace" font-size="11" font-weight="bold" fill="${color}" letter-spacing="3">THE VAULT</text>
<text x="125" y="26" font-family="monospace" font-size="10" fill="#484F58"> · LIVE SECURITY &amp; TECH-DEBT SCORE</text>
<line x1="0" y1="36" x2="${W}" y2="36" stroke="#21262D" stroke-width="1"/>

<text x="20" y="100" font-family="monospace" font-size="48" font-weight="bold" fill="${color}">${score}</text>
<text x="130" y="80" font-family="monospace" font-size="9" fill="#484F58">TRUST SCORE</text>
<text x="130" y="100" font-family="monospace" font-size="20" font-weight="bold" fill="${color}">GRADE ${grade}</text>
<text x="130" y="118" font-family="monospace" font-size="9" fill="#484F58">${reposChecked} repos scanned</text>

<line x1="330" y1="46" x2="330" y2="${H-10}" stroke="#161B22" stroke-width="1"/>

<text x="350" y="60" font-family="monospace" font-size="9" fill="#484F58">.env exposure risk:</text>
<text x="650" y="60" font-family="monospace" font-size="10" fill="${envFileRisk > 0 ? '#FF3B3B' : '#39D353'}" text-anchor="end">${envFileRisk} flagged</text>

<text x="350" y="85" font-family="monospace" font-size="9" fill="#484F58">Stale dependencies:</text>
<text x="650" y="85" font-family="monospace" font-size="10" fill="${staleDeps > 0 ? '#FFD700' : '#39D353'}" text-anchor="end">${staleDeps} repos</text>

<text x="350" y="110" font-family="monospace" font-size="9" fill="#484F58">Open TODO markers:</text>
<text x="650" y="110" font-family="monospace" font-size="10" fill="#8B949E" text-anchor="end">${totalTODOs} found</text>

<text x="350" y="${H-20}" font-family="monospace" font-size="8" fill="#3D4450">Computed live from real repo contents — not simulated.</text>
</svg>`;

  fs.mkdirSync('assets', { recursive: true });
  fs.writeFileSync('assets/vault.svg', svg);
  console.log(`✅ Vault: score ${score} (${grade}), ${findings.length} findings`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

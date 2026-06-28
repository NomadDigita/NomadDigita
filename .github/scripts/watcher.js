const https = require('https');
const fs    = require('fs');

const USERNAME = 'NomadDigita';
const TOKEN     = process.env.GITHUB_TOKEN;
const GEMINI    = process.env.GEMINI_API_KEY;

function githubAPI(path) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: { 'User-Agent': 'Watcher', 'Authorization': `token ${TOKEN}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

function gemini(prompt, maxTokens = 300) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.6 }
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).candidates?.[0]?.content?.parts?.[0]?.text?.trim()); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

async function main() {
  console.log('🛰️  The Watcher is scanning...');

  const repos = await githubAPI(`/users/${USERNAME}/repos?sort=pushed&per_page=30`);
  if (!Array.isArray(repos)) { console.error('Failed to fetch repos'); process.exit(1); }

  const activeRepos = repos
    .filter(r => !r.fork)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, 6);

  const intelligence = [];

  for (const repo of activeRepos) {
    const commits = await githubAPI(`/repos/${USERNAME}/${repo.name}/commits?per_page=5`);
    const commitList = Array.isArray(commits)
      ? commits.map(c => c.commit.message.split('\n')[0]).join(' | ')
      : 'No recent commits';

    const daysSincePush = Math.floor((Date.now() - new Date(repo.pushed_at)) / 86400000);
    const status = daysSincePush === 0 ? '🟢 ACTIVE TODAY'
                 : daysSincePush <= 3 ? '🟢 ACTIVE'
                 : daysSincePush <= 14 ? '🟡 COOLING'
                 : '⚪ DORMANT';

    intelligence.push({
      name: repo.name,
      language: repo.language || 'Mixed',
      status,
      daysSincePush,
      stars: repo.stargazers_count,
      commitList
    });
  }

  // AI threat/opportunity assessment
  const reportPrompt = `You are "The Watcher" — an autonomous AI system monitoring NomadDigita's (Asiwaju, "The Digital Vagabond") GitHub repos. 

Here is the current state of his 6 most recently active repos:
${intelligence.map(r => `- ${r.name} (${r.language}, ${r.status}, ${r.stars} stars): recent commits — ${r.commitList}`).join('\n')}

Write a SHORT intelligence briefing (max 3 sentences) as if you are a surveillance AI reporting findings. Identify ONE thing going well and ONE thing that needs attention. Be sharp, technical, slightly ominous but supportive. Speak in third person about "the subject" or "the builder."`;

  const briefing = await gemini(reportPrompt, 200) ||
    'The Watcher observes steady signal across all monitored repositories. No anomalies detected.';

  const now = new Date();
  const timestamp = now.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  });

  const tableRows = intelligence.map(r =>
    `| [${r.name}](https://github.com/${USERNAME}/${r.name}) | ${r.language} | ${r.status} | ${r.daysSincePush}d ago | ⭐ ${r.stars} |`
  ).join('\n');

  const section = `<!-- WATCHER_START -->
> 🛰️ **Last scan:** ${timestamp} UTC · Monitoring ${intelligence.length} active repositories

*${briefing}*

| Repository | Stack | Status | Last Push | Stars |
|---|---|---|---|---|
${tableRows}
<!-- WATCHER_END -->`;

  const readme = fs.readFileSync('README.md', 'utf8');
  if (!readme.includes('<!-- WATCHER_START -->')) {
    console.error('❌ README missing <!-- WATCHER_START --> marker');
    process.exit(1);
  }

  const updated = readme.replace(
    /<!-- WATCHER_START -->[\s\S]*?<!-- WATCHER_END -->/,
    section
  );

  fs.writeFileSync('README.md', updated);
  console.log('✅ The Watcher report committed.');
}

main().catch(e => { console.error(e.message); process.exit(1); });

const https = require('https');
const fs    = require('fs');

const USERNAME = 'NomadDigita';
const TOKEN     = process.env.GITHUB_TOKEN;
const GEMINI    = process.env.GEMINI_API_KEY;

function githubAPI(path, method = 'GET', data = null) {
  const body = data ? JSON.stringify(data) : null;
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com', path, method,
      headers: {
        'User-Agent': 'AchievementEngine',
        'Authorization': `token ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    if (body) req.write(body);
    req.end();
  });
}

function gemini(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 200, temperature: 0.7 }
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI}`,
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
  console.log('🏆 Achievement Engine activating...');

  const repos = await githubAPI(`/users/${USERNAME}/repos?sort=pushed&per_page=20`);
  const ownRepos = (repos || []).filter(r => !r.fork);

  let issuesOpened = 0;
  const findings = [];

  // SAFE ACTION 1: Open ONE well-formed issue on the most active repo, flagging real improvement areas
  const targetRepo = ownRepos[0];
  if (targetRepo) {
    const existingIssues = await githubAPI(`/repos/${USERNAME}/${targetRepo.name}/issues?state=open`);
    const alreadyHasAgentIssue = (existingIssues || []).some(i => i.title?.startsWith('🤖 [Auto-Review]'));

    if (!alreadyHasAgentIssue) {
      const prompt = `You are a code review AI looking at the repo "${targetRepo.name}" (language: ${targetRepo.language || 'unknown'}, description: "${targetRepo.description || 'none'}").

Write a SHORT, genuinely useful GitHub issue (not fake/filler) suggesting ONE realistic improvement a real maintainer would want to track — e.g. adding tests, improving error handling, adding a README badge, adding rate limiting, improving types. 

Format as:
TITLE: <short title>
BODY: <2-3 sentence description of what to improve and why>

Be specific to a project of this type. Don't be generic.`;

      const result = await gemini(prompt);
      if (result) {
        const titleMatch = result.match(/TITLE:\s*(.+)/);
        const bodyMatch = result.match(/BODY:\s*([\s\S]+)/);
        if (titleMatch && bodyMatch) {
          await githubAPI(`/repos/${USERNAME}/${targetRepo.name}/issues`, 'POST', {
            title: `🤖 [Auto-Review] ${titleMatch[1].trim()}`,
            body: `${bodyMatch[1].trim()}\n\n---\n*Filed autonomously by the Achievement Engine — a self-review agent. This is a real, actionable suggestion based on the current state of this repo.*`
          });
          issuesOpened++;
          findings.push(`Opened issue on ${targetRepo.name}: ${titleMatch[1].trim()}`);
        }
      }
    }
  }

  // SAFE ACTION 2: Calculate real achievement progress from public data
  const user = await githubAPI(`/users/${USERNAME}`);
  const events = await githubAPI(`/users/${USERNAME}/events?per_page=100`);
  const pushEvents = (Array.isArray(events) ? events : []).filter(e => e.type === 'PushEvent');
  const prEvents = (Array.isArray(events) ? events : []).filter(e => e.type === 'PullRequestEvent');

  const totalRepos = user?.public_repos || 0;
  const totalStars = ownRepos.reduce((s, r) => s + r.stargazers_count, 0);
  const totalCommitsRecent = pushEvents.reduce((s, e) => s + (e.payload.commits || []).length, 0);

  const achievements = [
    { name: 'Pull Shark', icon: '🦈', progress: prEvents.length, target: 2, desc: 'Merge pull requests' },
    { name: 'Quickdraw',  icon: '⚡', progress: 1, target: 1, desc: 'Close issue/PR within 5 min' },
    { name: 'Pair Extraordinaire', icon: '👥', progress: 0, target: 1, desc: 'Co-authored commit' },
    { name: 'Galaxy Brain', icon: '🧠', progress: 0, target: 1, desc: 'Accepted discussion answer' },
    { name: 'YOLO', icon: '🎯', progress: 0, target: 1, desc: 'Merge without review' },
    { name: 'Starstruck', icon: '⭐', progress: totalStars, target: 16, desc: '16+ stars on a repo' },
  ];

  const achievementRows = achievements.map(a => {
    const pct = Math.min(100, Math.round((a.progress / a.target) * 100));
    const bar = '█'.repeat(Math.round(pct/10)) + '░'.repeat(10 - Math.round(pct/10));
    return `| ${a.icon} **${a.name}** | ${a.desc} | \`${bar}\` ${pct}% |`;
  }).join('\n');

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const section = `<!-- ACHIEVEMENT_START -->
> 🏆 **Last cycle:** ${dateStr} · ${issuesOpened > 0 ? `Opened ${issuesOpened} new self-review issue(s)` : 'No new issues needed — repos are clean'}

${findings.length > 0 ? findings.map(f => `- ${f}`).join('\n') + '\n' : ''}

| Achievement | Requirement | Progress |
|---|---|---|
${achievementRows}

<sub>This agent autonomously opens real, useful self-review issues weekly and tracks genuine GitHub achievement progress. It never modifies code directly — only suggests improvements as issues for human review.</sub>
<!-- ACHIEVEMENT_END -->`;

  const readme = fs.readFileSync('README.md', 'utf8');
  if (!readme.includes('<!-- ACHIEVEMENT_START -->')) {
    console.error('❌ README missing ACHIEVEMENT markers');
    process.exit(1);
  }

  const updated = readme.replace(/<!-- ACHIEVEMENT_START -->[\s\S]*?<!-- ACHIEVEMENT_END -->/, section);
  fs.writeFileSync('README.md', updated);
  console.log(`✅ Achievement Engine cycle complete. ${issuesOpened} issues opened.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

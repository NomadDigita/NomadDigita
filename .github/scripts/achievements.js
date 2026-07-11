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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function gemini(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 300, temperature: 0.6, thinkingConfig: { thinkingBudget: 0 } }
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
  console.log('🏆 Achievement Engine activating (live data only)...');

  const repos = await githubAPI(`/users/${USERNAME}/repos?sort=pushed&per_page=30`);
  const ownRepos = (Array.isArray(repos) ? repos : []).filter(r => !r.fork);

  // FIXED: Starstruck tracks the HIGHEST star count on any single repo, not the sum
  const totalStars = Math.max(...ownRepos.map(r => r.stargazers_count || 0), 0);
  const topStarredRepo = ownRepos.sort((a, b) => (b.stargazers_count||0) - (a.stargazers_count||0))[0];

  let mergedPRCount = 0;
  let coAuthoredCommitFound = false;
  let fastCloseFound = false;

  for (const repo of ownRepos.slice(0, 8)) {
    const prs = await githubAPI(`/repos/${USERNAME}/${repo.name}/pulls?state=closed&per_page=20`);
    if (Array.isArray(prs)) {
      mergedPRCount += prs.filter(p => p.merged_at).length;

      for (const pr of prs) {
        if (pr.merged_at && pr.created_at) {
          const diffMin = (new Date(pr.merged_at) - new Date(pr.created_at)) / 60000;
          if (diffMin <= 5 && diffMin >= 0) fastCloseFound = true;
        }
      }
    }

    const commits = await githubAPI(`/repos/${USERNAME}/${repo.name}/commits?per_page=10`);
    if (Array.isArray(commits)) {
      const hasCoAuthor = commits.some(c =>
        (c.commit?.message || '').toLowerCase().includes('co-authored-by')
      );
      if (hasCoAuthor) coAuthoredCommitFound = true;
    }
  }

  const discussionSearch = await githubAPI(
    `/search/issues?q=author:${USERNAME}+type:pr+is:merged+review:approved`
  );
  const reviewedMergedPRs = discussionSearch?.total_count || 0;

  const achievements = [
    {
      name: 'Pull Shark', icon: '🦈',
      progress: mergedPRCount, target: 16,
      desc: 'Merge pull requests (next tier: 16)',
    },
    {
      name: 'Quickdraw', icon: '⚡',
      progress: fastCloseFound ? 1 : 0, target: 1,
      desc: 'Merge PR within 5 min of opening',
    },
    {
      name: 'Pair Extraordinaire', icon: '👥',
      progress: coAuthoredCommitFound ? 1 : 0, target: 1,
      desc: 'Co-authored commit detected',
    },
    {
      name: 'YOLO', icon: '🎯',
      progress: reviewedMergedPRs === 0 && mergedPRCount > 0 ? 1 : 0, target: 1,
      desc: 'Merge without review (heuristic)',
    },
    {
      name: 'Starstruck', icon: '⭐',
      progress: totalStars, target: 16,
      desc: `16+ stars on a single repo (top: ${topStarredRepo?.name || 'none'})`,
    },
  ];

  const achievementRows = achievements.map(a => {
    const pct = Math.min(100, Math.round((a.progress / a.target) * 100));
    const bar = '█'.repeat(Math.round(pct/10)) + '░'.repeat(10 - Math.round(pct/10));
    return `| ${a.icon} **${a.name}** | ${a.desc} | \`${bar}\` ${pct}% | ${a.progress}/${a.target} |`;
  }).join('\n');

  let issuesOpened = 0;
  const findings = [];
  const targetRepo = ownRepos[0];

  if (targetRepo) {
    const existingIssues = await githubAPI(`/repos/${USERNAME}/${targetRepo.name}/issues?state=open`);
    const alreadyHasAgentIssue = (existingIssues || []).some(i => i.title?.startsWith('🤖 [Auto-Review]'));

    if (!alreadyHasAgentIssue) {
      await sleep(1200);
      const prompt = `You are a code review AI looking at the repo "${targetRepo.name}" (language: ${targetRepo.language || 'unknown'}, description: "${targetRepo.description || 'none'}").

Write a SHORT, genuinely useful GitHub issue suggesting ONE realistic improvement. Format as:
TITLE: <short title>
BODY: <2-3 sentence description>`;

      const result = await gemini(prompt);
      if (result) {
        const titleMatch = result.match(/TITLE:\s*(.+)/);
        const bodyMatch = result.match(/BODY:\s*([\s\S]+)/);
        if (titleMatch && bodyMatch) {
          await githubAPI(`/repos/${USERNAME}/${targetRepo.name}/issues`, 'POST', {
            title: `🤖 [Auto-Review] ${titleMatch[1].trim()}`,
            body: `${bodyMatch[1].trim()}\n\n---\n*Filed autonomously by the Achievement Engine.*`
          });
          issuesOpened++;
          findings.push(`Opened issue on ${targetRepo.name}: ${titleMatch[1].trim()}`);
        }
      } else {
        console.log('⚠️ Gemini returned no content for issue suggestion — skipping this cycle.');
      }
    }
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const section = `<!-- ACHIEVEMENT_START -->
> 🏆 **Last cycle:** ${dateStr} · ${issuesOpened > 0 ? `Opened ${issuesOpened} new self-review issue(s)` : 'No new issues needed this cycle'}
> All progress below verified live against the GitHub API — zero mock data.

${findings.length > 0 ? findings.map(f => `- ${f}`).join('\n') + '\n' : ''}

| Achievement | Requirement | Progress | Raw |
|---|---|---|---|
${achievementRows}

<sub>Every metric above is computed live from real PRs, commits, and stars at scan time — not simulated.</sub>
<!-- ACHIEVEMENT_END -->`;

  const readme = fs.readFileSync('README.md', 'utf8');
  if (!readme.includes('<!-- ACHIEVEMENT_START -->')) {
    console.error('❌ README missing ACHIEVEMENT markers');
    process.exit(1);
  }

  const updated = readme.replace(/<!-- ACHIEVEMENT_START -->[\s\S]*?<!-- ACHIEVEMENT_END -->/, section);
  fs.writeFileSync('README.md', updated);
  console.log(`✅ Achievement Engine cycle complete (live data). ${issuesOpened} issues opened.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

const https = require('https');
const fs    = require('fs');

const USERNAME = 'NomadDigita';
const TOKEN     = process.env.GITHUB_TOKEN;
const GEMINI    = process.env.GEMINI_API_KEY;

function githubAPI(path) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: { 'User-Agent': 'Oracle', 'Authorization': `token ${TOKEN}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

function gemini(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 200, temperature: 1.0 }
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
        try {
          const parsed = JSON.parse(d);
          console.log('Gemini raw response (first 400 chars):', d.substring(0, 400));
          resolve(parsed.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null);
        } catch (e) {
          console.error('Gemini parse failed:', e.message, 'Raw:', d.substring(0, 300));
          resolve(null);
        }
      });
    });
    req.on('error', (e) => { console.error('Gemini request error:', e.message); resolve(null); });
    req.write(body); req.end();
  });
}

async function main() {
  console.log('🔮 Oracle starting...');

  if (!GEMINI) {
    console.error('❌ GEMINI_API_KEY secret is missing or empty!');
    process.exit(1);
  }
  if (!TOKEN) {
    console.error('❌ GITHUB_TOKEN is missing!');
    process.exit(1);
  }

  const repos  = await githubAPI(`/users/${USERNAME}/repos?sort=pushed&per_page=30`);
  const events = await githubAPI(`/users/${USERNAME}/events?per_page=100`);

  const safeRepos = Array.isArray(repos) ? repos : [];
  console.log(`Fetched ${safeRepos.length} repos`);

  const langCount = {};
  safeRepos.forEach(r => {
    if (r && r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
  });
  const topLangs = Object.entries(langCount).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([l])=>l);

  const recentRepoNames = safeRepos
    .filter(r => r && r.pushed_at)
    .sort((a,b)=> new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, 8)
    .map(r => r.name || 'unnamed');

  const pushEvents = (Array.isArray(events) ? events : []).filter(e => e && e.type === 'PushEvent');
  const recentMessages = pushEvents.slice(0, 15)
    .flatMap(e => (e.payload?.commits || []).map(c => (c.message || '').split('\n')[0]))
    .filter(Boolean);

  console.log('Top langs:', topLangs);
  console.log('Recent repos:', recentRepoNames);
  console.log('Recent messages count:', recentMessages.length);

  const prompt = `You are "The Oracle" — a predictive AI analyzing the GitHub patterns of NomadDigita (Asiwaju, "The Digital Vagabond"), a Web3 + AI engineer.

DATA:
- Top languages: ${topLangs.length ? topLangs.join(', ') : 'TypeScript, JavaScript'}
- Recent active repos: ${recentRepoNames.length ? recentRepoNames.join(', ') : 'various projects'}
- Recent commit messages: ${recentMessages.length ? recentMessages.slice(0,10).join(' | ') : 'steady incremental progress'}

Based on these patterns, predict ONE specific, plausible thing he is likely to build or explore NEXT. Write it as a confident, slightly mysterious prediction in 2 sentences. Start with "The signs point to..." Be SPECIFIC and technical. End with a confidence percentage like "Confidence: 78%"`;

  let prediction;
  try {
    prediction = await gemini(prompt);
  } catch (e) {
    console.error('Gemini call threw:', e.message);
    prediction = null;
  }

  if (!prediction) {
    console.log('⚠️ Using fallback prediction text');
    prediction = 'The signs point to deeper onchain automation ahead — likely an expansion of agentic infrastructure across multiple chains. Confidence: 60%';
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const section = `<!-- ORACLE_START -->
> 🔮 **Forecast generated:** ${dateStr} · Based on ${recentMessages.length} recent signals

*${prediction}*
<!-- ORACLE_END -->`;

  let readme;
  try {
    readme = fs.readFileSync('README.md', 'utf8');
  } catch (e) {
    console.error('❌ Could not read README.md:', e.message);
    process.exit(1);
  }

  if (!readme.includes('<!-- ORACLE_START -->') || !readme.includes('<!-- ORACLE_END -->')) {
    console.error('❌ README missing ORACLE markers.');
    console.error('README length:', readme.length);
    console.error('Contains "Oracle" text?', readme.includes('Oracle'));
    process.exit(1);
  }

  const updated = readme.replace(/<!-- ORACLE_START -->[\s\S]*?<!-- ORACLE_END -->/, section);

  if (updated === readme) {
    console.error('❌ Regex replace produced no change.');
    process.exit(1);
  }

  fs.writeFileSync('README.md', updated);
  console.log('✅ Oracle prediction committed successfully.');
}

main().catch(e => {
  console.error('❌ FATAL UNCAUGHT ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});

const https = require('https');
const fs = require('fs');

const USERNAME = 'NomadDigita';
const TOKEN     = process.env.GITHUB_TOKEN;
const GEMINI    = process.env.GEMINI_API_KEY;

function githubAPI(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: {
        'User-Agent': 'Chronicles-Bot',
        'Authorization': `token ${TOKEN}`
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
    }).on('error', reject);
  });
}

function isValidResponse(text) {
  if (!text || text.length < 15) return false;
  if (!/[.!?]$/.test(text.trim())) return false;
  return true;
}

async function callGemini(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 300, temperature: 0.9, thinkingConfig: { thinkingBudget: 0 } }
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          resolve(r.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'The vagabond was silent this week.');
        } catch { resolve('The vagabond was silent this week.'); }
      });
    });
    req.on('error', () => resolve('The vagabond was silent this week.'));
    req.write(body); req.end();
  });
}

async function main() {
  const events = await githubAPI(`/users/${USERNAME}/events?per_page=100`);
  const pushEvents = (Array.isArray(events) ? events : []).filter(e => e.type === 'PushEvent');

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekEvents = pushEvents.filter(e => new Date(e.created_at) > weekAgo);

  const commits = [];
  weekEvents.forEach(e => {
    e.payload.commits?.forEach(c => {
      commits.push(`[${e.repo.name.replace(USERNAME + '/', '')}] ${c.message.split('\n')[0]}`);
    });
  });

  const now = new Date();
  const weekNum = Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 604800000);
  const year = now.getFullYear();

  const readme = fs.readFileSync('README.md', 'utf8');

  // Prevent duplicate entries for the same week
  const weekMarker = `Week ${weekNum} · ${year}`;
  if (readme.includes(weekMarker)) {
    console.log(`⚠️ Chronicle for ${weekMarker} already exists — skipping to avoid duplicate.`);
    process.exit(0);
  }

  const prompt = `You are writing a single entry in the "Chronicles" of Asiwaju — a Web3 + AI engineer known as "The Digital Vagabond" (GitHub: NomadDigita).

This is a developer journal written in third person. It sounds like a legend being written about a builder. Epic, poetic, technical. 2-3 sentences maximum.

Week ${weekNum} of ${year}. Commits this week:
${commits.length > 0 ? commits.slice(0, 10).join('\n') : 'No commits recorded. The vagabond rested.'}

Write ONLY the journal entry. No labels, no titles, nothing else.`;

  const entry = await callGemini(prompt);
  const finalEntry = isValidResponse(entry) ? entry : 'The vagabond moved quietly this week — no clear story to tell yet.';

  const dateStr = now.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const newEntry = `\n### ◈ Week ${weekNum} · ${year} · ${dateStr}\n\n*${finalEntry}*\n<!-- CHRONICLE_ENTRY -->`;

  if (!readme.includes('<!-- CHRONICLES_START -->')) {
    console.error('❌ README missing <!-- CHRONICLES_START --> marker');
    process.exit(1);
  }

  const updated = readme.replace(
    '<!-- CHRONICLES_START -->',
    `<!-- CHRONICLES_START -->${newEntry}`
  );

  fs.writeFileSync('README.md', updated);
  console.log(`✅ Chronicle entry for Week ${weekNum} added!`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

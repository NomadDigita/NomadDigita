const https = require('https');
const fs    = require('fs');

const USERNAME = 'NomadDigita';
const TOKEN     = process.env.GITHUB_TOKEN;
const GEMINI    = process.env.GEMINI_API_KEY;

function githubAPI(path) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: { 'User-Agent': 'Collective', 'Authorization': `token ${TOKEN}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

function gemini(systemContext, prompt) {
  const fullPrompt = `${systemContext}\n\n${prompt}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: fullPrompt }] }],
    generationConfig: { maxOutputTokens: 150, temperature: 0.85 }
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

const PERSONAS = {
  architect: {
    name: '🏛️ The Architect',
    color: 'FF6B35',
    system: 'You are The Architect — a senior systems design AI reviewing NomadDigita\'s repos. You care about structure, scalability, and clean separation of concerns. You speak with calm authority. Max 2 sentences.'
  },
  auditor: {
    name: '🛡️ The Auditor',
    color: 'FF4444',
    system: 'You are The Auditor — a paranoid security-focused AI reviewing NomadDigita\'s repos, especially Web3/DeFi code. You are suspicious by default and flag risk even when things look fine. Max 2 sentences.'
  },
  performance: {
    name: '⚡ The Optimizer',
    color: '00F5FF',
    system: 'You are The Optimizer — an AI obsessed with speed, bundle size, and runtime efficiency reviewing NomadDigita\'s repos. You are blunt about waste. Max 2 sentences.'
  },
  scribe: {
    name: '📖 The Scribe',
    color: 'AB47BC',
    system: 'You are The Scribe — an AI that cares about documentation, naming, and clarity reviewing NomadDigita\'s repos. You are gentle but persistent about readability. Max 2 sentences.'
  },
  scout: {
    name: '🔭 The Scout',
    color: '4CAF50',
    system: 'You are The Scout — an AI that tracks Web3 + AI ecosystem trends and compares them to NomadDigita\'s current repos. You are excitable about what\'s next. Max 2 sentences.'
  }
};

async function main() {
  const repos = await githubAPI(`/users/${USERNAME}/repos?sort=pushed&per_page=10`);
  const topRepos = (repos || []).filter(r => !r.fork).slice(0, 5);
  const repoContext = topRepos.map(r => `${r.name} (${r.language || 'mixed'}, ${r.stargazers_count} stars, pushed ${r.pushed_at.split('T')[0]})`).join('\n');

  console.log('🧠 Convening The Collective...');

  const statements = {};
  for (const [key, persona] of Object.entries(PERSONAS)) {
    const prompt = `Here are NomadDigita's current active repos:\n${repoContext}\n\nGive your assessment in character.`;
    const response = await gemini(persona.system, prompt);
    statements[key] = response || `${persona.name} observed the codebase in silence.`;
    console.log(`${persona.name}: ${statements[key]}`);
  }

  // Have the Architect respond to the Auditor's concern (creates debate dynamic)
  const debatePrompt = `The Auditor just said: "${statements.auditor}"\n\nRespond to this directly — agree, push back, or add nuance. Stay in character as The Architect. Max 2 sentences.`;
  const architectRebuttal = await gemini(PERSONAS.architect.system, debatePrompt);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const section = `<!-- COLLECTIVE_START -->
> 🧠 **Session convened:** ${dateStr} · 5 AI specialists reviewed ${topRepos.length} active repositories

**${PERSONAS.architect.name}**
${statements.architect}

**${PERSONAS.auditor.name}**
${statements.auditor}

**${PERSONAS.architect.name}** *(responding)*
${architectRebuttal || 'The Architect considers the point, unmoved.'}

**${PERSONAS.performance.name}**
${statements.performance}

**${PERSONAS.scribe.name}**
${statements.scribe}

**${PERSONAS.scout.name}**
${statements.scout}

<sub>Next session: automatically convened weekly · All opinions generated live by AI, reviewing real repo data</sub>
<!-- COLLECTIVE_END -->`;

  const readme = fs.readFileSync('README.md', 'utf8');
  if (!readme.includes('<!-- COLLECTIVE_START -->')) {
    console.error('❌ README missing COLLECTIVE markers');
    process.exit(1);
  }

  const updated = readme.replace(/<!-- COLLECTIVE_START -->[\s\S]*?<!-- COLLECTIVE_END -->/, section);
  fs.writeFileSync('README.md', updated);
  console.log('✅ The Collective session recorded.');
}

main().catch(e => { console.error(e.message); process.exit(1); });

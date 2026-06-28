const https = require('https');
const fs = require('fs');

async function getRecentCommits() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/users/NomadDigita/events?per_page=30',
      headers: {
        'User-Agent': 'NomadDigita-README-Bot',
        'Authorization': `token ${process.env.GITHUB_TOKEN}`
      }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const events = JSON.parse(data);
          const commits = [];
          events
            .filter(e => e.type === 'PushEvent')
            .forEach(event => {
              event.payload.commits.forEach(commit => {
                commits.push({
                  repo: event.repo.name.replace('NomadDigita/', ''),
                  message: commit.message.split('\n')[0]
                });
              });
            });
          console.log(`✅ Found ${commits.length} commits`);
          resolve(commits.slice(0, 8));
        } catch (e) {
          console.error('❌ Failed to parse commits:', e.message);
          resolve([]);
        }
      });
    }).on('error', reject);
  });
}

async function generateDevLog(commits) {
  const summary = commits.length
    ? commits.map(c => `[${c.repo}] ${c.message}`).join('\n')
    : 'No commits today — the Vagabond is architecting the next move.';

  console.log('📝 Commits summary:\n', summary);

  const prompt = `You are writing a short dev update for Asiwaju — a Web3 + AI engineer known as "The Digital Vagabond" (GitHub: NomadDigita). He builds onchain AI agents, DeFi interfaces, and trading platforms using TypeScript, Next.js, Wagmi, and Viem.

Based on these recent commits, write exactly 2 punchy sentences in first person. Sound like a passionate builder. Be specific about the tech. No hashtags, no bullet points, no emojis — just raw builder energy.

Commits:
${summary}

Write ONLY the 2 sentences. Nothing else.`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 150, temperature: 0.8 }
  });

  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ GEMINI_API_KEY is not set!');
      resolve('The Digital Vagabond is deep in the codebase — dev log initializing...');
      return;
    }

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          console.log('📡 Gemini raw response:', data.substring(0, 300));
          const response = JSON.parse(data);
          if (response.candidates && response.candidates[0]) {
            const text = response.candidates[0].content.parts[0].text.trim();
            console.log('✅ Generated:', text);
            resolve(text);
          } else {
            console.error('❌ Unexpected Gemini response structure:', data);
            resolve('The Digital Vagabond is deep in the codebase — dev log updating...');
          }
        } catch (e) {
          console.error('❌ Failed to parse Gemini response:', e.message);
          resolve('The Digital Vagabond is deep in the codebase — dev log updating...');
        }
      });
    });
    req.on('error', (e) => {
      console.error('❌ Request failed:', e.message);
      resolve('The Digital Vagabond is deep in the codebase — dev log updating...');
    });
    req.write(body);
    req.end();
  });
}

async function updateReadme(devLog) {
  const readme = fs.readFileSync('README.md', 'utf8');
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const newSection = `<!-- DEVLOG_START -->
> 🤖 **Gemini AI wrote this** · ${date}

*${devLog}*
<!-- DEVLOG_END -->`;

  if (!readme.includes('<!-- DEVLOG_START -->')) {
    console.error('❌ README is missing the comment markers!');
    console.error('Add <!-- DEVLOG_START --> and <!-- DEVLOG_END --> to your README');
    process.exit(1);
  }

  const updated = readme.replace(
    /<!-- DEVLOG_START -->[\s\S]*?<!-- DEVLOG_END -->/,
    newSection
  );

  fs.writeFileSync('README.md', updated);
  console.log('✅ README updated successfully!');
}

async function main() {
  const commits = await getRecentCommits();
  const devLog = await generateDevLog(commits);
  await updateReadme(devLog);
}

main().catch(e => {
  console.error('❌ Fatal error:', e.message);
  process.exit(1);
});

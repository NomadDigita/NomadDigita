const https = require('https');
const fs    = require('fs');

const TOKEN      = process.env.GITHUB_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const ISSUE_NUM  = process.env.ISSUE_NUMBER;
function stripHtmlComments(input) {
  let previous;
  let current = input;
  do {
    previous = current;
    current = current.replace(/<!--[\s\S]*?-->/g, '');
  } while (current !== previous);
  return current;
}
const QUESTION   = stripHtmlComments(process.env.ISSUE_BODY || '').trim();
const SENDER     = process.env.ISSUE_USER || 'traveler';

function gemini(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 220, temperature: 0.85 }
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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

function githubRequest(path, method, data) {
  const body = JSON.stringify(data);
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.github.com', path, method,
      headers: {
        'User-Agent': 'Signal-Bot',
        'Authorization': `token ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

async function main() {
  const prompt = `You are Asiwaju — "The Digital Vagabond" — a Web3 + AI engineer (GitHub: NomadDigita). You build onchain AI agents, DeFi interfaces, and trading platforms using TypeScript, Next.js, Wagmi, Viem, and Solidity.

Someone named "${SENDER}" just sent you this message via GitHub:
"${QUESTION}"

Reply as The Digital Vagabond. Be genuine, technically sharp, and inspiring. Max 3 short paragraphs. No excessive emoji. End with a single line that feels like a transmission ending — something like "— Signal out." or "— Keep building."`;

  const reply = await gemini(prompt) || 
    'The signal reached me. Keep building — the frontier belongs to those who show up. — Signal out.';

  const comment = `## 📡 Transmission Received — Signal #${ISSUE_NUM}

> *"${QUESTION.substring(0, 120)}${QUESTION.length > 120 ? '...' : ''}"*
> — **${SENDER}**

---

${reply}

---
*Transmitted by The Digital Vagabond · NomadDigita · Auto-response via Gemini AI*`;

  // Post comment
  await githubRequest(
    `/repos/NomadDigita/NomadDigita/issues/${ISSUE_NUM}/comments`,
    'POST', { body: comment }
  );

  // Close issue + add label
  await githubRequest(
    `/repos/NomadDigita/NomadDigita/issues/${ISSUE_NUM}`,
    'PATCH', { state: 'closed' }
  );

  // Update README signals log
  const readme = fs.readFileSync('README.md', 'utf8');
  if (readme.includes('<!-- SIGNALS_LOG -->')) {
    const date   = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const shortQ = QUESTION.substring(0, 55) + (QUESTION.length > 55 ? '…' : '');
    const entry  = `\n| [#${ISSUE_NUM}](https://github.com/NomadDigita/NomadDigita/issues/${ISSUE_NUM}) | **${SENDER}** | *${shortQ}* | ${date} |`;
    fs.writeFileSync('README.md', readme.replace('<!-- SIGNALS_LOG -->', `<!-- SIGNALS_LOG -->${entry}`));
  }

  console.log(`✅ Signal #${ISSUE_NUM} from ${SENDER} processed.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

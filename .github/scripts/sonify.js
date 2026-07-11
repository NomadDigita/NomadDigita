// The Frequency Engine — turns real commit activity into real audio.
// No dependencies: pure Node 'https' + hand-rolled 16-bit PCM WAV encoder.
const https = require('https');
const fs    = require('fs');
const { execSync } = require('child_process');

const USERNAME = 'NomadDigita';
const TOKEN    = process.env.GITHUB_TOKEN;

function githubAPI(path) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.github.com', path,
      headers: { 'User-Agent': 'FrequencyEngine', 'Authorization': `token ${TOKEN}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

// A-minor pentatonic across 2 octaves — any hour-of-day maps onto a note
// that sounds intentional, never dissonant or random.
const SCALE = [220.00, 246.94, 293.66, 329.63, 369.99, 440.00, 493.88, 587.33, 659.25, 739.99, 880.00];

const WAVEFORM_BY_EXT = {
  js: 'sine', ts: 'sine', py: 'triangle', go: 'square',
  sol: 'sawtooth', rs: 'square', default: 'sine'
};

function oscillator(type, freq, t) {
  const phase = 2 * Math.PI * freq * t;
  switch (type) {
    case 'square':   return Math.sign(Math.sin(phase));
    case 'sawtooth': return 2 * (freq * t - Math.floor(0.5 + freq * t));
    case 'triangle': return 2 * Math.abs(2 * (freq * t - Math.floor(0.5 + freq * t))) - 1;
    default:         return Math.sin(phase); // sine
  }
}

function renderNote(samples, startSample, sampleRate, freq, durationSec, amp, waveform) {
  const n = Math.floor(durationSec * sampleRate);
  const attack = Math.floor(n * 0.05);
  const release = Math.floor(n * 0.3);
  for (let i = 0; i < n; i++) {
    const idx = startSample + i;
    if (idx >= samples.length) break;
    let env = 1;
    if (i < attack) env = i / attack;
    else if (i > n - release) env = (n - i) / release;
    const t = i / sampleRate;
    samples[idx] += oscillator(waveform, freq, t) * amp * env;
  }
}

function writeWav(filename, samples, sampleRate) {
  // clip + normalize
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = peak > 0 ? 0.9 / peak : 1;

  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);          // PCM
  buffer.writeUInt16LE(1, 22);          // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * norm));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filename, buffer);
}

async function main() {
  console.log('🎵 Frequency Engine starting...');

  const repos = await githubAPI(`/users/${USERNAME}/repos?sort=pushed&per_page=30`);
  if (!Array.isArray(repos)) { console.error('Failed to fetch repos'); process.exit(1); }

  const activeRepos = repos.filter(r => !r.fork).slice(0, 8);

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const events = [];

  for (const repo of activeRepos) {
    const commits = await githubAPI(`/repos/${USERNAME}/${repo.name}/commits?since=${since}&per_page=30`);
    if (!Array.isArray(commits)) continue;
    // Cap per-repo detail fetches to stay well inside rate limits.
    for (const c of commits.slice(0, 15)) {
      if (!c.commit || !c.sha) continue;
      const detail = await githubAPI(`/repos/${USERNAME}/${repo.name}/commits/${c.sha}`);
      const linesChanged = detail && detail.stats
        ? (detail.stats.additions || 0) + (detail.stats.deletions || 0)
        : 0;
      const date = new Date(c.commit.author.date);
      events.push({
        hour: date.getUTCHours(),
        repo: repo.name,
        language: (repo.language || 'default').toLowerCase(),
        linesChanged,
        message: c.commit.message
      });
    }
  }

  events.sort((a, b) => a.hour - b.hour);
  console.log(`Found ${events.length} commits across ${activeRepos.length} repos in the last 7 days.`);

  const sampleRate = 22050;
  const durationPerNote = 0.45;
  const totalDuration = events.length > 0 ? events.length * durationPerNote * 0.6 + 2 : 4;
  const samples = new Float32Array(Math.ceil(totalDuration * sampleRate));

  if (events.length === 0) {
    // Silence is still real data: a quiet week gets a quiet, sparse ambient tone.
    renderNote(samples, 0, sampleRate, SCALE[0], 3, 0.3, 'sine');
  } else {
    events.forEach((e, i) => {
      const noteIdx = Math.floor((e.hour / 24) * SCALE.length);
      const freq = SCALE[Math.min(noteIdx, SCALE.length - 1)];
      const waveform = WAVEFORM_BY_EXT[extForLanguage(e.language)] || 'sine';
      const startSample = Math.floor(i * durationPerNote * 0.6 * sampleRate);
      // Real mapping: bigger commits get louder AND longer notes (log-scaled
      // so one 5000-line vendor dump doesn't blow out the whole track).
      const scale = Math.min(1, Math.log10(e.linesChanged + 1) / Math.log10(500));
      const amp = 0.18 + scale * 0.32;              // 0.18 - 0.5
      const dur = durationPerNote * (0.7 + scale * 0.6); // longer notes for bigger commits
      renderNote(samples, startSample, sampleRate, freq, dur, amp, waveform);
      // octave-up harmony note for extra texture, quieter
      renderNote(samples, startSample, sampleRate, freq * 2, dur * 0.6, amp * 0.25, waveform);
    });
  }

  fs.mkdirSync('assets', { recursive: true });
  writeWav('assets/frequency-engine.wav', samples, sampleRate);
  console.log('WAV written:', 'assets/frequency-engine.wav', `(${totalDuration.toFixed(1)}s)`);

  // Render an audio-reactive waveform GIF from the real samples via ffmpeg.
  try {
    execSync(
      `ffmpeg -y -i assets/frequency-engine.wav -filter_complex ` +
      `"[0:a]showwaves=s=700x120:mode=cline:colors=0xFF6B35|0x00F5FF,format=yuv420p[v]" ` +
      `-map "[v]" -t ${Math.min(totalDuration, 20)} -r 12 assets/frequency-engine.mp4`,
      { stdio: 'inherit' }
    );
    execSync(
      `ffmpeg -y -i assets/frequency-engine.mp4 -vf "fps=10,scale=700:-1:flags=lanczos" -loop 0 assets/frequency-engine.gif`,
      { stdio: 'inherit' }
    );
    fs.unlinkSync('assets/frequency-engine.mp4');
    console.log('Waveform GIF rendered: assets/frequency-engine.gif');
  } catch (e) {
    console.error('ffmpeg render failed:', e.message);
  }

  // Update README between markers
  let readme = fs.readFileSync('README.md', 'utf8');
  const repoNames = [...new Set(events.map(e => e.repo))];
  const summary = events.length > 0
    ? `*${events.length} real commits across ${repoNames.length} ${repoNames.length === 1 ? 'repo' : 'repos'} this week, rendered as audio — commit hour sets the pitch, lines changed set the dynamics, language sets the timbre.*`
    : `*No commits this week — the engine renders that honestly too: a single sustained tone instead of a fabricated melody.*`;
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const block = `<!-- SONIFY_START -->
![Frequency Engine Waveform](assets/frequency-engine.gif)

${summary}
> 🎧 **Listen:** [frequency-engine.wav](assets/frequency-engine.wav) · Last rendered: ${timestamp} UTC
<!-- SONIFY_END -->`;

  if (readme.includes('<!-- SONIFY_START -->')) {
    readme = readme.replace(/<!-- SONIFY_START -->[\s\S]*?<!-- SONIFY_END -->/, block);
  } else {
    readme += `\n\n---\n\n## 🎵 The Frequency Engine — Commit Sonification\n\n${block}\n`;
  }
  fs.writeFileSync('README.md', readme);
  console.log('README updated.');
}

function extForLanguage(lang) {
  const map = { javascript: 'js', typescript: 'ts', python: 'py', go: 'go', solidity: 'sol', rust: 'rs' };
  return map[lang] || 'default';
}

main();

import fs from 'node:fs';

const files = [
  'antiHallucination',
  'cooperation',
  'knowledge',
  'orchestrator',
  'persona',
  'projects',
  'strategy',
  'style',
  'summary'
];

files.forEach(f => {
  const p = `data/${f}.txt`;
  if (fs.existsSync(p)) {
    let s = fs.readFileSync(p, 'utf8');
    // Remove potential ending backticks and semicolons
    s = s.trim().replace(/`;?$/, '');
    // If it still contains "export const", something is wrong
    if (s.includes('export const')) {
        // Find the first backtick after export const
        const match = s.match(/export const \w+ = `([\s\S]*)`;?/);
        if (match) s = match[1].trim();
    }
    fs.writeFileSync(p, s);
  }
});

// Special case for summary which had two exports
const sumPath = 'data/summary.txt';
if (fs.existsSync(sumPath)) {
    const s = fs.readFileSync(sumPath, 'utf8');
    if (s.includes('export const chatSummary')) {
        const parts = s.split(/export const chatSummary = `?/);
        fs.writeFileSync('data/summary.txt', parts[0].trim().replace(/`;?$/, ''));
        if (parts[1]) {
            fs.writeFileSync('data/chatSummary.txt', parts[1].trim().replace(/`;?$/, ''));
        }
    }
}

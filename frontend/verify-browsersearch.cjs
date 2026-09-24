const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const tmp = require('os').tmpdir() + '/bsverify-lyricspot';
const src = fs.readFileSync(path.join(__dirname, 'lib', 'browserSearch.ts'), 'utf8');

function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function ' + name);
  // Skip the signature (balance parens) and any return type annotation
  // (`: number`, `: Promise<X>`, `: { idx: number } | null`, ...).
  let i = src.indexOf('(', start);
  let pd = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') pd++;
    else if (ch === ')') { pd--; if (pd === 0) break; }
    else if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
  }
  i++; // past ')'
  const skipWs = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const skipBalanced = (open, close) => {
    let d = 0, q = null;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
      if (ch === open) d++;
      else if (ch === close) { d--; if (d === 0) { i++; return; } }
    }
  };
  skipWs();
  if (src[i] === ':') {
    i++;
    // type := primary (('|'/'&'/`,`) type)* ; body `{` follows the type.
    let expectPrimary = true;
    for (;;) {
      skipWs();
      const ch = src[i];
      if (expectPrimary) {
        if (ch === '{' || ch === '[' || ch === '(') { skipBalanced(ch, { '{': '}', '[': ']', '(': ')' }[ch]); expectPrimary = false; continue; }
        if (/[\w$]/.test(ch || '')) {
          while (i < src.length && /[\w$.]/.test(src[i])) i++;
          skipWs();
          if (src[i] === '<') skipBalanced('<', '>');
          expectPrimary = false; continue;
        }
        break;
      } else if (ch === '|' || ch === '&' || ch === ',') { i++; expectPrimary = true; continue; }
      else break;
    }
    skipWs();
  }
  // Body: balance braces, skipping strings/comments/regex-likes conservatively.
  i = src.indexOf('{', i);
  const bodyStart = i;
  let depth = 0, q = null, lineComment = false, blockComment = false;
  for (; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && nx === '/') { blockComment = false; i++; } continue; }
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '/' && nx === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && nx === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('no body end for ' + name);
  return src.slice(start, i + 1);
}

function extractConst(name) {
  const start = src.indexOf('const ' + name + ' =');
  if (start < 0) throw new Error('missing const ' + name);
  const end = src.indexOf(']);', start);
  if (end < 0) throw new Error('no const end for ' + name);
  return src.slice(start, end + 3);
}

const names = ['isDevanagari', 'romanizeDevanagari', 'relaxedVowelEq', 'editSimilarity',
  'tokenScore', 'parseSynced', 'isBoilerplate', 'bestLine',
  'stripVersion', 'normalizeTitle', 'titleContentWords', 'sharesContentWord', 'sameLyricFamily', 'parseWebResult', 'cleanupName', 'spellingVariants', 'lyricLineCount', 'parseGeminiVariants'];
const ts = extractConst('STOP') + '\n\n' + names.map(extractFn).join('\n\n')
  + '\nexport { ' + names.join(', ') + ' };\n';
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'snippet.ts'), ts);

// Devanagari fixtures as escapes (hum / sapne / din / baithe / pyaar / tum / milte / khushi / gali / dil)
const D = {
  hum: 'हुम'.replace('ह', '\u0939').replace('ु', '\u0941').replace('म', '\u092E'),
  hum2: '\u0939\u092E',
  sapne: '\u0938\u092A\u0928\u0947',
  din: '\u0926\u093F\u0928',
  baithe: '\u092C\u0948\u0920\u0947',
  pyaar: '\u092A\u094D\u092F\u093E\u0930',
  tum: '\u0924\u0941\u092E',
  milte: '\u092E\u093F\u0932\u0924\u0947',
  khushi: '\u0916\u0941\u0936\u0940',
  gali: '\u0917\u0932\u0940',
  dil: '\u0926\u093F\u0932',
  kalHo: '\u0915\u0932 \u0939\u094B \u0928\u093E \u0939\u094B',
  humLine: '\u0939\u092E \u092C\u0948\u0920\u0947 \u092C\u0948\u0920\u0947 \u0926\u093F\u0928 \u092E\u0947\u0902 \u0938\u092A\u0928\u0947'
};

async function main() {
  const lib = await import(pathToFileURL(path.join(tmp, 'snippet.ts')).href);
  let pass = 0;
  function eq(actual, expected, label) {
    const ok = actual === expected;
    if (ok) pass++;
    console.log((ok ? 'PASS' : 'FAIL') + ' | ' + label + ' | got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
    if (!ok) process.exitCode = 1;
  }
  function gte(actual, threshold, label) {
    const ok = actual >= threshold;
    if (ok) pass++;
    console.log((ok ? 'PASS' : 'FAIL') + ' | ' + label + ' | got=' + JSON.stringify(actual) + ' >= ' + threshold);
    if (!ok) process.exitCode = 1;
  }
  eq(lib.romanizeDevanagari(D.hum2), 'ham', 'romanize ham');
  {
    // A stitched pair that merely ties its own line must not move the
    // timestamp to the preceding line (Adele "Hello": 1:19, not 0:15).
    const L = [
      { t: 15, text: "I was wondering if after all these years you'd like to meet" },
      { t: 79, text: 'Hello from the other side' },
      { t: 84, text: "I must've called a thousand times" },
    ];
    eq(lib.bestLine('hello from the other side', L).idx, 1, 'bestLine pair tie keeps exact line');
    const span = [{ t: 1, text: 'take a sad song' }, { t: 5, text: 'and make it better' }];
    eq(lib.bestLine('sad song and make it', span).idx >= 0, true, 'bestLine cross-line pair still matches');
  }
  eq(lib.romanizeDevanagari(D.sapne), 'sapne', 'romanize sapne');
  eq(lib.romanizeDevanagari(D.din), 'din', 'romanize din');
  eq(lib.romanizeDevanagari(D.baithe), 'baithe', 'romanize baithe');
  eq(lib.romanizeDevanagari(D.pyaar), 'pyaar', 'romanize pyaar');
  eq(lib.romanizeDevanagari(D.tum), 'tum', 'romanize tum-explicit-u');
gte(lib.editSimilarity('gali', lib.romanizeDevanagari(D.gali)), 0.72, 'fuzzy gali bridge');
  eq(lib.romanizeDevanagari(D.milte), 'milte', 'romanize milte');
  eq(lib.romanizeDevanagari(D.khushi), 'khushii', 'romanize khushi');
  eq(lib.relaxedVowelEq('tum', lib.romanizeDevanagari(D.tum)), true, 'relaxed tum bridge');
  eq(lib.romanizeDevanagari(D.dil), 'dil', 'romanize dil');
  eq(lib.romanizeDevanagari(D.kalHo), 'kal ho naa ho', 'romanize kal-ho-naa-ho');
  gte(lib.tokenScore('hum baithe baithe din mein sapne', D.humLine), 0.65, 'hindi cross-script score');
  gte(lib.tokenScore('kal ho naa ho', D.kalHo), 0.9, 'hindi exact-ish score');
  eq(lib.relaxedVowelEq('hum', 'ham'), true, 'relaxed hum/ham');
  eq(lib.relaxedVowelEq('din', 'den'), false, 'relaxed din/den false');
  gte(lib.editSimilarity('baithe', 'baitthae'), 0.72, 'fuzzy baithe');
  eq(lib.editSimilarity('hello', 'hello'), 1, 'editSim identical');
  eq(lib.tokenScore('sad song and make it better', 'take a sad song and make it better'), 0.92, 'hey-jude containment');
  eq(lib.tokenScore('remember to let', 'remember to let her into your heart'), 0.92, 'remember-to-let containment');
  eq(lib.stripVersion('Hey Jude - Remastered 2015'), 'hey jude', 'strip remastered');
  eq(lib.stripVersion('Song (feat. A & B)'), 'song', 'strip feat');
  eq(lib.stripVersion('Bohemian Rhapsody'), 'bohemian rhapsody', 'plain title untouched');
  eq(lib.stripVersion('Let It Be - Live'), 'let it be', 'strip live');
  const L = 'Take a sad song and make it better';
  eq(lib.sameLyricFamily(L, L, lib.titleContentWords('Hey Jude (Remastered)'), lib.titleContentWords('Hey Jude')), true, 'remaster clusters as cover');
  eq(lib.sameLyricFamily("Jude, don't make it bad", "Hey Jude, don't make it bad", lib.titleContentWords('Polkas on 45'), lib.titleContentWords('Hey Jude')), false, 'medley stays separate');
  eq(lib.sameLyricFamily(L, L, lib.titleContentWords('Let It Be'), lib.titleContentWords('Hey Jude')), false, 'mislabeled entry stays separate');
  eq(lib.sameLyricFamily(L, L, lib.titleContentWords('Hey Jude - Live at Hollywood Bowl'), lib.titleContentWords('Hey Jude')), true, 'live version clusters');
  eq(lib.isBoilerplate('karvaan nights are long'), false, 'karvaan is lyric word');
  eq(lib.isBoilerplate('you might also like'), true, 'genuine chrome filtered');
  const parsed = lib.parseSynced('[00:05.00] Gehra hua\n[nope]\n[01:02.50] next line');
  eq(parsed.length, 2, 'parseSynced count');
  eq(src.includes('genius.com/api/search'), true, 'genius discovery wired');
  eq(src.includes('lyrics_context: null'), true, 'honest null context');
  eq(src.includes('ishq jalakar'), false, 'song hack removed');
  eq(src.includes('lyrics.ovh'), true, 'ovh second source wired');
  eq(src.includes('/suggest/'), true, 'ovh suggest wired');
  eq(src.includes('Digging deeper'), true, 'deep resolve wired');
  const gUrl = 'https://genius.com/Armaan-malik-main-rahoon-ya-na-rahoon-lyrics';
  const gParsed = lib.parseWebResult(gUrl, 'Armaan Malik \u2013 Main Rahoon Ya Na Rahoon Lyrics | Genius Lyrics');
  eq(gParsed && gParsed.artist, 'Armaan Malik', 'parse genius artist');
  eq(gParsed && gParsed.title, 'Main Rahoon Ya Na Rahoon', 'parse genius title');
  const aParsed = lib.parseWebResult('https://www.azlyrics.com/lyrics/armaanmalik/mainrahoonyanarahoon.html', 'Armaan Malik - Main Rahoon Ya Na Rahoon Lyrics | AZLyrics.com');
  eq(aParsed && aParsed.artist, 'Armaan Malik', 'parse az artist');
  eq(aParsed && aParsed.title, 'Main Rahoon Ya Na Rahoon', 'parse az title');
  eq(lib.parseWebResult('https://example.com/watches', 'Buy cheap watches online'), null, 'parse junk null');
  eq(lib.parseWebResult('not a url', 'Armaan Malik - Main Rahoon'), null, 'parse bad-url null');
  eq(lib.spellingVariants('rahon').includes('rahoon'), true, 'variant rahon->rahoon');
  eq(lib.spellingVariants('rahoon').includes('rahon'), true, 'variant rahoon->rahon');
  eq(lib.spellingVariants('hello').length <= 2, true, 'variant cap');
  eq(lib.spellingVariants('abc').length, 0, 'variant short-word none');
  eq(lib.lyricLineCount({ syncedLyrics: '[00:01.00] hi' }), 1, 'degenerate 1-line stub');
  eq(lib.lyricLineCount({ syncedLyrics: '[00:01.00] a\n[00:05.00] b' }), 2, 'real synced counts');
  eq(lib.lyricLineCount({ plainLyrics: 'hello' }), 1, 'plain 1-line counts');
  eq(lib.lyricLineCount({}), 0, 'empty counts 0');
  const gv = lib.parseGeminiVariants('prefix {"variants": ["rahoon ya na rahoon", "rehoon", 42, "rahoon ya na rahoon", "x"]} suffix');
  eq(JSON.stringify(gv), JSON.stringify(['rahoon ya na rahoon', 'rehoon', 'x']), 'gemini variants parsed');
  eq(JSON.stringify(lib.parseGeminiVariants('The song is Hey Jude by The Beatles')), JSON.stringify([]), 'gemini prose rejected');
  eq(JSON.stringify(lib.parseGeminiVariants('not json at all')), JSON.stringify([]), 'gemini garbage rejected');
  gte(lib.tokenScore('main rahoon ya na rahoon', 'mein rahon ya na rahon'), 0.70, 'spelling-variant fuzzy');
  gte(lib.tokenScore('remember the night', 'remember the light'), 0.9, 'mishearing tolerance');
  eq(lib.tokenScore('take a sad song', 'take a sad light') < 0.8, true, 'short-word strictness');
  console.log('passed assertions: ' + pass);
}

main().catch((e) => { console.error('HARNESS ERROR: ' + (e && e.message)); process.exitCode = 1; });

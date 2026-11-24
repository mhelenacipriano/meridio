#!/usr/bin/env node
// meridio job scraper.
// Reads scripts/companies.json, pulls openings from each company's public ATS
// board API (no browser, no dependencies), keeps software/tech roles a person in
// Brazil can take, and writes app/src/jobs.json plus scripts/last-run.json.
//
//   node scripts/fetch-jobs.mjs [--only "CI&T,Wizdaa"] [--include-onsite] [--out path]
//
// Nothing is invented: every field comes from the posting; fields the posting
// does not provide are null / empty.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const COMPANIES_FILE = resolve(HERE, opt('companies') || 'companies.json');
const OUT_FILE = resolve(HERE, opt('out') || '../app/src/jobs.json');
const REPORT_FILE = resolve(HERE, 'last-run.json');
const ONLY = opt('only') ? new Set(opt('only').split(',').map((s) => s.trim().toLowerCase())) : null;
const INCLUDE_ONSITE = flag('include-onsite');
const NOW = Date.now();
const UA = 'meridio-job-board/0.1 (+public job board crawler; respects rate limits)';

// ---------------------------------------------------------------- http ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Minimum gap between two requests to the same host (ms). Workable throttles hard.
const HOST_GAP = { 'apply.workable.com': 6000 };
const DEFAULT_GAP = 1200;
const lastHit = new Map();

async function politely(host) {
  const gap = HOST_GAP[host] ?? DEFAULT_GAP;
  const wait = (lastHit.get(host) || 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

async function get(url, { json = true, tries = 5 } = {}) {
  const host = new URL(url).host;
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    await politely(host);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: json ? 'application/json' : 'text/html,*/*' },
        signal: AbortSignal.timeout(45000),
      });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        const backoff = (ra > 0 ? ra * 1000 : 8000 * 2 ** (attempt - 1));
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < tries) { await sleep(backoff); lastHit.set(host, Date.now()); continue; }
        throw lastErr;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (!json) return body;
      try { return JSON.parse(body); } catch { throw new Error(`non-JSON response: ${body.slice(0, 60)}`); }
    } catch (e) {
      lastErr = e;
      if (/^HTTP 4\d\d$/.test(e.message) && !/429/.test(e.message)) throw e; // permanent
      if (attempt >= tries) throw e;
      await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

// ----------------------------------------------------------- text utils ----

const L1 = 'agrave:224,aacute:225,acirc:226,atilde:227,auml:228,aring:229,ccedil:231,egrave:232,eacute:233,ecirc:234,euml:235,igrave:236,iacute:237,icirc:238,iuml:239,ntilde:241,ograve:242,oacute:243,ocirc:244,otilde:245,ouml:246,ugrave:249,uacute:250,ucirc:251,uuml:252,yacute:253,Agrave:192,Aacute:193,Acirc:194,Atilde:195,Auml:196,Aring:197,Ccedil:199,Egrave:200,Eacute:201,Ecirc:202,Euml:203,Igrave:204,Iacute:205,Icirc:206,Iuml:207,Ntilde:209,Ograve:210,Oacute:211,Ocirc:212,Otilde:213,Ouml:214,Ugrave:217,Uacute:218,Ucirc:219,Uuml:220,ordm:186,ordf:170,deg:176,copy:169,reg:174,middot:183,laquo:171,raquo:187,iexcl:161,iquest:191,szlig:223';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', bull: '•', acute: '’', euro: '€', pound: '£', trade: '™', times: '×', plusmn: '±', sect: '§', para: '¶', lsaquo: '‹', rsaquo: '›', sbquo: '‚', bdquo: '„' };
for (const kv of L1.split(',')) { const [k, v] = kv.split(':'); ENT[k] = String.fromCharCode(Number(v)); }

function decode(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENT[e] ?? m;
  });
}

const clean = (s) => decode(s).replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
// Leading requisition numbers such as "1192 - Title" or "(1527) Title" are ATS noise, not part of the title.
const cleanTitle = (s) => clean(s).replace(/^\[\s*job\s*-?\s*\d+\s*\]\s*/i, '').replace(/^\(?\d{2,6}\)?\s*[-–:]?\s+(?=\S)/, '').trim();

/** HTML -> [{t:'h'|'li'|'p', s}] */
function htmlToBlocks(html) {
  if (!html) return [];
  let x = String(html);
  x = x.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  x = x.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n@@H@@ $1\n');
  // <p><strong>Heading:</strong></p> style headings
  x = x.replace(/<(p|div)[^>]*>\s*<(strong|b)[^>]*>([^<]{1,90})<\/\2>\s*:?\s*<\/\1>/gi, '\n@@H@@ $3\n');
  x = x.replace(/<li[^>]*>/gi, '\n@@L@@ ');
  x = x.replace(/<\/(li|p|div|ul|ol|tr|section)>|<br\s*\/?>/gi, '\n');
  x = x.replace(/<[^>]+>/g, '');
  const lines = decode(x).split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (l.startsWith('@@H@@')) { const s = l.slice(5).trim().replace(/:$/, ''); if (s) out.push({ t: 'h', s }); continue; }
    if (l.startsWith('@@L@@')) {
      let s = l.slice(5).trim();
      if (!s && lines[i + 1] && !lines[i + 1].startsWith('@@')) s = lines[++i];
      if (s) out.push({ t: 'li', s: s.replace(/^[•\-–·*]\s*/, '') });
      continue;
    }
    const letters = l.replace(/[^A-Za-zÀ-ÿ]/g, '');
    const allCaps = letters.length >= 4 && l.length <= 70 && l === l.toUpperCase();
    if (l.length <= 80 && (l.endsWith(':') || allCaps)) { out.push({ t: 'h', s: l.replace(/:$/, '') }); continue; }
    if (/^[•·▪‣-]\s/.test(l)) { out.push({ t: 'li', s: l.replace(/^[•·▪‣-]\s*/, '') }); continue; }
    out.push({ t: 'p', s: l });
  }
  return out;
}

const blocksToText = (b) => b.map((x) => (x.t === 'li' ? '- ' + x.s : x.s)).join('\n');

const REQ_HEAD = /requirements?|qualifications?|what you('ll| will)? (need|bring)|must[- ]have|what we('re| are) looking for|who you are|about you|you (have|bring|are)|skills|your (profile|background|experience)|experience|requisitos|qualifica[cç][oõ]es|o que esperamos|o que buscamos|what we expect|requerimientos|perfil|conhecimentos|habilidades|se destaca|pr[eé]-?requisitos|voc[eê] precisa|o que voc[eê] (precisa|deve)|your skills|what you bring|ideal candidate|lo que necesitas|tu perfil/i;
const ABOUT_HEAD = /about the (role|job|position|opportunity)|^the (role|opportunity|position)$|role (overview|summary|description)|job (summary|description|overview)|position (summary|overview)|descri[cç][aã]o da vaga|sobre a vaga|sobre a oportunidade|descripci[oó]n del (puesto|cargo)/i;
const INTENT = /(we('| a)re (looking|seeking|hiring)|looking for|seeking|you('ll| will)|the (ideal|successful) candidate|will (be|work|join|own|lead)|estamos (buscando|procurando)|buscamos|procuramos|estamos contratando|voc[eê] (vai|ir[aá]))/i;
const BOILER = /(talent-as-a-service|toptalent|make remote work|^hello!|^hi!|^about us|are a (global|leading)|is a (global|leading|software|digital))/i;

function summarize(blocks) {
  const para = (from, max = 3) => {
    const out = [];
    for (let i = from; i < blocks.length && out.length < max; i++) {
      const b = blocks[i];
      if (b.t === 'h' && out.length) break;
      if (b.t === 'p' && b.s.length >= 40 && !BOILER.test(b.s)) out.push(b.s);
    }
    return out.join(' ');
  };
  let text = '';
  const hi = blocks.findIndex((b) => b.t === 'h' && ABOUT_HEAD.test(b.s));
  if (hi >= 0) text = para(hi + 1);
  if (!text) { // first paragraph that talks about the role rather than the company
    const ii = blocks.findIndex((b) => b.t === 'p' && b.s.length >= 40 && INTENT.test(b.s) && !BOILER.test(b.s));
    if (ii >= 0) text = para(ii, 2);
  }
  if (!text) text = para(0, 2);
  if (!text) { // no real paragraph: use the first few lines/bullets
    text = blocks.filter((b) => b.t !== 'h' && b.s.length >= 20).slice(0, 3).map((b) => b.s.replace(/[.;]$/, '')).join('; ');
    if (text) text += '.';
  }
  if (!text) return '';
  if (text.length > 420) {
    const cut = text.slice(0, 420);
    const dot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = dot > 160 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + '…';
  }
  return text;
}

function requirements(blocks) {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].t !== 'h' || !REQ_HEAD.test(blocks[i].s)) continue;
    const items = [];
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      if (b.t === 'h') break;
      if (b.t === 'li') items.push(b.s);
    }
    if (!items.length) { // plain-text postings: one requirement per line
      for (let j = i + 1; j < blocks.length; j++) {
        const b = blocks[j];
        if (b.t === 'h') break;
        if (b.t === 'p' && b.s.length >= 12 && b.s.length <= 240) items.push(b.s);
      }
    }
    if (items.length) return items.slice(0, 8).map((s) => (s.length > 220 ? s.slice(0, 217).replace(/\s+\S*$/, '') + '…' : s));
  }
  return [];
}

// ------------------------------------------------------------ taxonomy ----

const EXCLUDE_TITLE = /\b(open application|general application|talent (network|community)|banco de talentos|cadastro reserva|sales|account (executive|manager)|business development|bdr|sdr|recruit(er|ment|ing)?|talent (acquisition|partner|specialist|pool|sourc)|human resources|hr (business|generalist|manager|partner|analyst)|people (partner|ops|operations|business)|marketing|finance|financial|accountant|accounting|payroll|legal|counsel|paralegal|administrative|assistant|office manager|receptionist|customer (success|support|service|experience)|support (specialist|agent|representative)|procurement|copywriter|content (writer|creator|manager)|designer|\bux\b|ui\/ux|product (manager|owner|designer)|project manager|program manager|scrum master|delivery manager|business analyst|growth|\bseo\b|community manager|executive|\bceo\b|\bcfo\b|\bcoo\b|vice president|gerente de (produto|projeto)|product management|compliance|underwriting|credit|fraud analyst|collections|tax\b|vendas|comercial|recrutador)/i;
const TECH_TITLE = /\b(engineer|engineering|developer|programmer|software|devops|devsecops|sre|site reliability|architect|data (scientist|analyst|engineer|science)|machine learning|ml|mlops|ai|genai|llm|qa|quality assurance|sdet|tester|test automation|full[- ]?stack|front[- ]?end|back[- ]?end|mobile|ios|android|react|angular|node(js)?|java|python|\.net|golang|ruby|php|cobol|mainframe|sap|abap|salesforce|dba|database|cloud|security|platform|tech(nical)? lead|engenheir[oa]|desenvolvedor[a]?|programador[a]?|analista de (sistemas|dados|qa|testes)|ingenier[oa]|desarrollador[a]?|pessoa (engenheira|desenvolvedora))\b/i;

function roleOf(title, stack) {
  const t = title.toLowerCase();
  if (/security/.test(t)) return 'devops';
  if (/\b(qa|quality|sdet|testers?|testing|automation test|teste)\b/.test(t)) return 'qa';
  if (/\b(mobile|ios|android|react native|flutter|swift)\b/.test(t)) return 'mobile';
  if (/\b(devops|devsecops|sre|site reliability|platform|infrastructure|cloud|sysadmin|systems administrator|network|dba|database administrator|kubernetes)\b/.test(t)) return 'devops';
  const isData = /\b(data|machine learning|ml|mlops|analytics|bi|scientist)\b|\bai (engineer|developer|specialist|scientist)\b|\bgen ?ai\b|\bllm\b/.test(t);
  const fe = /front[- ]?end|\bui engineer|\breact\b|angular|\bvue\b|web developer/.test(t);
  const be = /back[- ]?end|\bjava\b|python|\.net|golang|\bgo\b|node|php|ruby|\bapi\b|cobol|mainframe|abap|\bsap\b|scala|rust|elixir|c\+\+|c#/.test(t);
  if (/full[- ]?stack/.test(t) || (fe && be)) return isData ? 'data' : 'fullstack';
  if (isData) return 'data';
  if (fe) return 'frontend';
  if (be) return 'backend';
  const front = stack.some((s) => ['React', 'Angular', 'Vue', 'Next.js', 'Svelte', 'Tailwind'].includes(s));
  const back = stack.some((s) => ['Node.js', 'Java', 'Python', 'Go', '.NET', 'C#', 'PHP', 'Ruby', 'Spring', 'Django', 'NestJS', 'Kotlin', 'Scala', 'Rust', 'Elixir'].includes(s));
  if (front && !back) return 'frontend';
  if (back && !front) return 'backend';
  return 'fullstack';
}

function seniorityOf(title, text) {
  const t = title.toLowerCase();
  if (/\b(intern|internship|trainee|junior|jr\.?|j[uú]nior|entry[- ]level|est[aá]gio)\b/.test(t)) return 'junior';
  if (/\b(lead|staff|principal|head|architect|arquiteto|arquitecto|manager|gerente|distinguished|tech lead|l[ií]der)\b/.test(t)) return 'lead';
  if (/\b(senior|sr\.?|s[eê]nior|ssr|sr)\b/.test(t)) return 'senior';
  if (/\b(mid|middle|semi[- ]?senior|pleno|pl|intermediate|semi)\b/.test(t)) return 'mid';
  const m = /(\d{1,2})\s*\+?\s*(?:-\s*\d+\s*)?(?:years|yrs|anos|a[ñn]os)/i.exec(text.slice(0, 6000));
  if (m) { const y = Number(m[1]); if (y >= 5) return 'senior'; if (y <= 1) return 'junior'; return 'mid'; }
  return 'mid';
}

const STACK = [
  ['TypeScript', /\bTypeScript\b/i], ['JavaScript', /\bJavaScript\b|\bES6\b/i], ['React Native', /\bReact[ -]Native\b/i],
  ['React', /\bReact(\.?js)?\b(?![ -]Native)/i], ['Next.js', /\bNext\.?js\b/i], ['Vue', /\bVue(\.?js)?\b/i], ['Angular', /\bAngular(JS)?\b/i], ['Svelte', /\bSvelte\b/i],
  ['Tailwind', /\bTailwind\b/i], ['Node.js', /\bNode(\.?js)?\b/i], ['NestJS', /\bNest\.?js\b/i], ['Python', /\bPython\b/i], ['Django', /\bDjango\b/i], ['FastAPI', /\bFastAPI\b/i], ['Flask', /\bFlask\b/i],
  ['Java', /\bJava\b/], ['Spring', /\bSpring( Boot)?\b/], ['Kotlin', /\bKotlin\b/i], ['Scala', /\bScala\b/i], ['C#', /\bC#/], ['.NET', /\.NET\b|\bdotnet\b/i],
  ['Go', /\bGolang\b|\(Go\)|\bGo (developer|engineer|programming|language|backend|microservices)|[,/] ?Go(?=[,/ )])/], ['Rust', /\bRust\b/], ['Ruby', /\bRuby\b/i], ['Rails', /\bRails\b/], ['PHP', /\bPHP\b/], ['Laravel', /\bLaravel\b/i], ['Elixir', /\bElixir\b/i], ['C++', /\bC\+\+/],
  ['Swift', /\bSwift\b/], ['Flutter', /\bFlutter\b/i], ['Dart', /\bDart\b/],
  ['AWS', /\bAWS\b|\bAmazon Web Services\b/], ['Azure', /\bAzure\b/i], ['GCP', /\bGCP\b|\bGoogle Cloud\b/i], ['Kubernetes', /\bKubernetes\b|\bK8s\b/i], ['Docker', /\bDocker\b/i], ['Terraform', /\bTerraform\b/i], ['Ansible', /\bAnsible\b/i],
  ['Jenkins', /\bJenkins\b/i], ['GitHub Actions', /\bGitHub Actions\b/i], ['CI/CD', /\bCI\/CD\b/i], ['Linux', /\bLinux\b/i],
  ['PostgreSQL', /\bPostgres(QL)?\b/i], ['MySQL', /\bMySQL\b/i], ['MongoDB', /\bMongoDB\b/i], ['Redis', /\bRedis\b/i], ['SQL', /\bSQL\b/], ['Kafka', /\bKafka\b/i], ['RabbitMQ', /\bRabbitMQ\b/i], ['Elasticsearch', /\bElasticsearch\b/i],
  ['GraphQL', /\bGraphQL\b/i], ['REST', /\bREST(ful)?\b/], ['Microservices', /\bMicroservices?\b/i],
  ['Snowflake', /\bSnowflake\b/i], ['Databricks', /\bDatabricks\b/i], ['Spark', /\b(Apache )?Spark\b/], ['Airflow', /\bAirflow\b/i], ['dbt', /\bdbt\b/], ['BigQuery', /\bBigQuery\b/i], ['Power BI', /\bPower ?BI\b/i], ['Tableau', /\bTableau\b/i],
  ['PyTorch', /\bPyTorch\b/i], ['TensorFlow', /\bTensorFlow\b/i], ['LLM', /\bLLMs?\b/], ['LangChain', /\bLangChain\b/i], ['OpenAI', /\bOpenAI\b/],
  ['Salesforce', /\bSalesforce\b/i], ['SAP', /\bSAP\b/], ['COBOL', /\bCOBOL\b/i], ['Selenium', /\bSelenium\b/i], ['Cypress', /\bCypress\b/i], ['Playwright', /\bPlaywright\b/i], ['Jest', /\bJest\b/],
  ['Datadog', /\bDatadog\b/i], ['Grafana', /\bGrafana\b/i], ['Prometheus', /\bPrometheus\b/i],
];

function detectStack(title, text) {
  const hay = `${title}\n${text}`;
  const hits = [];
  for (const [name, re] of STACK) {
    const m = re.exec(hay);
    if (m) hits.push({ name, at: m.index, inTitle: re.test(title) });
  }
  hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || a.at - b.at);
  return hits.slice(0, 8).map((h) => h.name);
}

// --------------------------------------------------- geography / remote ----

const COUNTRIES = {
  AR: 'argentina', BO: 'bolivia', BR: 'brazil|brasil', CL: 'chile', CO: 'colombia', CR: 'costa rica', DO: 'dominican republic|rep[uú]blica dominicana|republica dominicana',
  EC: 'ecuador', GT: 'guatemala', HN: 'honduras', MX: 'mexico|méxico|ciudad de mexico', NI: 'nicaragua', PA: 'panama|panamá', PE: 'peru|perú', PY: 'paraguay',
  SV: 'el salvador', UY: 'uruguay', VE: 'venezuela',
};
const COUNTRY_RE = Object.fromEntries(Object.entries(COUNTRIES).map(([k, v]) => [k, new RegExp(`\\b(${v})\\b`, 'i')]));
const BR_CITIES = /\b(s[aã]o paulo|rio de janeiro|curitiba|belo horizonte|florian[oó]polis|porto alegre|campinas|recife|bras[ií]lia|salvador|fortaleza|goi[aâ]nia|joinville|blumenau|manaus)\b/i;
const BR_CODE = /(^|[\s,(/|-])BR($|[\s,)/|-])/; // case-sensitive: "Remote - BR"
const LATAM_RE = /\b(latam|lat-am|latin america|latinoam[eé]rica|latinoamerican[oa]s?|am[eé]rica latina|south america|am[eé]rica do sul|sudam[eé]rica|latam-wide)\b/i;
const WORLDWIDE_LOC = /\b(worldwide|world-wide|anywhere|global(ly)?|international|everywhere)\b/i;
const WORLDWIDE_DESC = /\b(anywhere in the world|work from anywhere|remote[ ,(-]+worldwide|worldwide remote|open to (candidates|applicants) (from )?(anywhere|worldwide|globally)|hiring (globally|worldwide))\b/i;
const RESTRICT_DESC = /\b(must|need to|should|required to)\s+(be\s+)?(located|based|reside|residing|living)\s+(in|within)\s+(the\s+)?(US|U\.S\.|USA|United States|Canada|UK|United Kingdom|Europe|EU|India)\b|\b(US|U\.S\.)[- ](based|only|citizens?|residents?)\b|authori[sz]ed to work in the (US|United States|UK|EU)\b|no visa sponsorship/i;
const REMOTE_WORDS = /\b(remote(ly)?|remoto|remota|home ?office|work from home|wfh|teletrabalho|hybrid|h[ií]brido|on-?site|presencial|in-?office|fully|100%|flexible|only|based|anywhere|worldwide|global(ly)?)\b|[-–—|/(),:]/gi;

// "based in Guadalajara, Mexico", "must reside in Colombia": a sentence that pins the role to a place.
const PIN_RE = /\b(based|located|residing|living|reside|resident|residents|candidates from|applicants from|hiring (in|from)|only open to)\b[^.\n]{0,90}/gi;
function pinnedCountries(desc) {
  const pins = [...desc.matchAll(PIN_RE)].map((m) => m[0]);
  let toBR = false; const others = new Set();
  for (const p of pins) {
    if (LATAM_RE.test(p) || /\b(brazil|brasil)\b/i.test(p) || BR_CITIES.test(p)) { toBR = true; continue; }
    for (const c of codesIn(p)) others.add(c);
  }
  return { toBR, others };
}

const nonRemoteLabel = /\b(on-?site|onsite|presencial|in-?office|hybrid|h[ií]brido)\b/i;

const CITY_CODES = {
  MX: /\b(guadalajara|monterrey|ciudad de m[eé]xico|mexico city|cdmx|quer[eé]taro|puebla|tijuana)\b/i,
  CO: /\b(bogot[aá]|medell[ií]n|barranquilla|cartagena)\b/i,
  AR: /\b(buenos aires|c[oó]rdoba|rosario|mendoza|la plata)\b/i,
  CL: /\b(santiago|valpara[ií]so|concepci[oó]n)\b/i,
  PE: /\b(lima|arequipa)\b/i,
  UY: /\b(montevideo)\b/i,
  CR: /\b(san jos[eé])\b/i,
  EC: /\b(quito|guayaquil)\b/i,
};
function codesIn(text) {
  const out = new Set();
  for (const [code, re] of Object.entries(CITY_CODES)) if (re.test(text)) out.add(code);
  for (const [code, re] of Object.entries(COUNTRY_RE)) if (re.test(text)) out.add(code);
  if (BR_CODE.test(text) || BR_CITIES.test(text)) out.add('BR');
  return out;
}

/**
 * Decide whether a person living in Brazil can take the role.
 * Returns { ok, c, reason } where c is the eligibility list for the job card.
 */
function brazilEligibility(job) {
  const locText = [job.location, ...(job.locations || [])].filter(Boolean).join(' | ');
  const title = job.title;
  const desc = job.text || '';
  const locCodes = codesIn(locText);
  const latamLoc = LATAM_RE.test(locText) || LATAM_RE.test(title);
  const worldLoc = WORLDWIDE_LOC.test(locText);
  const stripped = locText.replace(REMOTE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  const bare = stripped === '' ;

  const finish = (reason, extraCodes) => {
    const codes = new Set([...locCodes, ...(extraCodes || [])]);
    if (latamLoc || worldLoc || codes.size >= 5 || (!codes.size)) return { ok: true, c: ['LATAM'], reason };
    return { ok: true, c: [...codes].sort(), reason };
  };

  if (locCodes.has('BR')) return finish('location: Brazil');
  if (latamLoc) return finish('location: LATAM');
  if (worldLoc && !RESTRICT_DESC.test(desc) && !(pinnedCountries(desc).others.size && !pinnedCountries(desc).toBR)) return finish('location: worldwide');

  // Specific place outside LATAM (no Brazil/LATAM/worldwide wording): never eligible.
  if (!bare && locCodes.size === 0) return { ok: false, reason: `outside LATAM (${locText.slice(0, 60)})` };

  // Bare "Remote" or a non-Brazil LATAM country: need explicit evidence in the posting text,
  // and the text must not pin the role to another country ("based in Guadalajara, Mexico").
  const pin = pinnedCountries(desc);
  if (pin.others.size && !pin.toBR) return { ok: false, reason: `description pins the role to ${[...pin.others].join('/')}` };
  const brDesc = /\b(brazil|brasil)\b/i.test(desc);
  const latamDesc = LATAM_RE.test(desc);
  const worldDesc = WORLDWIDE_DESC.test(desc);
  if ((brDesc || latamDesc || worldDesc) && !RESTRICT_DESC.test(desc)) {
    const why = brDesc ? 'description: Brazil' : latamDesc ? 'description: LATAM' : 'description: worldwide';
    if (brDesc) return finish(why, ['BR']);
    return { ok: true, c: ['LATAM'], reason: why };
  }
  return { ok: false, reason: bare ? 'remote, but no Brazil/LATAM/worldwide evidence' : `${locText.slice(0, 40)} only` };
}

// ------------------------------------------------------------- helpers ----

const fmtNum = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
function fmtRange(min, max, cur, per) {
  const lo = min > 0 ? fmtNum(min) : null, hi = max > 0 ? fmtNum(max) : null;
  if (!lo && !hi) return null;
  const amt = lo && hi && lo !== hi ? `${lo}–${hi}` : lo || hi;
  return [cur, amt].filter(Boolean).join(' ') + (per ? ` / ${per}` : '');
}
const PER = { 'per-month-salary': 'mo', month: 'mo', 'per-year-salary': 'yr', year: 'yr', 'per-hour-wage': 'hr', hour: 'hr', 'per-week-wage': 'wk', 'per-day-wage': 'day' };

function contractType(empType, title, text) {
  const e = (empType || '').toLowerCase();
  if (/contract|freelance|\bpj\b|consult|temp/.test(e)) return 'contractor';
  if (/full|permanent|clt|employee/.test(e)) return 'fulltime';
  if (/\[contractor\]|\bcontractor\b|\bpj\b|independent contractor|prestador/i.test(title)) return 'contractor';
  if (/\b(independent contractor|contractor agreement|as a contractor|contract(or)? basis|regime pj|\bPJ\b)/i.test(text.slice(0, 8000))) return 'contractor';
  return 'fulltime';
}

const toIso = (v) => {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v).replace(' UTC', 'Z').replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)Z?$/, '$1T$2Z'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Parse the JSON-LD JobPosting that Trakstar and Breezy embed in detail pages. */
function ldJobPosting(html) {
  const m = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  const raw = m[1];
  const grab = (k) => { const r = new RegExp(`"${k}"\\s*:\\s*"([^"\\n]*)"`).exec(raw); return r ? r[1] : null; };
  const d = /"description"\s*:\s*"([\s\S]*?)"\s*,\s*\n\s*"(?:jobLocation|datePosted|employmentType|identifier|hiringOrganization|baseSalary)"/.exec(raw);
  return {
    title: grab('title'),
    description: d ? d[1] : null,
    datePosted: grab('datePosted'),
    employmentType: grab('employmentType'),
    locality: grab('addressLocality'),
    country: grab('addressCountry'),
  };
}

// ------------------------------------------------------------ adapters ----
// Each adapter returns raw jobs: { externalId, title, location, locations[], workplace, postedAt,
//   pay, employmentType, html, url, department }

const ADAPTERS = {
  async greenhouse({ slug }) {
    const data = await get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
    return (data.jobs || []).map((j) => ({
      externalId: String(j.id),
      title: j.title,
      location: j.location?.name || '',
      locations: [], // Greenhouse "offices" are often internal/client codes, not geography
      workplace: null,
      postedAt: toIso(j.first_published) || toIso(j.updated_at),
      pay: (() => { const r = (j.pay_input_ranges || [])[0]; return r ? fmtRange(r.min_cents / 100, r.max_cents / 100, r.currency_type) : null; })(),
      employmentType: null,
      html: decode(j.content || ''),
      url: j.absolute_url,
      department: (j.departments || [])[0]?.name || null,
    }));
  },

  async lever({ slug }) {
    const data = await get(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    return (Array.isArray(data) ? data : []).map((j) => {
      const sr = j.salaryRange;
      const pay = sr && Math.max(sr.min || 0, sr.max || 0) >= 10 ? fmtRange(sr.min, sr.max, sr.currency, PER[sr.interval] || null) : null;
      const lists = (j.lists || []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join('');
      return {
        externalId: j.id,
        title: j.text,
        location: j.categories?.location || '',
        locations: j.categories?.allLocations || [],
        countryHint: j.country || null,
        workplace: j.workplaceType || null,
        postedAt: toIso(j.createdAt),
        pay,
        employmentType: j.categories?.commitment || null,
        html: `${j.descriptionBody || j.description || ''}${lists}${j.additional || ''}`,
        url: j.hostedUrl,
        department: j.categories?.team || j.categories?.department || null,
      };
    });
  },

  async ashby({ slug }) {
    const data = await get(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
    return (data.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
      externalId: j.id,
      title: j.title,
      location: j.location || '',
      locations: [...(j.secondaryLocations || []).map((s) => s.location), j.address?.postalAddress?.addressCountry].filter(Boolean),
      workplace: j.workplaceType ? String(j.workplaceType).toLowerCase() : (j.isRemote ? 'remote' : null),
      postedAt: toIso(j.publishedAt),
      pay: j.compensation?.compensationTierSummary || j.compensation?.scrapeableCompensationSalarySummary || null,
      employmentType: j.employmentType || null,
      html: j.descriptionHtml || '',
      url: j.jobUrl,
      department: j.department || j.team || null,
    }));
  },

  async workable({ slug }) {
    const data = await get(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`);
    const byCode = new Map();
    for (const j of data.jobs || []) {
      const where = (j.locations || []).filter((l) => !l.hidden).map((l) => [l.city, l.region, l.country].filter(Boolean).join(', '));
      const cur = byCode.get(j.shortcode);
      if (cur) { cur.locations.push(...where); continue; } // widget repeats a job once per location
      byCode.set(j.shortcode, {
        externalId: j.shortcode,
        title: j.title,
        location: where[0] || [j.city, j.state, j.country].filter(Boolean).join(', '),
        locations: where,
        workplace: j.telecommuting ? 'remote' : null,
        postedAt: toIso(j.published_on) || toIso(j.created_at),
        pay: null,
        employmentType: j.employment_type || null,
        html: j.description || '',
        url: j.url || j.shortlink,
        department: j.department || j.function || null,
      });
    }
    return [...byCode.values()];
  },

  async breezy({ slug }) {
    const list = await get(`https://${slug}.breezy.hr/json`);
    const out = [];
    for (const j of Array.isArray(list) ? list : []) {
      let html = '';
      try { const ld = ldJobPosting(await get(j.url, { json: false })); html = decode(ld?.description || ''); } catch { /* list data still usable */ }
      out.push({
        externalId: String(j.id),
        title: j.name,
        location: j.location?.name || [j.location?.city, j.location?.state?.name, j.location?.country?.name].filter(Boolean).join(', '),
        locations: [j.location?.country?.name].filter(Boolean),
        workplace: j.location?.is_remote ? 'remote' : null,
        postedAt: toIso(j.published_date),
        pay: j.salary || null,
        employmentType: j.type?.name || null,
        html,
        url: j.url,
        department: j.department || null,
      });
    }
    return out;
  },

  async recruitee({ slug }) {
    const data = await get(`https://${slug}.recruitee.com/api/offers/`);
    return (data.offers || []).filter((o) => o.status ? o.status === 'published' : true).map((o) => {
      const s = o.salary;
      return {
        externalId: String(o.id),
        title: o.title,
        location: o.location || [o.city, o.country].filter(Boolean).join(', '),
        locations: (o.locations || []).map((l) => [l.city, l.country].filter(Boolean).join(', ')).filter(Boolean),
        workplace: o.remote ? 'remote' : o.hybrid ? 'hybrid' : o.on_site ? 'onsite' : null,
        postedAt: toIso(o.published_at) || toIso(o.created_at),
        pay: s ? fmtRange(Number(s.min), Number(s.max), s.currency, PER[s.period] || null) : null,
        employmentType: o.employment_type_code || null,
        html: `${o.description || ''}<h3>Requirements</h3>${o.requirements || ''}`,
        url: o.careers_url,
        department: o.department || null,
      };
    });
  },

  async trakstar({ slug }) {
    const base = `https://${slug}.hire.trakstar.com`;
    const html = await get(`${base}/`, { json: false });
    const items = [];
    const re = /<div class="js-card list-item[^"]*"[^>]*data-href="([^"]+)"[\s\S]*?<h3[^>]*title="([^"]*)"[\s\S]*?js-job-list-opening-loc[^>]*title="([^"]*)"([\s\S]*?)(?=<div class="js-card list-item|<\/form>|$)/g;
    let m;
    while ((m = re.exec(html))) {
      const meta = [...m[4].matchAll(/<span>([^<]+)<\/span>/g)].map((x) => decode(x[1]).trim());
      items.push({ href: m[1], title: decode(m[2]), location: decode(m[3]), meta });
    }
    const out = [];
    for (const it of items) {
      const page = await get(`${base}${it.href}`, { json: false });
      const ld = ldJobPosting(page);
      out.push({
        externalId: it.href.replace(/\/$/, '').split('/').pop(),
        title: it.title,
        location: it.location,
        locations: [],
        workplace: it.meta.some((x) => /fully remote/i.test(x)) ? 'remote' : it.meta.some((x) => /hybrid/i.test(x)) ? 'hybrid' : null,
        postedAt: toIso(ld?.datePosted),
        pay: null,
        employmentType: ld?.employmentType || it.meta.find((x) => /full|part|contract/i.test(x)) || null,
        html: decode(ld?.description || ''),
        url: `${base}${it.href}`,
        department: null,
      });
    }
    return out;
  },
};

// ------------------------------------------------------------ pipeline ----

const initials = (name) => {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const camel = (words[0] || name).match(/[A-Z][a-z0-9]*/g);
  if (camel && camel.length >= 2) return (camel[0][0] + camel[1][0]).toUpperCase();
  return (words[0] || name).slice(0, 2).toUpperCase();
};

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 2147483647 || 1; }

const norm = (x) => x.toLowerCase().replace(/\s+/g, ' ').trim();

/** Paragraphs repeated across a company's postings are company boilerplate, not role description. */
function boilerplateOf(raws) {
  if (raws.length < 3) return new Set();
  const freq = new Map();
  for (const r of raws) for (const k of new Set(htmlToBlocks(r.html).filter((b) => b.t === 'p').map((b) => norm(b.s)))) freq.set(k, (freq.get(k) || 0) + 1);
  const min = Math.max(3, Math.ceil(raws.length * 0.4));
  return new Set([...freq].filter(([, n]) => n >= min).map(([k]) => k));
}

function toJob(company, raw, elig, boiler = new Set()) {
  const blocks = htmlToBlocks(raw.html);
  const text = blocksToText(blocks);
  const stack = detectStack(raw.title, text);
  const hours = Math.max(0, Math.round((NOW - new Date(raw.postedAt).getTime()) / 3600000));
  return {
    id: 0,
    title: cleanTitle(raw.title),
    company: company.name,
    ini: initials(company.name),
    role: roleOf(raw.title, stack),
    sen: seniorityOf(raw.title, text),
    c: elig.c,
    h: hours,
    pay: raw.pay || null,
    ct: contractType(raw.employmentType, raw.title, text),
    stack,
    url: raw.url,
    about: summarize(blocks.filter((b) => !(b.t === 'p' && boiler.has(norm(b.s))))),
    reqs: requirements(blocks),
  };
}

async function main() {
  const companies = JSON.parse(await readFile(COMPANIES_FILE, 'utf8'));
  const report = { ranAt: new Date(NOW).toISOString(), includeOnsite: INCLUDE_ONSITE, companies: [], total: 0 };
  const jobs = [];
  const seenUrls = new Set();
  const usedIds = new Set();

  for (const co of companies) {
    if (ONLY && !ONLY.has(co.name.toLowerCase())) continue;
    const row = { company: co.name, ats: co.ats, slug: co.slug, status: 'ok', openings: 0, tech: 0, brazilEligible: 0, kept: 0, dropped: { nonTech: 0, notEligible: 0, notRemote: 0, noDate: 0, noDescription: 0 }, sampleDrops: [] };
    report.companies.push(row);
    process.stdout.write(`• ${co.name} (${co.ats}/${co.slug}) … `);
    try {
      if (co.skip) { row.status = 'skipped'; row.error = co.skip; console.log('skipped'); continue; }
      const adapter = ADAPTERS[co.ats];
      if (!adapter) { row.status = 'skipped'; row.error = `no adapter for "${co.ats}"`; console.log('skipped'); continue; }
      const raws = await adapter(co);
      row.openings = raws.length;
      const boiler = boilerplateOf(raws);
      for (const raw of raws) {
        const title = cleanTitle(raw.title || '');
        if (!title || !raw.url) continue;
        if (EXCLUDE_TITLE.test(title) || !TECH_TITLE.test(title) || (/consultant/i.test(title) && !/(engineer|developer|architect|programmer)/i.test(title))) { row.dropped.nonTech++; continue; }
        row.tech++;
        const text = blocksToText(htmlToBlocks(raw.html));
        if (raw.countryHint === 'BR' && !raw.locations.some((l) => /brazil|brasil/i.test(l))) raw.locations.push('Brazil');
        const elig = brazilEligibility({ ...raw, title, text });
        if (!elig.ok) { row.dropped.notEligible++; if (row.sampleDrops.length < 4) row.sampleDrops.push(`${title} — ${elig.reason}`); continue; }
        row.brazilEligible++;
        const label = `${raw.location} ${title}`;
        if (!INCLUDE_ONSITE && (/^(onsite|on-site|hybrid)$/i.test(raw.workplace || '') || nonRemoteLabel.test(label))) { row.dropped.notRemote++; continue; }
        if (!raw.postedAt) { row.dropped.noDate++; continue; }
        if (!text.trim()) { row.dropped.noDescription++; continue; }
        if (seenUrls.has(raw.url)) continue;
        seenUrls.add(raw.url);
        const job = toJob(co, { ...raw, title }, elig, boiler);
        if (!INCLUDE_ONSITE && nonRemoteLabel.test(job.about)) { row.dropped.notRemote++; continue; }
        let id = hash(`${co.ats}:${co.slug}:${raw.externalId}`);
        while (usedIds.has(id)) id++;
        usedIds.add(id);
        job.id = id;
        jobs.push(job);
        row.kept++;
      }
      console.log(`${row.openings} openings → ${row.kept} kept`);
    } catch (e) {
      row.status = 'failed';
      row.error = String(e.message || e);
      console.log(`FAILED: ${row.error}`);
    }
  }

  jobs.sort((a, b) => a.h - b.h || a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
  report.total = jobs.length;
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(jobs, null, 2) + '\n');
  await writeFile(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');

  console.log('\nCompany'.padEnd(22) + 'status'.padEnd(9) + 'openings  tech  BR-eligible  kept');
  for (const r of report.companies) {
    console.log(r.company.padEnd(21) + ' ' + r.status.padEnd(8) + ' ' + String(r.openings).padStart(8) + String(r.tech).padStart(6) + String(r.brazilEligible).padStart(13) + String(r.kept).padStart(6) + (r.error ? `   ${r.error.slice(0, 90)}` : ''));
  }
  console.log(`\n${jobs.length} jobs open to Brazil → ${OUT_FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

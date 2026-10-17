import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('index.html');
// Minimal CSS walker: selector lists of style rules, including rules nested in @media/@supports.
function selectors(css){
 const out=[];css=css.replace(/\/\*[\s\S]*?\*\//g,'');
 (function walk(text){let i=0;while(i<text.length){const open=text.indexOf('{',i);if(open<0)break;const head=text.slice(i,open).trim();let depth=1,k=open+1;
  while(k<text.length&&depth){if(text[k]==='{')depth++;else if(text[k]==='}')depth--;k++;}
  if(/^@(media|supports|container|layer)\b/.test(head))walk(text.slice(open+1,k-1));else if(!head.startsWith('@'))out.push(...head.split(/,(?![^()]*\))/).map(s=>s.trim()));
  i=k;}})(css);
 return out;
}
test('light-only stylesheets never block first paint and contain light-theme rules only',()=>{
 const links=[...html.matchAll(/<link rel="stylesheet" href="([^"?]+)[^"]*"([^>]*)>/g)].filter(m=>/data-ox-theme-css="light"/.test(m[2]));
 assert.ok(links.length>=3);
 for(const [,path,attrs] of links){
  assert.match(attrs,/media="not all"/,path);
  const unscoped=selectors(read(path)).filter(s=>!/theme-light/.test(s)||/:not\([^)]*theme-light/.test(s));
  assert.deepEqual(unscoped,[],`${path} must only style body.theme-light`);
 }
});
test('news page CSS loads on demand and keeps its cascade position',()=>{
 assert.match(html,/news-shell\.css[^>]*>\s*<link rel="stylesheet" data-ox-lazy-css="news" data-ox-lazy-href="src\/styles\/components\/news-center\.css/);
 const outside=selectors(read('src/styles/components/news-center.css')).filter(s=>!/\.oxn-|data-news-surface|\.ox-news-/.test(s)||/\.ox-news-open/.test(s));
 assert.deepEqual(outside,[],'rules for other pages belong in news-shell.css');
 assert.doesNotMatch(read('src/styles/components/news-shell.css'),/body[^{]*:has\(/,'no body-level :has()');
});
test('head scripts that are not needed before first paint are deferred',()=>{
 const head=html.slice(0,html.indexOf('</head>'));
 for(const path of ['src/vendor/lightweight-charts-4.2.3.js','src/components/layout/responsive-guard.js','src/components/style-boot.js'])
  assert.match(head,new RegExp(`<script defer src="${path.replaceAll('.','\\.')}`),path);
});

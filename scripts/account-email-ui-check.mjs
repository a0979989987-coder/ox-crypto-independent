import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const root=resolve(import.meta.dirname,'..'),html=readFileSync(resolve(root,'index.html'),'utf8');
const markup=html.slice(html.indexOf('<div class="ox-account-overlay"'),html.indexOf('<main class="wrap"'));
const css=readFileSync(resolve(root,'src/styles/account/account.css'),'utf8');
const executablePath=process.env.OX_TEST_BROWSER||['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  let sends=0,limited=true;
  await page.route('https://ox.test/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="UTF-8"><style>${css}</style><button data-ox-account-open>Account</button>${markup}<script src="/auth.js"></script><script src="/session.js"></script><script src="/account.js"></script>`});
    if(['/auth.js','/session.js','/account.js'].includes(path))return route.fulfill({contentType:'text/javascript',body:readFileSync(resolve(root,'src/components/account',path.slice(1)),'utf8')});
    const endpoint=path.split('/').at(-1);
    if(endpoint==='email'){sends++;return route.fulfill({status:limited?429:200,contentType:'application/json',body:JSON.stringify(limited?{ok:false,code:'EMAIL_RATE_LIMITED',cooldownSeconds:60,message:'寄信頻率或配額已達限制，請稍後再試。'}:{ok:true,cooldownSeconds:60,message:'登入連結已寄出，請查看收件匣與垃圾郵件，不需重複寄送。'})});}
    return route.fulfill({contentType:'application/json',body:JSON.stringify(endpoint==='config'?{configured:true}:{ok:true,user:null})});
  });
  await page.goto('https://ox.test/');
  await page.waitForFunction(()=>window.OXAuth?.status.configured);
  await page.locator('[data-ox-account-open]').click();
  await page.locator('#ox-account-tab-register').click();
  await page.locator('#ox-account-email').fill('fixture@example.test');
  await page.locator('#ox-account-email-submit').click();
  await page.locator('#ox-account-auth-status').filter({hasText:'配額'}).waitFor();
  assert.equal(await page.locator('#ox-account-email-submit').isDisabled(),true);
  assert.match(await page.locator('#ox-account-email-submit').innerText(),/\d+/);
  await page.locator('#ox-account-tab-login').click();
  assert.equal(await page.locator('#ox-account-email-submit').isDisabled(),true);
  await page.reload();await page.waitForFunction(()=>window.OXAuth?.status.configured);
  await page.locator('[data-ox-account-open]').click();
  assert.equal(await page.locator('#ox-account-email-submit').isDisabled(),true);
  assert.equal(sends,1);
  // Only fixture time advances. No real provider/email requests are made.
  await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+61000;document.dispatchEvent(new CustomEvent('ox:emailcooldown'));});
  limited=false;
  await page.locator('#ox-account-email').fill('fixture@example.test');
  await page.locator('#ox-account-email-submit').click();
  await page.locator('#ox-account-auth-status').filter({hasText:'垃圾郵件'}).waitFor();
  assert.equal(await page.locator('#ox-account-email-submit').isDisabled(),true);
  assert.equal(sends,2);
  const values=await page.evaluate(()=>Object.values(sessionStorage));
  assert.ok(values.every(value=>/^\d+$/.test(value)));
  console.log('Email mobile UI passed: explicit 429, shared cooldown, reload persistence, manual retry and success feedback. Synthetic only; no email delivered.');
} finally {await browser.close();}

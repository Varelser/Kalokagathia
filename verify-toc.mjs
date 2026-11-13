import { chromium } from 'playwright';
import fs from 'fs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1000,height:900} });
const errors=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()) });
await page.goto('file:///home/hatch/workspace/toc-desc/work/updated.html', {waitUntil:'load'});
await page.waitForTimeout(600);
const data = await page.evaluate(()=>{
  const descs=[...document.querySelectorAll('.chapter-desc')].map(e=>e.textContent.trim().length);
  const intro=document.querySelector('.intro-desc')?.textContent.trim().length||0;
  // toggle test: click first chapter, check open
  document.querySelector('.chapter').click();
  const open=document.querySelector('.chapter').classList.contains('open');
  const subVisible=document.querySelector('.chapter .sub-list').getBoundingClientRect().height;
  return {descCount:descs.length, minDesc:Math.min(...descs), maxDesc:Math.max(...descs), introLen:intro, openAfterClick:open, subHeight:subVisible, scrollW:document.documentElement.scrollWidth, clientW:document.documentElement.clientWidth};
});
console.log(JSON.stringify(data), "errors", errors);
await page.screenshot({path:'../shots/desktop-top.png', fullPage:false});
const mp = await browser.newPage({ viewport:{width:390,height:844} });
await mp.goto('file:///home/hatch/workspace/toc-desc/work/updated.html', {waitUntil:'load'});
await mp.waitForTimeout(500);
const mdata = await mp.evaluate(()=>({scrollW:document.documentElement.scrollWidth, clientW:document.documentElement.clientWidth}));
console.log("mobile", JSON.stringify(mdata));
await mp.screenshot({path:'../shots/mobile-top.png'});
await browser.close();

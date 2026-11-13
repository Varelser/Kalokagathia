import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1000,height:900} });
const errors=[];
page.on('pageerror', e=>errors.push(e.message));
await page.goto('file:///home/hatch/workspace/toc-placement/work/jiai-toc.html', {waitUntil:'load'});
await page.waitForTimeout(500);
const data = await page.evaluate(()=>{
  const kn=document.querySelector('.kn-btn');
  document.querySelector('.chapter').click();
  return {title:document.title, descCount:document.querySelectorAll('.chapter-desc').length, knHref:kn?.getAttribute('href'), knText:kn?.textContent.trim(), canonical:document.querySelector('link[rel="canonical"]')?.href, open:document.querySelector('.chapter').classList.contains('open'), scrollW:document.documentElement.scrollWidth, clientW:document.documentElement.clientWidth};
});
console.log(JSON.stringify(data), "pageerrors:", errors);
await page.screenshot({path:'/home/hatch/workspace/toc-placement/shots-jiai-top.png'});
await browser.close();

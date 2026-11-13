import { chromium } from 'playwright';
const browser = await chromium.launch();
for (const [file, shot] of [['jiai-toc_new.html','jiai.png'],['posts_asc_trauma_new.html','asc.png'],['index_new.html','index.png']]) {
  const page = await browser.newPage({ viewport:{width:1000,height:800} });
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('file:///home/hatch/workspace/logo-home-link/work/'+file, {waitUntil:'load'});
  await page.waitForTimeout(400);
  const data = await page.evaluate(()=>{
    const links=[...document.querySelectorAll('a')].filter(a=>a.querySelector('img[alt*="VARELSER"], img[alt*="エンブレム"]')).map(a=>a.getAttribute('href'));
    return {logoLinks:links, scrollW:document.documentElement.scrollWidth, clientW:document.documentElement.clientWidth};
  });
  console.log(file, JSON.stringify(data), "pageerrors:", errors.length);
  await page.screenshot({path:'/home/hatch/workspace/logo-home-link/'+shot});
  await page.close();
}
await browser.close();

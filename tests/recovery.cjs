// Run with Playwright installed: node tests/recovery.cjs (app served on port 8000).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-24T18:00:00Z') });
  await page.goto('http://localhost:8000');
  const seed = async (recovery = {}, rest = {every:7,days:[]}, extra = {}) => {
    await page.evaluate(({recovery,rest,extra}) => {
      localStorage.clear();
      const goal = {d:'2026-11-22',n:10,step:1,every:'never',per:'day'};
      const data = {
        'rep-tally-v1': [{d:'2026-11-22',ex:'push',n:10,t:1},{d:'2026-11-22',ex:'squat',n:10,t:2}],
        'rep-tally-goals-v1': {push:goal,squat:goal},
        'rep-tally-daygoals-v1': {'2026-11-22':{push:10,squat:10},'2026-11-23':{push:10,squat:10}},
        'rep-tally-recovery-v1': recovery, 'rep-tally-rest-v1': rest, ...extra
      };
      for (const [k,v] of Object.entries(data)) localStorage.setItem(k,JSON.stringify(v));
    }, {recovery,rest,extra});
    await page.reload();
  };
  const streak = async n => assert.equal(await page.locator('#streak').textContent(), '🔥 '+n);
  const choose = async (id,value) => page.locator(`[data-ex="${id}"].er`).locator('..').locator('select').selectOption(value);
  await seed({'2026-11-23':{push:'sore',squat:'rest'}}); await streak(1);
  await page.locator('.ex[data-ex="push"] .recovery-btn').click();
  await choose('push','sore'); await choose('squat','sore'); await page.locator('#ed-save').click();
  await streak(1); assert.equal(await page.locator('.ex[data-ex="push"] .row').isVisible(),false);
  await page.reload(); await streak(1);
  assert.match(await page.locator('.ex[data-ex="push"] .recovery-btn').textContent(), /Injury/);
  await page.locator('.ex[data-ex="push"] .recovery-btn').click();
  await choose('squat','active'); await page.locator('#ed-save').click();
  await page.locator('.ex[data-ex="squat"] button[data-n="10"]:not(.doneset)').click(); await streak(2);
  assert.equal(await page.locator('.ex[data-ex="push"] .total').textContent(),'0');
  await seed({'2026-11-23':{push:'sore'}}); await streak(0); // Squats still missing.
  await seed({}, {every:7,days:['2026-11-23']}); await streak(1); // Old whole-day rest.
  await page.locator('.ex[data-ex="push"] .recovery-btn').click();
  assert.equal(await page.locator('.er[data-ex="push"]').locator('..').locator('option[value="rest"]').evaluate(el => el.disabled),true);
  await choose('push','sore'); await page.locator('#ed-cancel').click();
  assert.equal(await page.locator('.ex[data-ex="push"] .row').isVisible(),true); // Cancel is inert.
  await seed({'2026-11-23':{push:'rest'}});
  await page.locator('.ex[data-ex="push"] .recovery-btn').click();
  assert.equal(await page.locator('.er[data-ex="squat"]').locator('..').locator('option[value="rest"]').evaluate(el => el.disabled),false);
  await page.locator('#ed-cancel').click();
  const growing = {d:'2026-11-22',n:10,step:1,every:'day',per:'day'};
  await seed({'2026-11-23':{push:'sore'}},undefined,{'rep-tally-goals-v1':{push:growing,squat:growing}});
  assert.equal(await page.locator('.ex[data-ex="push"] .gnum').textContent(),'/ 11');
  assert.equal(await page.locator('.ex[data-ex="squat"] .gnum').textContent(),'/ 12');
  // Historical edits repair the streak and preserve already logged reps.
  await seed(); await streak(0);
  await page.locator('#more-btn').click();
  await page.locator('#more-list .day[data-d="2026-11-23"]').click();
  await choose('push','sore'); await choose('squat','rest'); await page.locator('#ed-save').click();
  await streak(1);
  await page.locator('#more-list .day[data-d="2026-11-22"]').click();
  await choose('push','sore'); await page.locator('#ed-save').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rep-tally-v1')).find(e=>e.ex==='push').n),10);
  await streak(1);
  await page.locator('#more-close').click();
  await seed({'2026-11-23':{push:'sore'}},undefined,{'rep-tally-goals-v1':{push:growing,squat:growing}});
  // Backup includes recovery; restoring old backups clears it without changing their rest data.
  await page.locator('#more-btn').click();
  const downloadPromise = page.waitForEvent('download'); await page.locator('#bk-save').click();
  const download = await downloadPromise;
  const fs = require('node:fs'); const backup = JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  assert.equal(backup.recovery['2026-11-23'].push,'sore');
  page.on('dialog', d => d.accept());
  const csvPromise = page.waitForEvent('download'); await page.locator('#csv-btn').click();
  const csv = fs.readFileSync(await (await csvPromise).path(),'utf8');
  assert.match(csv,/Pushups recovery/); assert.match(csv,/2026-11-23,0,0,sore,/);
  await page.locator('#bk-file').setInputFiles({name:'new.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rep-tally-recovery-v1'))['2026-11-23'].push),'sore');
  delete backup.recovery; backup.rest = {every:7,days:['2026-11-23']};
  await page.locator('#bk-file').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.waitForFunction(() => localStorage.getItem('rep-tally-recovery-v1') === '{}');
  await streak(1);
  await page.locator('#more-close').click();
  await page.locator('.ex[data-ex="push"] .recovery-btn').click(); await choose('push','sore'); await page.locator('#ed-save').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
  await page.clock.runFor(500);
  await page.screenshot({path:'/tmp/rep-tally-recovery.png'});
  assert.deepEqual(errors,[]);
  await browser.close(); console.log('Recovery browser checks passed');
})().catch(e => { console.error(e); process.exit(1); });

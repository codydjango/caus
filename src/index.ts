import { openDatabase, readEventsByAggregate } from './db/store.js';
import { WorldClock } from './domain/clock.js';
import { startTickLoop, processTick } from './domain/tick.js';
import { handleGiveMoney, PLAYER_ID } from './commands/giveMoney.js';
import { handleBuildFarm, SITE_ID } from './commands/buildFarm.js';
import { handleUpgradeFarm } from './commands/upgradeFarm.js';
import { buildPlayerProjection } from './domain/player.js';
import { buildSiteProjection } from './domain/site.js';

const db = openDatabase();
WorldClock.init(db);

console.log('World started. Clock at:', WorldClock.now(), 'µs');

console.log('\n--- GiveMoney($200) ---');
handleGiveMoney(db, { amount: 200 });
console.log('Player:', buildPlayerProjection(readEventsByAggregate(db, 'Player', PLAYER_ID)));

console.log('\n--- BuildFarm ---');
handleBuildFarm(db);
console.log('Site:', buildSiteProjection(readEventsByAggregate(db, 'Site', SITE_ID)));

console.log('\nRunning one tick...');
processTick(db);

const siteAfterTick = buildSiteProjection(readEventsByAggregate(db, 'Site', SITE_ID));
console.log('Site after tick:', siteAfterTick);

if (siteAfterTick.has_farm) {
  console.log('\n--- UpgradeFarm ---');
  handleUpgradeFarm(db);
  console.log('Player:', buildPlayerProjection(readEventsByAggregate(db, 'Player', PLAYER_ID)));
  console.log('Site:  ', buildSiteProjection(readEventsByAggregate(db, 'Site', SITE_ID)));
} else {
  console.log('Farm build takes 30s — run again after the timer completes to see upgrade.');
}

console.log('\nStarting tick loop (exits after 3 ticks)...');
let tickCount = 0;
const timer = startTickLoop(db);

const done = setInterval(() => {
  tickCount++;
  if (tickCount >= 3) {
    clearInterval(timer);
    clearInterval(done);
    console.log('Final player:', buildPlayerProjection(readEventsByAggregate(db, 'Player', PLAYER_ID)));
    console.log('Final site:  ', buildSiteProjection(readEventsByAggregate(db, 'Site', SITE_ID)));
  }
}, 100);

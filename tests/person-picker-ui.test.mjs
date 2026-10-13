import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const followups = readFileSync(join(root, 'dashboard-web/src/followups.jsx'), 'utf8');
const pipeline = readFileSync(join(root, 'dashboard-web/src/pipeline.jsx'), 'utf8');
const review = readFileSync(join(root, 'dashboard-web/src/review.jsx'), 'utf8');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++;
  } else { console.log(`  FAIL ${message}`); failed++; }
}

check(!followups.includes('setCrossLogIds(new Set('), 'follow-up people are not preselected');
check(followups.includes('/api/people/by-company/') && followups.includes('/api/applications/'), 'follow-up messages use the people and application message endpoints');
check(/I sent this[\s\S]{0,300}personChoice|disabled=\{!personChoice[^}]*\}[\s\S]{0,500}I sent this/.test(followups), 'I sent this is gated on the person choice');
check(/Save touch[\s\S]{0,300}personChoice|disabled=\{!personChoice[\s\S]{0,500}Save touch/.test(followups), 'manual Save is gated on the person choice');
check(followups.includes('Not a message to a person (call, form, other)'), 'follow-up panel offers the non-message choice');
check(/contact:\s*selectedPerson\?\.name\s*\|\|\s*payload\.contact/.test(followups), 'non-message touches preserve the selected person name as contact');
check(followups.includes('/api/target-talent/by-company/') && followups.includes('<TaFollowupComposer ta={ta} />'), 'TA people retain their per-contact composer');
check(/ta\.status\s*\|\|\s*'Not Contacted'/.test(followups) && followups.includes('ta.lastTouch'), 'TA people retain their status and last-touch line');
check(/peopleGenerationRef\.current\s*!==\s*generation/.test(followups), 'follow-up people fetch ignores stale responses');
check(/setRelatedPeople\(\[\]\);[\s\S]{0,100}setRelatedTalent\(\[\]\);[\s\S]{0,100}load\(\)/.test(followups), 'follow-up panel clears prior-company people before reloading');

check(pipeline.includes('This is a message I sent or received'), 'application notes include the message control');
check(pipeline.includes('`/api/applications/${app.id}/messages`') && pipeline.includes('`/api/notes/${app.id}`'), 'application drawer keeps note posts and adds message posts');
check(/messagePeopleGenerationRef\.current\s*===\s*generation/.test(pipeline), 'application drawer people fetch ignores stale responses');

check(review.includes('/api/people/by-company/'), 'Gmail reply review loads company people');
const unmatchedStart = review.indexOf('function UnmatchedList');
const unmatchedSource = unmatchedStart > -1 ? review.slice(unmatchedStart) : '';
check(/contact:\s*reviewContact\(person\)/.test(unmatchedSource), 'unmatched Attach includes the selected contact');
check(/const company = app\?\.company \|\| item\.company/.test(unmatchedSource), "unmatched replies fetch people from the item's company fallback");
check(/peopleGenerationRef\.current\s*===\s*generation/.test(review), 'reply-row people fetch ignores stale responses');
check(/setPersonRef\(''\);\s*setPeople\(\[\]\)/.test(review), 'reply row clears prior-application people before reloading');

console.log(`person-picker-ui: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

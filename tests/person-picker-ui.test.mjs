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
const replyStart = review.indexOf('function ReplyRow');
const unmatchedStart = review.indexOf('function UnmatchedList');
const newPersonStart = review.indexOf('function NewPersonCard');
const replySource = replyStart > -1 && unmatchedStart > replyStart ? review.slice(replyStart, unmatchedStart) : '';
const unmatchedSource = unmatchedStart > -1 ? review.slice(unmatchedStart) : '';
const newPersonSource = newPersonStart > -1 && replyStart > newPersonStart ? review.slice(newPersonStart, replyStart) : '';
const createAndActStart = replySource.indexOf('const createAndAct');
const createAndActSource = createAndActStart > -1 ? replySource.slice(createAndActStart, replySource.indexOf('return (', createAndActStart)) : '';
const createAndAttachStart = unmatchedSource.indexOf('const createAndAttach');
const createAndAttachSource = createAndAttachStart > -1 ? unmatchedSource.slice(createAndAttachStart, unmatchedSource.indexOf('return (', createAndAttachStart)) : '';
check(/contact:\s*reviewContact\(person\)/.test(unmatchedSource), 'unmatched Attach includes the selected contact');
check(/const company = app\?\.company \|\| item\.company/.test(unmatchedSource), "unmatched replies fetch people from the item's company fallback");
check(/peopleGenerationRef\.current\s*===\s*generation/.test(review), 'reply-row people fetch ignores stale responses');
check(/setPersonRef\(''\);\s*setPeople\(\[\]\)/.test(review), 'reply row clears prior-application people before reloading');
check(review.includes("fetch('/api/people/create'"), 'reply review creates a person through the people endpoint');
check(review.includes('Create and log'), 'reply review shows the create and log action');
check(replySource.includes('<NewPersonCard'), 'ReplyRow uses the shared NewPersonCard');
check(unmatchedSource.includes('<NewPersonCard'), 'UnmatchedList uses the shared NewPersonCard');
check(replySource.includes('<option value="__new__">+ New person</option>'), 'ReplyRow person picker offers a new person');
check(unmatchedSource.includes('<option value="__new__">+ New person</option>'), 'UnmatchedList person picker offers a new person');
check(replySource.includes('res.needsContact'), 'ReplyRow handles a needsContact refusal');
check(/action === 'unmatched'[\s\S]{0,250}fromName:\s*reply\.fromName \|\| ''/.test(replySource), 'ReplyRow sends fromName when parking an unmatched reply');
check(/const actionContact = extra\.contact \|\| contact/.test(replySource), 'ReplyRow accepts extra.contact as a contact override');
check(review.includes('/api/google/history/preview') && review.includes('/api/google/history/backfill'), 'reply review uses the Gmail history preview and backfill endpoints');
check(review.includes('on this card too'), 'new contact history choice explains where earlier emails are logged');
check(/createAndAct\s*=\s*\(\{[^}]*historyMsgIds/.test(createAndActSource), 'createAndAct accepts history message ids');
check(/createAndAttach\s*=\s*\(item,\s*\{[^}]*historyMsgIds/.test(createAndAttachSource), 'createAndAttach accepts history message ids');
check(replySource.includes('searchHistory={fields =>'), 'ReplyRow gives NewPersonCard a history search');
check(unmatchedSource.includes('searchHistory={fields =>'), 'UnmatchedList gives NewPersonCard a history search');
check(createAndActSource.includes('logEarlierEmails({'), 'createAndAct logs selected earlier emails through the shared helper');
check(createAndAttachSource.includes('logEarlierEmails({'), 'createAndAttach logs selected earlier emails through the shared helper');
check(/historyGenerationRef\.current\s*!==\s*generation/.test(newPersonSource), 'NewPersonCard ignores stale history searches');
check(newPersonSource.includes('Search again'), 'NewPersonCard can repeat a history search with current fields');

check(review.includes("item.direction === 'Sent' ? 'Sent' : 'Received'"), 'the history list labels a message by the direction the server sends');
check(!review.includes("item.direction === 'sent'"), 'the history list never compares direction to a lowercase value');

console.log(`person-picker-ui: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

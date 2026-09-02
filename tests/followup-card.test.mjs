import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(join(process.cwd(), 'dashboard-web', 'src', 'connect.jsx'), 'utf8');
let failures = 0;

function check(condition, message) {
  if (condition) console.log(`ok  ${message}`);
  else { console.error(`not ok  ${message}`); failures++; }
}

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} was not found`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} was not complete`);
}

const context = { CONTACTED_STATUSES: new Set(['Sent', 'Replied', 'Meeting Scheduled']) };
vm.createContext(context);
vm.runInContext(`${functionSource('contactBase')}\n${functionSource('isAlreadyInvited')}\n${functionSource('followupChannels')}\nthis.result = { contactBase, isAlreadyInvited, followupChannels };`, context);
const { contactBase, isAlreadyInvited, followupChannels } = context.result;

check(contactBase({ source: 'ta', id: 7012 }) === '/api/target-talent/7012', 'target talent mutations use the target talent book');
check(contactBase({ source: 'referral', id: 7012 }) === '/api/referrals/7012', 'referral mutations use the referrals book');
check(contactBase({ source: 'influencer', id: 7012 }) === null, 'influencers have no correspondence mutation base');
check(contactBase(null) === null, 'missing contacts have no mutation base');

check(isAlreadyInvited({ linkedinStatus: 'Connected' }), 'connected contacts count as already invited');
check(isAlreadyInvited({ status: 'Sent', companyOutreach: {} }), 'sent status counts as already invited');
check(!isAlreadyInvited({ status: 'Not Contacted', companyOutreach: {} }), 'untouched contacts are not already invited');
check(!isAlreadyInvited({ status: 'Not Contacted', companyOutreach: { selfLastTouch: { channel: 'email', date: '2026-08-01', direction: 'Sent' } } }), 'email-only touch is not a LinkedIn invite');
check(!isAlreadyInvited({ status: 'Sent', companyOutreach: { selfLastTouch: { channel: 'email', date: '2026-08-01', direction: 'Sent' } } }), 'email touch with Sent status is not a LinkedIn invite');
check(isAlreadyInvited({ status: 'Not Contacted', companyOutreach: { selfLastTouch: { channel: 'linkedin', date: '2026-08-01', direction: 'Sent' } } }), 'LinkedIn touch counts as already invited');
check(!isAlreadyInvited({ status: 'Not Contacted', companyOutreach: { selfLastTouch: { channel: null, date: '2026-08-01', direction: 'Sent', fromRowStamp: true } } }), 'null channel from row stamp without Sent status is not a LinkedIn invite');
check(isAlreadyInvited({ status: 'Sent', companyOutreach: { selfLastTouch: { channel: null, date: '2026-08-01', direction: 'Sent', fromRowStamp: true } } }), 'null channel with Sent status trusts the status');

check(JSON.stringify(followupChannels({ channel: 'linkedin', linkedin: 'linkedin.com/in/a', email: 'a@example.com' })) === JSON.stringify({ linkedin: true, email: false }), 'LinkedIn only omits email even when an address exists');
check(JSON.stringify(followupChannels({ channel: 'email', linkedin: 'linkedin.com/in/a', email: 'a@example.com' })) === JSON.stringify({ linkedin: false, email: true }), 'email only omits LinkedIn');
check(JSON.stringify(followupChannels({ channel: 'both', linkedin: 'linkedin.com/in/a', email: 'a@example.com' })) === JSON.stringify({ linkedin: true, email: true }), 'both renders both channels');
check(JSON.stringify(followupChannels({ channel: 'both', stickyChannel: true, linkedin: 'linkedin.com/in/a', email: 'a@example.com' })) === JSON.stringify({ linkedin: true, email: false }), 'sticky just connected rows remain LinkedIn only');
check(JSON.stringify(followupChannels({ channel: 'both' })) === JSON.stringify({ linkedin: false, email: false }), 'a contact with neither channel remains renderable');

check((source.match(/function FollowupCard\s*\(/g) || []).length === 1, 'one FollowupCard implementation exists');
check(!/function (ConnectRow|EmailRow|BothRow)\s*\(/.test(source), 'legacy row components are removed');
check((source.match(/`\/api\/target-talent\/\$\{c\.id\}`/g) || []).length === 1, 'the target talent contact URL exists only in contactBase');

if (failures) process.exit(1);
console.log('followup card tests passed');

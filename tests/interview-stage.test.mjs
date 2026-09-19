import { proposeStageFromRole, findRoleLine, proposeStageFromMessage } from '../lib/interview-stage.mjs';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('✅ ' + msg); }
  else { failed++; console.log('❌ ' + msg); }
}

const stageOf = (text) => proposeStageFromRole(text);
check(stageOf('Senior Recruiter').stage === 'Phone Screen' && stageOf('Senior Recruiter').matched === 'recruiter', 'a recruiter is a Phone Screen');
check(stageOf('Talent Acquisition Partner').stage === 'Phone Screen', 'talent acquisition is a Phone Screen');
check(stageOf('Technical Recruiting Manager').stage === 'Phone Screen', 'a recruiting manager is a recruiter, so a Phone Screen');
check(stageOf('Hiring Manager, Example Widget Sales').stage === 'Interview' && stageOf('Hiring Manager, Example Widget Sales').matched === 'hiring manager', 'a hiring manager is an Interview');
check(stageOf('Director of Example Ratchet Operations').stage === 'Interview', 'a director is an Interview');
check(stageOf('VP of Sales').stage === 'Interview', 'a VP is an Interview');
check(stageOf('Panel interview').stage === 'Interview', 'a panel is an Interview');
check(stageOf('recruiter on the panel').stage === null && stageOf('recruiter on the panel').needs_owner === true, 'recruiter plus panel is unclear, so ask the owner');
check(stageOf('').stage === null && stageOf('').needs_owner === true, 'an empty role asks the owner');
check(stageOf(undefined).needs_owner === true && stageOf(42).needs_owner === true, 'a missing or non-string role asks the owner');
check(stageOf('Associate Example Widget Analyst').stage === null && stageOf('Associate Example Widget Analyst').needs_owner === true, 'a title with no keyword asks the owner');
check(['Senior Recruiter', 'VP of Sales', 'Panel interview'].every((t) => stageOf(t).needs_owner === false), 'a proposed stage never asks the owner');

const body = ['Hi Example Personone,', 'Looking forward to it.', 'Best,', 'Example Personone', 'Senior Recruiter', 'Zorblax Widgetry'].join('\n');
check(findRoleLine(body) === 'Senior Recruiter', 'the role line is found in the signature');
check(findRoleLine(body.replace(/\n/g, '\r\n')) === 'Senior Recruiter', 'CRLF line endings give the same role line');
check(findRoleLine('recruiter ' + 'x'.repeat(200)) === null, 'a long paragraph is not a role line');
const far = ['Senior Recruiter', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
check(findRoleLine(far) === null, 'a title more than 8 non-empty lines from the end is ignored');
const near = ['Hiring Manager', 'x', 'Senior Recruiter', 'Zorblax Widgetry'].join('\n');
check(findRoleLine(near) === 'Senior Recruiter', 'the matching line nearer the end wins');
check(findRoleLine('') === null && findRoleLine(null) === null && findRoleLine(42) === null, 'empty or non-string text has no role line');

const fromBody = proposeStageFromMessage(body);
check(fromBody.role_line === 'Senior Recruiter' && fromBody.stage === 'Phone Screen' && fromBody.needs_owner === false, 'a message proposes the stage from its signature');
const noTitle = proposeStageFromMessage('Hi Example Personone,\nSee you then.\nBest,\nQuennox Ratchet Works');
check(noTitle.role_line === null && noTitle.stage === null && noTitle.needs_owner === true, 'a message with no title asks the owner');

console.log(`interview-stage: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

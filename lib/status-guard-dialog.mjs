/**
 * E-5: plain words for a status guard verdict (lib/status-guards.mjs). Pure; nothing here reads or writes a
 * file. The server adds the result to its answers so the screen only has to show it.
 *
 * dialogFor(verdict, company) returns { kind, text, needsDate }:
 *   proceed          nothing to ask
 *   ask_phone_date   the person may enter the date the employer said no by phone (needsDate is true)
 *   read_first       employer messages exist; they are listed and the change is not offered
 *   confirm_by_hand  the person has to choose No Response themselves
 *   use_other        another status is offered instead (verdict.suggest)
 *   blocked          anything else
 */

const PHONE_INVITATION = ' If they told you no by phone, enter the date as YYYY-MM-DD. Otherwise cancel.';

const PHONE_OPENINGS = {
  no_employer_evidence: (company) => `No rejection from ${company} is on record.`,
  future_phone_date: () => 'That date is in the future.',
  invalid_phone_date: () => 'That is not a real date.',
};

export function dialogFor(verdict, company = 'this employer') {
  if (!verdict) return { kind: 'blocked', text: 'This change is not allowed.', needsDate: false };
  if (verdict.allowed === true) return { kind: 'proceed', text: '', needsDate: false };

  const messages = Array.isArray(verdict.show_first) ? verdict.show_first : [];

  if (verdict.reason in PHONE_OPENINGS) {
    let text = PHONE_OPENINGS[verdict.reason](company) + PHONE_INVITATION;
    if (messages.length > 0) text += ` Read the ${messages.length} message${messages.length === 1 ? '' : 's'} from them first.`;
    return { kind: 'ask_phone_date', text, needsDate: true };
  }

  if (verdict.reason === 'employer_message_exists') {
    const lines = messages.map((m) => `\n${m.sent_on} ${m.subject ?? ''}`.trimEnd()).join('');
    return { kind: 'read_first', text: `${company} has written since you applied. Read it before you mark No Response:${lines}`, needsDate: false };
  }

  if (verdict.reason === 'must_be_set_by_hand') {
    return { kind: 'confirm_by_hand', text: `Mark ${company} as No Response yourself?`, needsDate: false };
  }

  if (verdict.reason === 'withdrawal_is_not_rejection' && verdict.suggest) {
    return { kind: 'use_other', text: `Use ${verdict.suggest} instead.`, needsDate: false };
  }

  return { kind: 'blocked', text: 'This change is not allowed.', needsDate: false };
}

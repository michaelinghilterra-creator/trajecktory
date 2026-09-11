// Load dashboard-web/.env and resolve every project/data path before any server
// library is imported. Every v2 module imports this bootstrap first.
export const config = await import('../../dashboard-web/server/config.mjs');

export async function loadHarnessModules() {
  const [targetTalent, referrals, influence, personContext, thread, linkedin,
    statuses, applications, research, anthropic, profile, followups] = await Promise.all([
    import('../../dashboard-web/server/lib/target-talent.mjs'),
    import('../../dashboard-web/server/lib/referrals.mjs'),
    import('../../lib/influence-tier.mjs'),
    import('../../dashboard-web/server/lib/person-context.mjs'),
    import('../../dashboard-web/server/lib/correspondence-context.mjs'),
    import('../../dashboard-web/server/lib/tt-linkedin.mjs'),
    import('../../dashboard-web/server/lib/statuses.mjs'),
    import('../../dashboard-web/server/lib/applications.mjs'),
    import('../../dashboard-web/server/lib/report-research.mjs'),
    import('../../dashboard-web/server/lib/anthropic.mjs'),
    import('../../dashboard-web/server/lib/profile.mjs'),
    import('../../dashboard-web/server/lib/followups.mjs'),
  ]);
  return {
    ...targetTalent, ...referrals, ...influence, ...personContext, ...thread,
    ...linkedin, ...statuses, ...applications, ...research, ...anthropic, ...profile, ...followups,
  };
}

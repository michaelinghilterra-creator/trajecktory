// Network Module — the consolidated home for the three 1:1 contact channels.
// Referrals, Recruiters, and TA Outreach are the same interaction model (a
// contact list + a status ladder + AI-drafted messages), so they live under one
// parent instead of three sibling top-level tabs. Ordered by warmth: Referrals
// (your own network, highest-yield per the post-mortem) is first and the default.
//
// This is a thin shell — it renders a subtab bar and hands off to the existing
// ReferralsTab / RecruitersTab / TargetTalentTab components unchanged. Recruiters
// keeps its own internal subtabs, so on that subtab you'll see two rows of nav
// (section + module); that's the accepted cost of grouping.
(function () {

const NET_SUBTABS = [
  { id: 'referrals',  label: 'Referrals' },
  { id: 'ta',         label: 'TA Outreach' },
  { id: 'recruiters', label: 'Recruiters' },
];

// "High value" (a contact reachable both ways: verified email + LinkedIn) used to
// be its own directory tab here. It is now a per-contact star + filter on the TA
// and Recruiter tables (isHighValue on the list rows), so there is no separate page
// and no second place a contact lives. Working these still happens in Follow-Ups.

window.NetworkTab = function NetworkTab({ view, setView, search, pendingTaOpen, onTaOpenConsumed, pendingRecruiterOpen, onRecruiterOpenConsumed, openTaContact, openRecruiter, toast } = {}) {
  // Fall back to referrals for an unknown/stale view (e.g. a persisted 'highvalue'
  // from before that tab was removed), so the pane is never blank.
  const active = NET_SUBTABS.some(s => s.id === view) ? view : 'referrals';
  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="subtabs">
        {NET_SUBTABS.map(s => (
          <button type="button" key={s.id} className={'subtab' + (active === s.id ? ' active' : '')} onClick={() => setView(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {active === 'referrals'  && window.ReferralsTab && <window.ReferralsTab search={search} />}
      {active === 'recruiters' && window.RecruitersTab && <window.RecruitersTab search={search} initialOpenId={pendingRecruiterOpen} onInitialOpenConsumed={onRecruiterOpenConsumed} />}
      {active === 'ta'         && window.TargetTalentTab && (
        <window.TargetTalentTab
          initialOpenId={pendingTaOpen}
          onInitialOpenConsumed={onTaOpenConsumed}
          search={search}
        />
      )}
    </div>
  );
};

})();

// Network: follow-up work and the three contact books.
(function () {
const NET_SUBTABS = [
  { id: 'followups', label: 'Follow-ups' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'ta', label: 'TA Outreach' },
  { id: 'influencers', label: 'Influencers' },
];

window.NetworkTab = function NetworkTab({ view, setView, search, pendingTaOpen, onTaOpenConsumed, openTaContact, apps, onAction, toast } = {}) {
  const active = NET_SUBTABS.some(s => s.id === view) ? view : 'followups';
  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="subtabs" style={{ alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {NET_SUBTABS.map(s => (
          <button type="button" key={s.id} className={'subtab' + (active === s.id ? ' active' : '')} onClick={() => setView(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {active === 'followups' && window.FollowupsTab && <window.FollowupsTab chromeless apps={apps} onAction={onAction} openTaContact={openTaContact} search={search} toast={toast} />}
      {active === 'referrals' && window.ReferralsTab && <window.ReferralsTab search={search} />}
      {active === 'ta' && window.TargetTalentTab && <window.TargetTalentTab initialOpenId={pendingTaOpen} onInitialOpenConsumed={onTaOpenConsumed} search={search} />}
      {active === 'influencers' && window.InfluencersView && <window.InfluencersView />}
    </div>
  );
};

})();

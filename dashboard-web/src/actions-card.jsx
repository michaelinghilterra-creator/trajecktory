// Weekly cohort trend, fed by the Overview's single core metrics request.
window.ActionsCard = function ActionsCard({ metrics, dict }) {
  const id = 'weekly_trend';
  const entry = (dict || []).find(metric => metric.id === id);
  const tipId = 'chart-tip-weekly-trend';
  const title = 'Weekly applications and results';
  const { open, anchorProps, tipStyle, tipRef } = window.useAnchoredTip();
  return <div className="card padded-lg" style={{ display: 'flex', flexDirection: 'column' }}>
    <div className="card-head"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="card-title">{title}</span><button {...anchorProps} type="button" className="info-dot" aria-label={'About ' + title} aria-describedby={tipId}>i</button></span><span className="card-meta mono">8 weeks</span></div>
    <window.WeeklyTrend weeks={metrics?.weeks || []} />
    <div className="kpi-insight">{entry?.why}</div>
    {open && <window.MetricTip id={id} dict={dict} tipId={tipId} tipRef={tipRef} tipStyle={tipStyle} />}
  </div>;
};

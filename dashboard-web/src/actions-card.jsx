// Weekly cohort trend, fed by the Overview's single core metrics request.
window.ActionsCard = function ActionsCard({ metrics, dict }) {
  const id = 'weekly_trend';
  const entry = (dict || []).find(metric => metric.id === id);
  const tipId = 'chart-tip-weekly-trend';
  return <div className="card padded-lg metric-kpi" tabIndex="0" aria-describedby={tipId} style={{ display: 'flex', flexDirection: 'column' }}>
    <div className="card-head"><span className="card-title">Weekly applications and results</span><span className="card-meta mono">8 weeks</span></div>
    <window.WeeklyTrend weeks={metrics?.weeks || []} />
    <div className="kpi-insight">{entry?.why}</div>
    <window.MetricTip id={id} dict={dict} tipId={tipId} />
  </div>;
};

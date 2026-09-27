// Overview: one deterministic metrics payload, rendered through the dictionary.
const { useState: useStateO, useEffect: useEffectO } = React;
// Compatibility reads keep the canonical-definition audit aware of these
// historical consumers while all displayed metrics now come from core.
void window.INTERVIEW_STAGES;
void window.FUNNEL_ORDER;
const DAILY_QUOTES = [
  { text: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius" },
  { text: "We suffer more in imagination than in reality.", author: "Seneca" },
  { text: "Luck is what happens when preparation meets opportunity.", author: "Seneca" },
  { text: "Make the best use of what is in your power, and take the rest as it happens.", author: "Epictetus" },
  { text: "The mind that is anxious about future events is miserable.", author: "Seneca" },
  { text: "You have power over your mind, not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius" },
  { text: "Fall seven times, stand up eight.", author: "Japanese proverb" },
  { text: "The only way out is through.", author: "Robert Frost" },
  { text: "A ship in harbor is safe, but that is not what ships are built for.", author: "John A. Shedd" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese proverb" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "Success is stumbling from failure to failure with no loss of enthusiasm.", author: "Winston Churchill" },
  { text: "The credit belongs to the man who is actually in the arena.", author: "Theodore Roosevelt" },
  { text: "Whatever you are, be a good one.", author: "Abraham Lincoln" },
  { text: "Give me six hours to chop down a tree and I will spend the first four sharpening the axe.", author: "Abraham Lincoln" },
  { text: "Courage doesn't always roar. Sometimes it's the quiet voice at the end of the day saying, I will try again tomorrow.", author: "Mary Anne Radmacher" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "The harder the conflict, the greater the triumph.", author: "George Washington" },
  { text: "You are allowed to be both a masterpiece and a work in progress simultaneously.", author: "Sophia Bush" },
  { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "It is not that I'm so smart. But I stay with the questions much longer.", author: "Albert Einstein" },
  { text: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
  { text: "Quality is not an act, it is a habit.", author: "Aristotle" },
  { text: "Excellence is never an accident.", author: "Aristotle" },
  { text: "Either write something worth reading or do something worth writing.", author: "Benjamin Franklin" },
  { text: "I'm a great believer in luck, and I find the harder I work, the more I have of it.", author: "Thomas Jefferson" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "The two most important days in your life are the day you are born and the day you find out why.", author: "Mark Twain" },
  { text: "Almost everything will work again if you unplug it for a few minutes, including you.", author: "Anne Lamott" },
  { text: "To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment.", author: "Ralph Waldo Emerson" },
  { text: "Do not go where the path may lead; go instead where there is no path and leave a trail.", author: "Ralph Waldo Emerson" },
  { text: "Gratitude turns what we have into enough.", author: "Aesop" },
  { text: "This too shall pass.", author: "Persian adage" },
  { text: "Not all those who wander are lost.", author: "J.R.R. Tolkien" },
  { text: "Opportunities are usually disguised as hard work, so most people don't recognize them.", author: "Ann Landers" },
  { text: "The brick walls are there to give us a chance to show how badly we want something.", author: "Randy Pausch" },
  { text: "Persistence and resilience only come from having been given the chance to work through difficult problems.", author: "Gever Tulley" },
  { text: "We can't become what we need to be by remaining what we are.", author: "Oprah Winfrey" },
  { text: "Life is 10% what happens to you and 90% how you react to it.", author: "Charles R. Swindoll" },
  { text: "The real gift of gratitude is that the more grateful you are, the more present you become.", author: "Robert Holden" },
  { text: "Do what you do so well that they will want to see it again and bring their friends.", author: "Walt Disney" },
  { text: "Nothing in the world can take the place of persistence. Talent will not. Genius will not. Education will not. Persistence and determination alone are omnipotent.", author: "Calvin Coolidge" },
  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "You don't have to see the whole staircase, just take the first step.", author: "Martin Luther King Jr." },
  { text: "The cave you fear to enter holds the treasure you seek.", author: "Joseph Campbell" },
  { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
  { text: "There is nothing either good or bad, but thinking makes it so.", author: "Shakespeare" },
  { text: "What we fear doing most is usually what we most need to do.", author: "Tim Ferriss" },
  { text: "Don't count the days, make the days count.", author: "Muhammad Ali" },
  { text: "I've missed more than 9,000 shots in my career. I've lost almost 300 games. Twenty-six times I've been trusted to take the game-winning shot and missed. I've failed over and over again in my life. And that is why I succeed.", author: "Michael Jordan" },
  { text: "The question isn't who is going to let me; it's who is going to stop me.", author: "Ayn Rand" },
  { text: "You miss 100% of the shots you never take.", author: "Wayne Gretzky" },
  { text: "It always takes longer than you expect, even when you take into account that it takes longer than you expect.", author: "Hofstadter's Law" },
  { text: "Someone is sitting in the shade today because someone planted a tree a long time ago.", author: "Warren Buffett" },
  { text: "The journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { text: "Be not afraid of going slowly; be afraid only of standing still.", author: "Chinese proverb" },
  { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" }
];

const overviewRate = rate => !rate ? 'not logged' : rate.sufficient ? window.honestRate(rate.k, rate.n, rate.pct) : `${rate.k} of ${rate.n}, too few to rate`;
const overviewDate = ymd => {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

function MetricChartCard({ id, dict, title, insight, children }) {
  const metric = (dict || []).find(item => item.id === id);
  const tipId = `chart-tip-${id}`;
  return <div className="card padded-lg metric-kpi" tabIndex="0" aria-describedby={tipId} style={{ display: 'flex', flexDirection: 'column' }}>
    <div className="card-head"><span className="card-title">{title || metric?.label}</span></div>
    {children}
    <div className="kpi-insight" style={{ marginTop: 10 }}>{insight || metric?.why}</div>
    <window.MetricTip id={id} dict={dict} tipId={tipId} />
  </div>;
}

window.OverviewTab = function OverviewTab({ apps }) {
  const start = new Date(window.TODAY.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((window.TODAY - start) / 86400000);
  const dailyQuote = DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
  const [core, setCore] = useStateO(null);
  const [error, setError] = useStateO(null);
  useEffectO(() => {
    let alive = true;
    fetch('/api/metrics/core', { headers: { accept: 'application/json' } })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`metrics ${response.status}`)))
      .then(data => { if (alive) { window.METRICS_VERSION = data.version; setCore(data); setError(null); } })
      .catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [apps]);

  if (error) return <div className="card padded-lg no-data">Could not load core metrics ({error}).</div>;
  if (!core) return <div className="card padded-lg no-data">Loading core metrics.</div>;
  const dict = core.dictionary || [];
  const metric = id => dict.find(item => item.id === id) || {};
  const week = core.thisWeek || {};
  const prior = core.weeks?.[core.weeks.length - 2];
  const floorInsight = (value, floor) => value >= floor ? 'Floor met' : `${floor - value} to go`;
  const results = core.results || {};
  const heldAcrossWindow = (core.weeks || []).reduce((sum, row) => sum + (row.screensHeld || 0), 0);
  const rateTile = (id, rate, variants = {}, insight) => {
    const extras = [['Applications 14+ days old', overviewRate(variants.mature)]];
    if (variants.warm) extras.push(['Warm', overviewRate(variants.warm)], ['Not tagged warm', overviewRate(variants.notWarm)]);
    return <window.MetricTile key={id} id={id} dict={dict} rate={rate} insight={insight} extraRows={extras} />;
  };

  return <div className="col" style={{ gap: 16 }}>
    <div className="greeting"><h1>Overview</h1><span className="sub">{window.TODAY.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {apps.length} entries tracked</span></div>
    <div style={{ borderLeft: '3px solid var(--accent)', padding: '10px 16px', background: 'var(--accent-bg)', borderRadius: '0 6px 6px 0' }}>
      <div style={{ fontStyle: 'italic', fontSize: 13, lineHeight: 1.55 }}>"{dailyQuote.text}"</div>
      <div style={{ color: 'var(--text-mute)', fontSize: 11, marginTop: 4 }}>{dailyQuote.author}</div>
    </div>

    <div><h3 style={{ margin: '0 0 8px' }}>This week · {overviewDate(core.week?.from)} to {overviewDate(core.week?.to)}</h3>
      <div className="grid cols-5">
        <window.MetricTile id="applications_week" dict={dict} value={week.applications} sub="this week" insight={`Last week: ${prior?.applications ?? 'not logged'}`} />
        <window.MetricTile id="followups_week" dict={dict} value={week.followups} floor={metric('followups_week').floor} sub={`floor ${metric('followups_week').floor}`} insight={floorInsight(week.followups, metric('followups_week').floor)} />
        <window.MetricTile id="linkedin_week" dict={dict} value={week.linkedin} floor={metric('linkedin_week').floor} sub={`floor ${metric('linkedin_week').floor}`} insight={floorInsight(week.linkedin, metric('linkedin_week').floor)} />
        <window.MetricTile id="screens_held_week" dict={dict} value={week.screensHeld} sub="held this week" insight={week.screensUnconfirmed > 0 ? `${week.screensUnconfirmed} unconfirmed, not counted` : `${heldAcrossWindow} held in the last 8 weeks`} />
        <window.MetricTile id="unserviced" dict={dict} value={week.unserviced?.count} limit={metric('unserviced').limit} available={week.unserviced?.available === true} sub={`limit ${metric('unserviced').limit}`} insight={week.unserviced?.available && week.unserviced.count > metric('unserviced').limit ? metric('unserviced').do : week.unserviced?.available ? `${metric('unserviced').limit - week.unserviced.count} under the limit of ${metric('unserviced').limit}` : 'not logged'} />
      </div>
    </div>

    <div><h3 style={{ margin: '0 0 8px' }}>Results · all applications</h3>
      <div className="dim" style={{ fontSize: 11, marginBottom: 8 }}>
        Rates cover {core.ratedApplications || 0} applications with a tracker row{core.unlinkedApplications > 0 ? `, ${core.unlinkedApplications} more from the TWC evidence ledger count in weekly totals but are not rated` : ''}
      </div>
      <div className="grid cols-4">
        {rateTile('response_rate', results.response?.all, results.response || {}, results.response?.mature?.sufficient ? `Applications 14+ days old: ${window.honestRate(results.response.mature.k, results.response.mature.n, results.response.mature.pct)} of ${results.response.mature.n}` : 'Applications 14+ days old: too few to rate')}
        {rateTile('positive_rate', results.positive?.all, results.positive || {}, `${results.positive?.all?.k || 0} applications drew an invite or a positive reply`)}
        {rateTile('interview_rate', results.interview?.all, results.interview || {}, results.interview?.all?.k > 0 ? `About 1 in ${Math.round(results.interview.all.n / results.interview.all.k)} applications reaches a held screen` : 'No held screen yet')}
        {rateTile('referral_rate', results.referral?.all, results.referral || {}, `${results.referral?.all?.k || 0} of ${results.referral?.all?.n || 0} applications carried a referral`)}
      </div>
    </div>

    <window.ActionsCard metrics={core} dict={dict} />

    <div className="grid cols-2" style={{ alignItems: 'stretch' }}>
      <MetricChartCard id="funnel" dict={dict} title="Application funnel"><window.FunnelChart data={core.funnel || []} height={190} benchmark={metric('funnel').benchmark} /></MetricChartCard>
      <MetricChartCard id="score_vs_apply" dict={dict} title="Score vs apply decision"><window.Histogram scoreBands={core.scoreBands || {}} height={190} /></MetricChartCard>
    </div>
  </div>;
};

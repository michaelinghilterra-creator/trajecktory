// customize.jsx — post-onboarding customization panel (Setup -> Customize).
//
// Shows a card for each of the 11 customization sections with a status
// indicator (configured vs. still at defaults) and a copy-prompt action
// that gives the user a focused prompt for their AI agent.
const { useState, useEffect, useCallback } = React;

const PROMPTS = {
  scoring: `Help me customize my scoring priorities and deal-breakers in trajecktory.

I'd like to adjust which evaluation dimensions matter most for my search, and set up hard deal-breakers that auto-reject roles regardless of score.

Ask me what matters most (skills fit, dream role alignment, seniority match, compensation, location) and what my deal-breakers are, then update config/profile.yml and modes/_profile.md for me.`,

  'outreach-stakeholders': `Help me customize my outreach stakeholders and messaging in trajecktory.

The outreach sequences and negotiation scripts may not match my field's decision-makers. Ask me who the hiring decision-makers are for my target roles, what my elevator pitch is, and update templates/outreach-sequences.json and modes/_profile.md accordingly.`,

  voice: `Help me customize my voice and achievement framing in trajecktory.

I want the system to match my professional tone and lead with my strongest proof points per archetype. Ask me about my preferred voice, any phrases I want to avoid, and my best achievement for each target archetype. Then fill in the Adaptive Framing table in modes/_profile.md.`,

  narrative: `Help me customize my narrative and branding in trajecktory.

I need a strong professional headline, my top superpowers, and a compelling exit story. Ask me about these and update the narrative block in config/profile.yml.`,

  exit: `Help me customize my exit narrative and sensitive framing in trajecktory.

I may have short tenures, career gaps, or other aspects that need careful framing. Ask me about anything in my background that needs positioning, and what makes me uniquely different. Then update the Exit Narrative and Cross-cutting Advantage sections in modes/_profile.md.`,

  stories: `Help me build my interview story bank in trajecktory.

I need 3-5 strong STAR+R stories for behavioral interviews. Ask me about my best professional achievements and help me structure them. Write them to interview-prep/story-bank.md with behavioral theme tags.`,

  'search-queries': `Help me customize my search queries in trajecktory.

I want to make sure the scanner finds roles that match my field. Ask me what search terms I'd use to find my ideal job postings, then update the search_queries section in portals.yml.`,

  geo: `Help me customize my geographic pre-filter in trajecktory.

I need to set my home location, commute radius, and approved metro areas so the scanner only surfaces roles I'd actually consider. Ask me about my location preferences and update portals.yml and config/profile.yml.`,

  social: `Help me set up my social and content strategy in trajecktory.

Ask me about my LinkedIn presence, content themes, published work, and platform strategy. Then add a Social & Content Strategy section to modes/_profile.md and update article-digest.md if I have published work.`,

  cadence: `Help me customize my outreach cadence in trajecktory.

I want to adjust how aggressively follow-ups are sent. Ask me about my preferred spacing between touches, cold outreach caps, and per-company limits. Then update the outreach block in config/profile.yml.`,

  portfolio: `Help me set up my article digest and portfolio in trajecktory.

I want to add proof points from my published work, case studies, or projects so they're referenced in cover letters and evaluations. Ask me about my notable work with measurable outcomes and create article-digest.md.`,
};

const GROUP_LABELS = { core: 'Core (recommended order)', enhance: 'Enhancements' };

function CustomizeCard({ section, onCopy }) {
  const configured = section.status === 'configured';
  const dot = configured
    ? { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', text: 'Configured' }
    : { bg: 'rgba(234,179,8,0.12)', color: '#eab308', text: 'At defaults' };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-mute)', minWidth: 18 }}>{section.order}.</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{section.label}</span>
        </div>
        <span className="pill" style={{ borderColor: dot.color, color: dot.color, background: dot.bg, fontSize: 10 }}>{dot.text}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{section.desc}</div>
      <div style={{ fontSize: 11, color: 'var(--text-mute)', fontFamily: 'var(--mono, monospace)' }}>
        {section.files.join(' + ')}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn sm" onClick={() => onCopy(section.id)} title="Copy a prompt to paste into your AI agent">
          Copy prompt
        </button>
      </div>
    </div>
  );
}

window.CustomizePanel = function CustomizePanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    fetch('/api/setup/customize')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setData)
      .catch(() => setErr(true));
  }, []);

  const handleCopy = useCallback((id) => {
    const prompt = PROMPTS[id];
    if (!prompt) return;
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(c => c === id ? null : c), 2000);
    }).catch(() => {});
  }, []);

  if (err) return <div style={{ padding: 24, color: 'var(--text-mute)' }}>Could not load customization status.</div>;
  if (!data) return <div style={{ padding: 24, color: 'var(--text-mute)' }}>Loading...</div>;

  const core = data.sections.filter(s => s.group === 'core');
  const enhance = data.sections.filter(s => s.group === 'enhance');
  const pct = Math.round((data.configured / data.total) * 100);
  const barColor = pct >= 80 ? '#22c55e' : pct >= 40 ? '#eab308' : '#f85149';

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: 20, maxWidth: 720 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Customize trajecktory
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 12 }}>
          The Launchpad handled the basics. These sections make evaluations, cover letters, and outreach genuinely yours.
          Copy a prompt and paste it into your AI agent to walk through any section.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: barColor, transition: 'width 0.3s' }} />
          </div>
          <span className="mono" style={{ fontSize: 12, color: barColor }}>{data.configured}/{data.total}</span>
        </div>
      </div>

      {copied && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6, maxWidth: 720,
          background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
          fontSize: 12, color: '#22c55e',
        }}>
          Prompt copied. Paste it into Claude Code or your AI agent.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        {[['core', core], ['enhance', enhance]].map(([group, items]) => (
          <div key={group}>
            <div className="card-title" style={{ marginBottom: 10 }}>{GROUP_LABELS[group]}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map(s => <CustomizeCard key={s.id} section={s} onCopy={handleCopy} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

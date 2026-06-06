type Props = {
  teamFeedback?: string | null;
};

export default function TeamMarkSummary({ teamFeedback }: Props) {
  const text = String(teamFeedback || "").trim();
  if (!text) return null;

  return (
    <div className="team-mark-summary">
      <div className="team-mark-overall-label">Your team feedback</div>
      <p className="team-mark-fb">{text}</p>
    </div>
  );
}

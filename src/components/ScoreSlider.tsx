type Props = {
  label: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
};

export default function ScoreSlider({ label, max, value, onChange }: Props) {
  const score = Number.isFinite(value) ? value : 0;

  return (
    <div className="score-slider">
      <div className="score-slider-head">
        <span className="score-slider-label">{label}</span>
        <span className="score-slider-value">
          <strong>{score}</strong>
          <span className="text-muted"> / {max}</span>
        </span>
      </div>
      <input
        type="range"
        className="range"
        min={0}
        max={max}
        step={1}
        value={score}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} score`}
      />
      <div className="range-ticks">
        <span>0</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

import { useState } from "react";
import ScoreSlider from "./ScoreSlider";

type Props = {
  label: string;
  max: number;
  score: number;
  feedback: string;
  onScore: (n: number) => void;
  onFeedback: (text: string) => void;
};

export default function CriterionField({
  label,
  max,
  score,
  feedback,
  onScore,
  onFeedback,
}: Props) {
  const [open, setOpen] = useState(Boolean(feedback.trim()));

  return (
    <div className="criterion-block">
      <ScoreSlider label={label} max={max} value={score} onChange={onScore} />
      <button
        type="button"
        className="btn-feedback-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? "Hide optional feedback" : "Add optional feedback"}
      </button>
      {open && (
        <textarea
          className="textarea textarea-sm"
          value={feedback}
          onChange={(e) => onFeedback(e.target.value)}
          placeholder={`Optional notes for ${label}`}
          rows={3}
        />
      )}
    </div>
  );
}

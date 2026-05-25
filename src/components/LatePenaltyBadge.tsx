type Props = {
  penalty: number;
  className?: string;
  style?: React.CSSProperties;
};

export default function LatePenaltyBadge({ penalty, className = "", style }: Props) {
  const n = Number(penalty) || 0;
  if (n <= 0) return null;
  return (
    <span
      className={`badge badge-late ${className}`.trim()}
      style={style}
      title="Late submission penalty"
    >
      Late −{n}
    </span>
  );
}

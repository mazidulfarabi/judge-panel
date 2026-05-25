type Props = {
  label?: string;
};

export default function LoadingSpinner({ label }: Props) {
  return (
    <div className="loading" role="status" aria-live="polite" aria-busy="true">
      <div className="loading-spinner" aria-hidden />
      {label ? <span className="loading-label">{label}</span> : null}
    </div>
  );
}

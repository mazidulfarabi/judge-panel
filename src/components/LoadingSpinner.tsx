type Props = {
  label?: string;
  variant?: "block" | "banner";
};

export default function LoadingSpinner({ label, variant = "block" }: Props) {
  return (
    <div
      className={variant === "banner" ? "loading-banner" : "loading"}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="loading-spinner" aria-hidden />
      {label ? <span className="loading-label">{label}</span> : null}
    </div>
  );
}

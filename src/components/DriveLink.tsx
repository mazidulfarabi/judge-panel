type Props = {
  href: string;
  label?: string;
  className?: string;
};

export default function DriveLink({ href, label = "Open slides in new tab", className = "btn btn-outline" }: Props) {
  if (!href?.trim()) {
    return <span className="text-muted">No link available</span>;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {label}
    </a>
  );
}

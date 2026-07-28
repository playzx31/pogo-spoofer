import type { ReactNode } from "react";

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`} style={{ display: "flex", flexDirection: "column" }}>
      {title && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <span className="panel-title">{title}</span>
          {action}
        </header>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </section>
  );
}

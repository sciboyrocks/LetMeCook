export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden" style={{ background: "#080809" }}>
      {/* Blobs */}
      <div className="animate-blob absolute -top-32 -left-32 h-[520px] w-[520px] rounded-full blur-[100px]" style={{ background: "radial-gradient(circle, rgba(249,115,22,0.22) 0%, transparent 70%)" }} />
      <div className="animate-blob animation-delay-2 absolute -bottom-32 -right-24 h-[480px] w-[480px] rounded-full blur-[100px]" style={{ background: "radial-gradient(circle, rgba(234,88,12,0.2) 0%, transparent 70%)" }} />
      <div className="animate-blob animation-delay-4 absolute top-1/3 right-1/4 h-80 w-80 rounded-full blur-[80px]" style={{ background: "radial-gradient(circle, rgba(251,191,36,0.12) 0%, transparent 70%)" }} />
      <div className="animate-blob animation-delay-6 absolute bottom-1/3 left-1/4 h-72 w-72 rounded-full blur-[80px]" style={{ background: "radial-gradient(circle, rgba(220,38,38,0.1) 0%, transparent 70%)" }} />
      {/* Grid lines */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Center vignette */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 40%, rgba(8,8,9,0.8) 100%)" }} />
      <div className="relative z-10 flex w-full items-center justify-center">{children}</div>
    </div>
  );
}

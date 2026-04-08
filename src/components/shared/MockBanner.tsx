export default function MockBanner() {
  return (
    <div style={{
      background: "rgba(245,158,11,0.08)",
      border: "1px solid rgba(245,158,11,0.25)",
      borderRadius: 8,
      padding: "9px 16px",
      marginBottom: 20,
      display: "flex",
      alignItems: "center",
      gap: 10,
    }}>
      <span style={{ fontSize: 14 }}>⚠️</span>
      <div>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b" }}>
          Demo Mode — showing mock data.
        </span>
        <span style={{ fontSize: 12, color: "#8892a4", marginLeft: 6 }}>
          Add your Amazon Ads credentials to{" "}
          <code style={{
            background: "#1c2333", padding: "1px 5px",
            borderRadius: 3, fontSize: 11, color: "#e2e8f0",
          }}>
            .env.local
          </code>{" "}
          to connect live data.
          {" "}
          <a
            href="https://advertising.amazon.com/API/docs/en-us/onboarding/overview"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#6366f1", textDecoration: "none" }}
          >
            Setup guide →
          </a>
        </span>
      </div>
    </div>
  );
}

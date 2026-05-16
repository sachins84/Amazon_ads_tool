"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "@/lib/account-context";
import { useTheme } from "@/lib/theme";

const tabs = [
  { label: "Master Overview",   href: "/master-overview"   },
  { label: "Targeting 360",     href: "/targeting-360"     },
  { label: "Rules",             href: "/rules"             },
  { label: "Suggestions",       href: "/suggestions"       },
  { label: "Brand Analytics",   href: "/brand-analytics"   },
];

export default function TopNav() {
  const path = usePathname();
  const router = useRouter();
  const { accounts, activeAccount, setActiveAccountId, loading } = useAccount();
  const { theme, toggle } = useTheme();

  function handleAccountChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setActiveAccountId(e.target.value);
    // Refresh current page so data reloads for the new account
    router.refresh();
  }

  return (
    <header
      style={{
        background: "var(--bg-card)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        height: 56,
        padding: "0 24px",
        gap: 32,
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 8 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          A
        </div>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", letterSpacing: "-0.3px" }}>
          Amazon<span style={{ color: "var(--accent)" }}>Ads</span>
        </span>
      </div>

      {/* Tabs */}
      <nav style={{ display: "flex", gap: 4, flex: 1 }}>
        {tabs.map((tab) => {
          const active = path === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                background: active ? "var(--bg-input)" : "transparent",
                textDecoration: "none",
                transition: "all 0.15s",
                borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* Right controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Account switcher */}
        {!loading && (
          accounts.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Color dot for active account */}
              {activeAccount && (
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: activeAccount.color || "#6366f1",
                  flexShrink: 0,
                }} />
              )}
              <select
                value={activeAccount?.id ?? ""}
                onChange={handleAccountChange}
                style={{
                  background: "var(--bg-input)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: activeAccount ? "var(--text-primary)" : "var(--text-secondary)",
                  padding: "5px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  maxWidth: 200,
                }}
              >
                <option value="">— Demo mode —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.connected ? "" : " ⚠"}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <Link
              href="/accounts"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-secondary)",
                padding: "5px 12px",
                fontSize: 12,
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              + Connect account
            </Link>
          )
        )}

        {/* Theme toggle */}
        <button
          onClick={toggle}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 30, height: 30, borderRadius: 6,
            background: "transparent", border: "1px solid transparent",
            color: "var(--text-secondary)", fontSize: 14, cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-input)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>

        {/* Accounts settings link */}
        <Link
          href="/accounts"
          title="Manage accounts"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: 6,
            background: path === "/accounts" ? "var(--bg-input)" : "transparent",
            border: "1px solid",
            borderColor: path === "/accounts" ? "var(--border)" : "transparent",
            color: path === "/accounts" ? "var(--text-primary)" : "var(--text-secondary)",
            textDecoration: "none",
            fontSize: 16,
            transition: "all 0.15s",
          }}
        >
          ⚙
        </Link>

        {/* User avatar */}
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 600,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          M
        </div>
      </div>
    </header>
  );
}

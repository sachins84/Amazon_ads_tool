"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "@/lib/account-context";

const tabs = [
  { label: "Master Overview",   href: "/master-overview"   },
  { label: "Targeting 360",     href: "/targeting-360"     },
  { label: "Brand Analytics",   href: "/brand-analytics"   },
];

export default function TopNav() {
  const path = usePathname();
  const router = useRouter();
  const { accounts, activeAccount, setActiveAccountId, loading } = useAccount();

  function handleAccountChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setActiveAccountId(e.target.value);
    // Refresh current page so data reloads for the new account
    router.refresh();
  }

  return (
    <header
      style={{
        background: "#161b27",
        borderBottom: "1px solid #2a3245",
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
        <span style={{ fontWeight: 700, fontSize: 15, color: "#e2e8f0", letterSpacing: "-0.3px" }}>
          Amazon<span style={{ color: "#6366f1" }}>Ads</span>
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
                color: active ? "#e2e8f0" : "#8892a4",
                background: active ? "#1c2333" : "transparent",
                textDecoration: "none",
                transition: "all 0.15s",
                borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
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
                  background: "#1c2333",
                  border: "1px solid #2a3245",
                  borderRadius: 6,
                  color: activeAccount ? "#e2e8f0" : "#8892a4",
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
                background: "#1c2333",
                border: "1px solid #2a3245",
                borderRadius: 6,
                color: "#8892a4",
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
            background: path === "/accounts" ? "#1c2333" : "transparent",
            border: "1px solid",
            borderColor: path === "/accounts" ? "#2a3245" : "transparent",
            color: path === "/accounts" ? "#e2e8f0" : "#8892a4",
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

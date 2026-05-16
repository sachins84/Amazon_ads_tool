"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import TopNav from "@/components/shared/TopNav";
import type { SafeAccount } from "@/lib/db/accounts";

const COLORS = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#22c55e","#06b6d4","#f97316","#e11d48"];
const ENDPOINTS = [
  { label: "US / CA / MX / BR", value: "https://advertising-api.amazon.com" },
  { label: "EU (UK / DE / FR / IT / ES…)", value: "https://advertising-api-eu.amazon.com" },
  { label: "FE (JP / AU / SG / IN)", value: "https://advertising-api-fe.amazon.com" },
];
const SP_ENDPOINTS = [
  { label: "NA (US / CA / MX / BR)", value: "https://sellingpartnerapi-na.amazon.com" },
  { label: "EU",                      value: "https://sellingpartnerapi-eu.amazon.com" },
  { label: "FE (JP / AU / SG / IN)",  value: "https://sellingpartnerapi-fe.amazon.com" },
];
const MARKETPLACES: Record<string, string> = {
  US: "ATVPDKIKX0DER", UK: "A1F83G8C2ARO7P", DE: "A1PA6795UKMFR9",
  FR: "A13V1IB3VIYZZH", IT: "APJ6JRA9NG5V4",  ES: "A1RKKUPIHCS9HS",
  CA: "A2EUQ1WTGCTBG2", JP: "A1VC38T7YXB528", AU: "A39IBJ37TRP1C6",
  IN: "A21TJRUUN4KGV",  MX: "A1AM78C64UM0Y8", BR: "A2Q3Y263D00KWC",
};

const EMPTY_FORM = {
  name: "", color: "#6366f1",
  adsClientId: "", adsClientSecret: "", adsRefreshToken: "",
  adsEndpoint: "https://advertising-api.amazon.com",
  adsProfileId: "", adsMarketplace: "US",
  spRefreshToken: "", spMarketplaceId: "", spEndpoint: "https://sellingpartnerapi-na.amazon.com",
};

function AccountsPageInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const [accounts, setAccounts]   = useState<SafeAccount[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState<string | null>(null);
  const [form, setForm]           = useState({ ...EMPTY_FORM });
  const [saving, setSaving]       = useState(false);
  const [testing, setTesting]     = useState<string | null>(null);
  const [toast, setToast]         = useState<{ msg: string; ok: boolean } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced]   = useState(false);

  const notify = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  // Load accounts
  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/accounts");
      const json = await res.json();
      setAccounts(json.accounts ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // Esc closes the open Add/Edit form.
  useEffect(() => {
    if (!showForm) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setShowForm(false); setEditId(null); }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [showForm]);

  // Pre-fill refresh token from OAuth callback
  useEffect(() => {
    const rt        = searchParams.get("refresh_token");
    const tokenType = searchParams.get("token_type");
    const accountId = searchParams.get("account_id");
    const error     = searchParams.get("error");

    if (error) { notify(`OAuth error: ${error}`, false); return; }

    if (rt) {
      if (accountId) {
        // Updating existing account's token
        setEditId(accountId);
        setForm((f) => ({
          ...f,
          ...(tokenType === "sp" ? { spRefreshToken: rt } : { adsRefreshToken: rt }),
        }));
        setShowForm(true);
      } else {
        setForm((f) => ({ ...f, adsRefreshToken: rt }));
        setShowForm(true);
      }
      notify("Refresh token received from Amazon — review and save the account below.");
      // Clean URL
      router.replace("/accounts");
    }
  }, [searchParams, router]);

  // Open OAuth popup
  const startOAuth = (type: "ads" | "sp") => {
    if (!form.adsClientId || !form.adsClientSecret) {
      notify("Enter Client ID and Secret first", false);
      return;
    }
    const appUrl   = window.location.origin;
    const stateObj = { clientId: form.adsClientId, clientSecret: form.adsClientSecret, tokenType: type, ...(editId ? { accountId: editId } : {}) };
    const state    = btoa(JSON.stringify(stateObj));
    const scope    = type === "sp"
      ? "sellingpartnerapi::orders sellingpartnerapi::reports"
      : "advertising::campaign_management";
    const oauthUrl = `https://www.amazon.com/ap/oa?client_id=${form.adsClientId}&scope=${scope}&response_type=code&redirect_uri=${appUrl}/api/auth/callback&state=${state}`;
    window.location.href = oauthUrl;
  };

  // Save account
  const saveAccount = async () => {
    if (!form.name || !form.adsClientId || !form.adsRefreshToken || !form.adsProfileId) {
      notify("Fill in all required fields", false);
      return;
    }
    setSaving(true);
    try {
      const url    = editId ? `/api/accounts/${editId}` : "/api/accounts";
      const method = editId ? "PUT" : "POST";
      const body   = {
        name:           form.name,
        color:          form.color,
        adsClientId:    form.adsClientId,
        adsClientSecret: form.adsClientSecret || undefined,
        adsRefreshToken: form.adsRefreshToken,
        adsEndpoint:    form.adsEndpoint,
        adsProfileId:   form.adsProfileId,
        adsMarketplace: form.adsMarketplace,
        spRefreshToken:  form.spRefreshToken  || null,
        spMarketplaceId: form.spMarketplaceId
          ? MARKETPLACES[form.spMarketplaceId] ?? form.spMarketplaceId
          : null,
        spEndpoint: form.spEndpoint || null,
      };
      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      notify(editId ? "Account updated" : "Account added");
      setShowForm(false);
      setEditId(null);
      setForm({ ...EMPTY_FORM });
      loadAccounts();
    } catch (e) {
      notify(String(e), false);
    } finally { setSaving(false); }
  };

  // Test connection
  const testConnection = async (id: string) => {
    setTesting(id);
    try {
      const res  = await fetch(`/api/accounts/${id}/connect`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        notify(`✓ Connected — found ${json.profiles?.length ?? 0} profile(s)`);
        loadAccounts();
      } else {
        notify(`Connection failed: ${json.error}`, false);
      }
    } catch (e) {
      notify(String(e), false);
    } finally { setTesting(null); }
  };

  // Delete
  const deleteAccount = async (id: string) => {
    try {
      await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      notify("Account removed");
      setDeleteConfirm(null);
      loadAccounts();
    } catch (e) { notify(String(e), false); }
  };

  const openEdit = (a: SafeAccount) => {
    setEditId(a.id);
    setForm({
      name: a.name, color: a.color,
      adsClientId: a.adsClientId, adsClientSecret: "",
      adsRefreshToken: "", adsEndpoint: a.adsEndpoint,
      adsProfileId: a.adsProfileId, adsMarketplace: a.adsMarketplace,
      spRefreshToken: "", spMarketplaceId: a.spMarketplaceId ?? "",
      spEndpoint: a.spEndpoint ?? "https://sellingpartnerapi-na.amazon.com",
    });
    setShowForm(true);
    setShowAdvanced(!!a.spMarketplaceId);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <TopNav />

      <main style={{ padding: "28px", maxWidth: 900, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.4px" }}>
              Connected Accounts
            </h1>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
              Manage your Amazon brand and ad account connections
            </p>
          </div>
          <button
            onClick={() => { setShowForm(true); setEditId(null); setForm({ ...EMPTY_FORM }); setShowAdvanced(false); }}
            style={{
              padding: "8px 16px", borderRadius: 7, background: "#6366f1",
              border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            + Add Account
          </button>
        </div>

        {/* Account list */}
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading accounts…</div>
        ) : accounts.length === 0 ? (
          <EmptyState onAdd={() => setShowForm(true)} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
            {accounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                onEdit={() => openEdit(a)}
                onTest={() => testConnection(a.id)}
                onDelete={() => setDeleteConfirm(a.id)}
                testing={testing === a.id}
              />
            ))}
          </div>
        )}

        {/* Add/Edit form */}
        {showForm && (
          <AccountForm
            form={form}
            setForm={setForm}
            editId={editId}
            saving={saving}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            onSave={saveAccount}
            onCancel={() => { setShowForm(false); setEditId(null); }}
            onOAuth={startOAuth}
          />
        )}
      </main>

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <>
          <div onClick={() => setDeleteConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 299 }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12,
            width: 360, padding: 24, zIndex: 300,
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Remove account?</h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
              This will remove the account and all stored credentials. Advertising data is not affected.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: "8px", borderRadius: 7, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={() => deleteAccount(deleteConfirm)} style={{ flex: 1, padding: "8px", borderRadius: 7, background: "#ef4444", border: "none", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Remove</button>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: "var(--bg-input)", border: `1px solid ${toast.ok ? "var(--border)" : "rgba(239,68,68,0.3)"}`,
          borderRadius: 8, padding: "12px 18px", fontSize: 13, color: "var(--text-primary)",
          zIndex: 500, display: "flex", gap: 8, alignItems: "center",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          <span style={{ color: toast.ok ? "#22c55e" : "#ef4444" }}>{toast.ok ? "✓" : "✕"}</span>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AccountCard({ account, onEdit, onTest, onDelete, testing }: {
  account: SafeAccount;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
  testing: boolean;
}) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "16px 20px", display: "flex", alignItems: "center", gap: 16,
    }}>
      {/* Color dot */}
      <div style={{ width: 38, height: 38, borderRadius: 9, background: account.color, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#fff" }}>
        {account.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{account.name}</span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 10,
            background: account.connected ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
            color: account.connected ? "#22c55e" : "#f59e0b",
          }}>
            {account.connected ? "● Connected" : "○ Not verified"}
          </span>
          {account.spMarketplaceId && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "rgba(99,102,241,0.12)", color: "#6366f1" }}>
              SP-API
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
          Profile: {account.adsProfileId} · {account.adsMarketplace}
          {account.lastSyncedAt && <span> · Last verified: {new Date(account.lastSyncedAt).toLocaleDateString()}</span>}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <IconBtn title="Test connection" onClick={onTest} loading={testing}>
          {testing ? "…" : "⚡"}
        </IconBtn>
        <IconBtn title="Edit" onClick={onEdit}>✏</IconBtn>
        <IconBtn title="Remove" onClick={onDelete} danger>✕</IconBtn>
      </div>
    </div>
  );
}

function AccountForm({ form, setForm, editId, saving, showAdvanced, setShowAdvanced, onSave, onCancel, onOAuth }: {
  form: typeof EMPTY_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  editId: string | null;
  saving: boolean;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  onOAuth: (type: "ads" | "sp") => void;
}) {
  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "24px", marginTop: 8, position: "relative" }}>
      <button
        onClick={onCancel}
        title="Close"
        aria-label="Close"
        style={{
          position: "absolute", top: 12, right: 12,
          width: 32, height: 32, borderRadius: 6,
          background: "transparent", border: "1px solid transparent",
          color: "var(--text-secondary)", fontSize: 20, lineHeight: 1,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-input)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; }}
      >
        ✕
      </button>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 20 }}>
        {editId ? "Edit Account" : "Add New Account"}
      </h2>

      {/* Color + Name row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>Brand Color</label>
          <div style={{ display: "flex", gap: 6 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => set("color", c)}
                style={{ width: 22, height: 22, borderRadius: 5, background: c, border: form.color === c ? "2px solid #fff" : "2px solid transparent", cursor: "pointer" }}
              />
            ))}
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>Account Name <Req /></label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Brand XYZ — US" style={inputStyle} />
        </div>
      </div>

      <Divider label="Amazon Ads API" />

      <Grid2>
        <Field label="Client ID" req value={form.adsClientId} onChange={(v) => set("adsClientId", v)} placeholder="amzn1.application-oa2-client.XXXX" />
        <Field label="Client Secret" value={form.adsClientSecret} onChange={(v) => set("adsClientSecret", v)} placeholder={editId ? "Leave blank to keep current" : "Required"} secret />
      </Grid2>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "flex-end" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>Ads Refresh Token <Req /></label>
          <input value={form.adsRefreshToken} onChange={(e) => set("adsRefreshToken", e.target.value)} placeholder={editId ? "Leave blank to keep current" : "Atzr|XXXX…"} style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11 }} />
        </div>
        <button
          onClick={() => onOAuth("ads")}
          title="Login with Amazon to get a refresh token automatically"
          style={{ padding: "8px 12px", borderRadius: 6, background: "#f59e0b20", border: "1px solid #f59e0b40", color: "#f59e0b", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          Get via OAuth →
        </button>
      </div>

      <Grid2>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={labelStyle}>Marketplace Region <Req /></label>
          <select value={form.adsEndpoint} onChange={(e) => set("adsEndpoint", e.target.value)} style={selectStyle}>
            {ENDPOINTS.map((ep) => <option key={ep.value} value={ep.value}>{ep.label}</option>)}
          </select>
        </div>
        <Grid2 noGap>
          <Field label="Profile ID" req value={form.adsProfileId} onChange={(v) => set("adsProfileId", v)} placeholder="1234567890" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={labelStyle}>Marketplace</label>
            <select value={form.adsMarketplace} onChange={(e) => set("adsMarketplace", e.target.value)} style={selectStyle}>
              {Object.keys(MARKETPLACES).map((k) => <option key={k}>{k}</option>)}
            </select>
          </div>
        </Grid2>
      </Grid2>

      {/* SP-API section toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        style={{ margin: "16px 0 0", padding: "6px 0", background: "transparent", border: "none", color: "#6366f1", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
      >
        {showAdvanced ? "▼" : "▶"} Seller Central (SP-API) — for total revenue &amp; TACoS
      </button>

      {showAdvanced && (
        <div style={{ marginTop: 12, padding: "16px", background: "var(--bg-input)", borderRadius: 8, border: "1px solid var(--border)" }}>
          <p style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 12 }}>
            SP-API enables Total Revenue and TACoS. It uses the same Client ID/Secret as above but needs a separate refresh token with selling partner scope.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={labelStyle}>SP-API Refresh Token</label>
              <input value={form.spRefreshToken} onChange={(e) => set("spRefreshToken", e.target.value)} placeholder={editId ? "Leave blank to keep current" : "Atzr|XXXX…"} style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11 }} />
            </div>
            <button
              onClick={() => onOAuth("sp")}
              style={{ padding: "8px 12px", borderRadius: 6, background: "#6366f120", border: "1px solid #6366f140", color: "#6366f1", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
            >
              Get via OAuth →
            </button>
          </div>
          <Grid2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={labelStyle}>SP-API Marketplace</label>
              <select value={form.spMarketplaceId} onChange={(e) => set("spMarketplaceId", e.target.value)} style={selectStyle}>
                <option value="">Select marketplace</option>
                {Object.entries(MARKETPLACES).map(([k]) => <option key={k} value={k}>{k} ({MARKETPLACES[k]})</option>)}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={labelStyle}>SP-API Region</label>
              <select value={form.spEndpoint} onChange={(e) => set("spEndpoint", e.target.value)} style={selectStyle}>
                {SP_ENDPOINTS.map((ep) => <option key={ep.value} value={ep.value}>{ep.label}</option>)}
              </select>
            </div>
          </Grid2>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "9px", borderRadius: 7, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>Cancel</button>
        <button onClick={onSave} disabled={saving} style={{ flex: 2, padding: "9px", borderRadius: 7, background: "#6366f1", border: "none", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          {saving ? "Saving…" : editId ? "Save Changes" : "Add Account"}
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🏷</div>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>No accounts connected yet.</p>
      <button onClick={onAdd} style={{ padding: "8px 20px", borderRadius: 7, background: "#6366f1", border: "none", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
        + Add Your First Account
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, req, secret }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; req?: boolean; secret?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={labelStyle}>{label} {req && <Req />}</label>
      <input type={secret ? "password" : "text"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

function Grid2({ children, noGap }: { children: React.ReactNode; noGap?: boolean }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: noGap ? 8 : 12, marginBottom: noGap ? 0 : 16 }}>{children}</div>;
}

function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 16px" }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function Req() { return <span style={{ color: "#ef4444" }}>*</span>; }

function IconBtn({ children, onClick, title, danger, loading }: { children: React.ReactNode; onClick: () => void; title?: string; danger?: boolean; loading?: boolean }) {
  return (
    <button title={title} onClick={onClick} disabled={loading}
      style={{ padding: "6px 10px", borderRadius: 6, background: danger ? "rgba(239,68,68,0.1)" : "var(--bg-input)", border: `1px solid ${danger ? "rgba(239,68,68,0.2)" : "var(--border)"}`, color: danger ? "#ef4444" : "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>
      {children}
    </button>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 };
const inputStyle: React.CSSProperties = { background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "7px 10px", fontSize: 12, width: "100%" };
const selectStyle: React.CSSProperties = { background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", padding: "7px 10px", fontSize: 12, width: "100%", cursor: "pointer" };

export default function AccountsPage() {
  return <Suspense><AccountsPageInner /></Suspense>;
}

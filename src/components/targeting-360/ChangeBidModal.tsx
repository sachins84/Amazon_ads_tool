"use client";
import { useState } from "react";

interface Props {
  count: number;
  onApply: (type: "exact" | "increase" | "decrease" | "suggested", value: number) => void;
  onClose: () => void;
}

export default function ChangeBidModal({ count, onApply, onClose }: Props) {
  const [mode, setMode] = useState<"exact" | "increase" | "decrease" | "suggested">("exact");
  const [value, setValue] = useState("");

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 299 }} />
      <div style={{
        position: "fixed",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        background: "#161b27",
        border: "1px solid #2a3245",
        borderRadius: 12,
        width: 380,
        zIndex: 300,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ padding: "18px 20px", borderBottom: "1px solid #2a3245", display: "flex", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>
            Change Bid
            <span style={{ marginLeft: 8, fontSize: 11, color: "#8892a4", fontWeight: 400 }}>
              {count} target{count !== 1 ? "s" : ""} selected
            </span>
          </h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#555f6e", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        <div style={{ padding: "20px" }}>
          {(["exact", "increase", "decrease", "suggested"] as const).map((m) => (
            <label
              key={m}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 7,
                background: mode === m ? "#6366f115" : "transparent",
                border: `1px solid ${mode === m ? "#6366f140" : "transparent"}`,
                cursor: "pointer",
                marginBottom: 6,
                transition: "all 0.1s",
              }}
            >
              <input
                type="radio"
                checked={mode === m}
                onChange={() => setMode(m)}
                style={{ accentColor: "#6366f1" }}
              />
              <span style={{ fontSize: 13, color: "#e2e8f0" }}>
                {m === "exact" && "Set exact bid (₹)"}
                {m === "increase" && "Increase by (%)"}
                {m === "decrease" && "Decrease by (%)"}
                {m === "suggested" && "Set to suggested bid"}
              </span>
            </label>
          ))}

          {mode !== "suggested" && (
            <div style={{ marginTop: 12 }}>
              <input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={mode === "exact" ? "e.g. 1.25" : "e.g. 15"}
                style={{
                  width: "100%",
                  background: "#1c2333",
                  border: "1px solid #2a3245",
                  borderRadius: 6,
                  color: "#e2e8f0",
                  padding: "8px 12px",
                  fontSize: 14,
                }}
              />
              <p style={{ fontSize: 11, color: "#555f6e", marginTop: 4 }}>
                {mode === "exact" ? "Enter bid amount in USD" : "Enter percentage to adjust current bid"}
              </p>
            </div>
          )}
        </div>

        <div style={{ padding: "0 20px 20px", display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "9px", borderRadius: 7,
              background: "#1c2333", border: "1px solid #2a3245",
              color: "#8892a4", fontSize: 13, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onApply(mode, parseFloat(value) || 0);
              onClose();
            }}
            style={{
              flex: 2, padding: "9px", borderRadius: 7,
              background: "#6366f1", border: "none",
              color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Apply to {count} target{count !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </>
  );
}

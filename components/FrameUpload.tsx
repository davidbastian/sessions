"use client";
import { useRef } from "react";

interface Props {
  label: string;
  file: File | null;
  preview: string | null;
  onChange: (file: File | null, preview: string | null) => void;
}

export default function FrameUpload({ label, file, preview, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File | null) {
    if (!f) return onChange(null, null);
    const url = URL.createObjectURL(f);
    onChange(f, url);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) { handleFile(f); break; }
      }
    }
  }

  return (
    <div
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        handleFile(e.dataTransfer.files[0] ?? null);
      }}
      onPaste={handlePaste}
      style={{
        border: `2px dashed ${preview ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 12,
        padding: preview ? 0 : "1.5rem 1rem",
        cursor: "pointer",
        textAlign: "center",
        overflow: "hidden",
        position: "relative",
        minHeight: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface2)",
        transition: "border-color 0.2s",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      {preview ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <button
            onClick={(e) => { e.stopPropagation(); onChange(null, null); }}
            style={{
              position: "absolute", top: 6, right: 6,
              background: "rgba(0,0,0,0.7)", border: "none",
              color: "white", borderRadius: 6, padding: "2px 8px",
              cursor: "pointer", fontSize: 12,
            }}
          >
            ✕
          </button>
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            background: "rgba(0,0,0,0.6)", padding: "4px 8px",
            fontSize: 11, color: "var(--text-muted)",
          }}>
            {label}
          </div>
        </>
      ) : (
        <div>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🖼️</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>click · drag & drop · ⌘V paste</div>
        </div>
      )}
    </div>
  );
}

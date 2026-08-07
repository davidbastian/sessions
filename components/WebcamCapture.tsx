"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface Props {
  onCapture: (dataUrl: string, file: File) => void;
  onClose: () => void;
}

export default function WebcamCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  const startCamera = useCallback(async (mode: "user" | "environment") => {
    // Stop any existing stream
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setError(null);
    setCaptured(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Camera access denied");
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [facingMode, startCamera]);

  function snap() {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth || 1280;
    c.height = v.videoHeight || 720;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/png");
    setCaptured(dataUrl);
  }

  function confirm() {
    if (!captured) return;
    const b64 = captured.replace(/^data:image\/\w+;base64,/, "");
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bytes], `webcam-${Date.now()}.png`, { type: "image/png" });
    streamRef.current?.getTracks().forEach(t => t.stop());
    onCapture(captured, file);
  }

  function retake() {
    setCaptured(null);
    startCamera(facingMode);
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{
        background: "#0d0f1a", borderRadius: 20, padding: "1.5rem",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.9)",
        display: "flex", flexDirection: "column", gap: 14,
        width: "min(640px, 95vw)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", gap: 8 }}>
            <span>📷</span> Webcam Capture
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {/* Flip camera */}
            <button
              onClick={() => setFacingMode(m => m === "user" ? "environment" : "user")}
              title="Flip camera"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "rgba(255,255,255,0.7)", fontSize: 16, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              🔄
            </button>
            <button
              onClick={onClose}
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "rgba(255,255,255,0.7)", fontSize: 16, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              ✕
            </button>
          </div>
        </div>

        {/* Preview */}
        <div style={{ borderRadius: 12, overflow: "hidden", background: "#000", position: "relative", aspectRatio: "16/9" }}>
          {error ? (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#f87171", fontSize: 13, padding: "1rem", textAlign: "center" }}>
              <span style={{ fontSize: 32 }}>🚫</span>
              {error}
            </div>
          ) : captured ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={captured} alt="captured" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          )}
        </div>

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {captured ? (
            <>
              <button onClick={retake} style={secondaryBtn}>↩ Retake</button>
              <button onClick={confirm} style={primaryBtn}>✓ Use this photo</button>
            </>
          ) : (
            <button onClick={snap} disabled={!!error} style={{ ...primaryBtn, opacity: error ? 0.4 : 1, fontSize: 15, padding: "10px 32px", minWidth: 160 }}>
              📸 Snap
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: "var(--accent, #fbbf24)", border: "none", borderRadius: 10,
  color: "#000", fontWeight: 700, fontSize: 13, padding: "9px 22px",
  cursor: "pointer", transition: "opacity 0.15s",
};
const secondaryBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10, color: "rgba(255,255,255,0.8)", fontWeight: 600,
  fontSize: 13, padding: "9px 22px", cursor: "pointer",
};

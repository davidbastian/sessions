"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { getImageModels, getVideoModels, MODELS, type ModelConfig, ASPECT_RATIOS } from "@/config/models";

const WebcamCapture = dynamic(() => import("@/components/WebcamCapture"), { ssr: false });

type Section = "image" | "video" | "assets" | "settings" | "timeline";
type GenType = "prompt" | "style-transfer" | "moment" | "character-transfer" | "user-upload";

interface ApiKeyInfo {
  id: string;
  label: string;
  provider: string;
  hint: string;
  docsUrl: string;
  masked: string;
  set: boolean;
}

// ── Data model ────────────────────────────────────────────────────────────────

interface Generation {
  id: string;
  timestamp: string;
  prompt: string;
  genType: GenType;
  model: ModelConfig;
  aspectRatio: string;
  images: string[];       // public paths: /sessions/{sid}/{file}.png
  videoUrl?: string | null;
  videoStatus?: string | null;
  momentOffset?: number;  // seconds — negative = before, positive = after
}

interface Session {
  id: string;
  createdAt: string;
  title: string;          // derived from first prompt
  generations: Generation[];
  deleted?: boolean;      // soft-deleted: hidden from sidebar but kept for Assets
}

// ── Timeline types ────────────────────────────────────────────────────────────
interface TLKeyframe {
  id: string;
  timeMs: number;
  image: string | null;   // public path e.g. /timelines/{pid}/{id}.png
  prompt: string;
}

interface TLTransition {
  fromId: string;
  toId: string;
  videoUrl: string | null;
  status: "idle" | "generating" | "done";
  taskId?: string;
}

interface TLProject {
  id: string;
  name: string;
  durationMs: number;     // e.g. 10000 = 10 s
  keyframes: TLKeyframe[];
  transitions: TLTransition[];
  createdAt: string;
}

// Tracks an in-progress generation (displayable data only)
interface ActiveGenDisplay {
  id: string;
  prompt: string;
  type: "image" | "video";
  videoStatus?: string;
  elapsed: number;
}

// Mutable handles for a generation (not stored in React state)
interface ActiveGenHandles {
  abortController?: AbortController;
  pollInterval?: ReturnType<typeof setInterval>;
  elapsedInterval?: ReturnType<typeof setInterval>;
}

// ── Icon primitives ──────────────────────────────────────────────────────────
function Ic({ d, size = 16, sw = 1.6 }: { d: string; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const IC = {
  close:   (s=16) => <Ic d="M3 3l10 10M13 3L3 13" size={s} />,
  arrowL:  (s=20) => <Ic d="M10 3L5 8l5 5" size={s} />,
  arrowR:  (s=20) => <Ic d="M6 3l5 5-5 5" size={s} />,
  down:    (s=14) => <Ic d="M8 3v8M5 8l3 3 3-3M3 13h10" size={s} />,
  expand:  (s=14) => <Ic d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" size={s} />,
  search:  (s=15) => <Ic d="M7 12A5 5 0 107 2a5 5 0 000 10zM11.5 11.5l2.5 2.5" size={s} />,
  gear:    (s=18) => <Ic d="M8 6a2 2 0 100 4 2 2 0 000-4zM3 8a5 5 0 019.9-1h1.1M3 8a5 5 0 009.9 1h1.1" size={s} sw={1.5} />,
  upload:  (s=13) => <Ic d="M3 10v2h10v-2M8 3v7M5.5 5.5L8 3l2.5 2.5" size={s} />,
  grid4:   (s=18) => <Ic d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" size={s} sw={1.4} />,
  imgIcon: (s=18) => <Ic d="M2 4a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V4zm0 6l3-3 3 3 2-2 3 3M10.5 6a.5.5 0 110-1 .5.5 0 010 1" size={s} sw={1.4} />,
  play:    (s=18) => <Ic d="M5 3l8 5-8 5V3z" size={s} />,
  sparkle: (s=13) => <Ic d="M8 2v2M8 12v2M2 8h2M12 8h2M3.9 3.9l1.4 1.4M10.7 10.7l1.4 1.4M3.9 12.1l1.4-1.4M10.7 5.3l1.4-1.4" size={s} sw={1.5} />,
  pin:     (s=13) => <Ic d="M5 2h6v5l-3 4V2m-3 7h6" size={s} />,
  film:    (s=13) => <Ic d="M2 4h2v8H2V4zm10 0h2v8h-2V4zM4 8h8M4 5h8M4 11h8" size={s} />,
  clock:   (s=13) => <Ic d="M8 4v4l2.5 2.5M8 2a6 6 0 100 12A6 6 0 008 2z" size={s} />,
  wand:    (s=13) => <Ic d="M13 3L3 13M10 2l1 2-2 1M3 11l-1 2 2-1" size={s} />,
  folder:  (s=13) => <Ic d="M2 5a2 2 0 012-2h2l1.5 2H12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" size={s} />,
  rewind:  (s=13) => <Ic d="M13 3v10M3 8l6-4v8L3 8z" size={s} />,
  fastFwd: (s=13) => <Ic d="M3 3v10M13 8L7 4v8l6-4z" size={s} />,
  copy:    (s=12) => <Ic d="M5 4H3a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-2M6 2h5l3 3v5H6V2z" size={s} sw={1.4} />,
  tl:      (s=18) => <Ic d="M2 8h12M4 5v6M8 4v8M12 6v4" size={s} sw={1.5} />,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [section, setSection] = useState<Section>("image");
  const [genType, setGenType] = useState<GenType>("prompt");
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelConfig>(getImageModels()[0]);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState("720p");
  const [characterReplace, setCharacterReplace] = useState(false);
  const [referenceVideoUrl, setReferenceVideoUrl] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(272);
  /* The drag's mouseup closure captures the width from the render it started
     in, so the ref is what knows the final one when it comes time to save. */
  const sidebarWidthRef = useRef(272);
  /* Flips true once the saved theme and width have been read back, so nothing
     is written to storage before it has been read from it. */
  const restored = useRef(false);

  // Dropdowns
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showAspectDropdown, setShowAspectDropdown] = useState(false);
  const [showMomentSecondsDropdown, setShowMomentSecondsDropdown] = useState(false);
  const [momentCustomInput, setMomentCustomInput] = useState("");
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const aspectDropdownRef = useRef<HTMLDivElement>(null);
  const momentSecondsDropdownRef = useRef<HTMLDivElement>(null);

  // Image ref attachment
  const imageRefInputRef = useRef<HTMLInputElement>(null);
  const [imageRefFile, setImageRefFile] = useState<File | null>(null);
  const [imageRefPreview, setImageRefPreview] = useState<string | null>(null);

  // Effect image (image prompt mode — analyzes & applies the visual effect)
  const effectImageInputRef = useRef<HTMLInputElement>(null);
  const [effectImageFile, setEffectImageFile] = useState<File | null>(null);
  const [effectImagePreview, setEffectImagePreview] = useState<string | null>(null);

  // Screen image (image prompt mode — renders this inside a phone/tablet/monitor screen)
  const screenImageInputRef = useRef<HTMLInputElement>(null);
  const [screenImageFile, setScreenImageFile] = useState<File | null>(null);
  const [screenImagePreview, setScreenImagePreview] = useState<string | null>(null);

  // Moment feature — generate what happened before/after a captured frame
  const momentImageInputRef = useRef<HTMLInputElement>(null);
  const [momentImageFile, setMomentImageFile] = useState<File | null>(null);
  const [momentImagePreview, setMomentImagePreview] = useState<string | null>(null);
  const [momentDirection, setMomentDirection] = useState<"before" | "after">("before");
  const [momentSeconds, setMomentSeconds] = useState(2);

  // Video frame inputs
  const startFrameInputRef = useRef<HTMLInputElement>(null);
  const endFrameInputRef = useRef<HTMLInputElement>(null);
  const [startFrameFile, setStartFrameFile] = useState<File | null>(null);
  const [startFramePreview, setStartFramePreview] = useState<string | null>(null);
  const [endFrameFile, setEndFrameFile] = useState<File | null>(null);
  const [endFramePreview, setEndFramePreview] = useState<string | null>(null);

  // Style transfer inputs
  const styleImageInputRef = useRef<HTMLInputElement>(null);
  const contentImageInputRef = useRef<HTMLInputElement>(null);
  const [styleImageFile, setStyleImageFile] = useState<File | null>(null);
  const [styleImagePreview, setStyleImagePreview] = useState<string | null>(null);
  const [contentImageFile, setContentImageFile] = useState<File | null>(null);
  const [contentImagePreview, setContentImagePreview] = useState<string | null>(null);

  // Character Transfer inputs — scene ref (optional) + up to 5 character photos
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const charInputRef = useRef<HTMLInputElement>(null);
  const activeCharIdx = useRef(0);
  const [sceneFile, setSceneFile] = useState<File | null>(null);
  const [scenePreview, setScenePreview] = useState<string | null>(null);
  const [charFiles, setCharFiles] = useState<(File | null)[]>([null]);
  const [charPreviews, setCharPreviews] = useState<(string | null)[]>([null]);
  const [charKeepClothes, setCharKeepClothes] = useState(false);
  const [charKeepPose, setCharKeepPose] = useState(false);

  function setCharSlot(idx: number, file: File | null) {
    const preview = file ? URL.createObjectURL(file) : null;
    setCharFiles(prev => { const n = [...prev]; n[idx] = file; return n; });
    setCharPreviews(prev => { const n = [...prev]; n[idx] = preview; return n; });
    if (file) saveUserAsset(file);
  }

  // Generation state
  const [improving, setImproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Concurrent generation tracking
  const [activeGens, setActiveGens] = useState<Record<string, ActiveGenDisplay>>({});
  const activeGensHandles = useRef<Record<string, ActiveGenHandles>>({});

  // Hover slot — for paste routing
  const [hoverSlot, setHoverSlot] = useState<"ref" | "content" | "start" | "end" | "imageRef" | "effect" | "screen" | "moment" | "scene" | "char0" | "char1" | "char2" | "char3" | "char4" | null>(null);
  const hoverSlotRef = useRef<"ref" | "content" | "start" | "end" | "imageRef" | "effect" | "screen" | "moment" | "scene" | "char0" | "char1" | "char2" | "char3" | "char4" | null>(null);

  // Asset picker — pick from generated assets instead of uploading
  const [assetPickerSlot, setAssetPickerSlot] = useState<"start" | "end" | "imageRef" | "effect" | "screen" | "ref" | "content" | "moment" | "scene" | "char0" | "char1" | "char2" | "char3" | "char4" | null>(null);

  // Slot drop-up menu (upload from device / from assets)
  const [slotMenu, setSlotMenu] = useState<"ref" | "content" | "start" | "end" | "imageRef" | "effect" | "screen" | "moment" | "scene" | "char0" | "char1" | "char2" | "char3" | "char4" | null>(null);

  // Webcam capture
  const [webcamTarget, setWebcamTarget] = useState<string | null>(null); // slot key or "tl-kf" / "tl-kf-ref"
  const webcamHandlers = useRef<Map<string, (dataUrl: string, file: File) => void>>(new Map());

  // Lightbox
  const [lightbox, setLightbox] = useState<{ urls: string[]; prompts: string[]; types: ("image"|"video")[]; idx: number } | null>(null);

  // Sessions
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Assets filter
  const [assetsFilter, setAssetsFilter] = useState<string>("all");
  const [assetsSearch, setAssetsSearch] = useState("");

  // Track unseen assets — badge only appears for newly generated assets since last Assets visit
  const [seenAssetsCount, setSeenAssetsCount] = useState<number | null>(null);

  // Mounted guard — prevents locale-based hydration mismatches
  const [mounted, setMounted] = useState(false);

  // Copy-prompt feedback
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [hoveredPromptId, setHoveredPromptId] = useState<string | null>(null);

  // Mode button tooltips
  const [activeTip, setActiveTip] = useState<string | null>(null);

  // ── Timeline state ──────────────────────────────────────────────────────────
  const [tlProjects, setTlProjects] = useState<TLProject[]>([]);
  const [currentTlId, setCurrentTlId] = useState<string | null>(null);
  const [selectedKfId, setSelectedKfId] = useState<string | null>(null);
  const [tlPrompt, setTlPrompt] = useState("");
  const [tlGenerating, setTlGenerating] = useState(false);
  const [tlHoverKfId, setTlHoverKfId] = useState<string | null>(null);
  const [tlGenMode, setTlGenMode] = useState<"generate" | "style" | "character" | "moment">("generate");
  const [tlKfRefUrl, setTlKfRefUrl] = useState<string | null>(null);
  const [tlError, setTlError] = useState<string | null>(null);
  const [tlClips, setTlClips] = useState<Record<string, "generating" | "done">>({});
  const [tlPreview, setTlPreview] = useState(false);
  const [tlPreviewIdx, setTlPreviewIdx] = useState(0);
  const tlBarRef = useRef<HTMLDivElement>(null);
  const tlTooltipRef = useRef<HTMLDivElement>(null);
  const tlKfPickCallback = useRef<((url: string) => void) | null>(null);
  const tlKfRefCallback = useRef<((url: string) => void) | null>(null);
  const tlHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function copyPrompt(text: string, id: string) {
    if (!text || text === "Style Transfer") return;
    const doConfirm = () => { setCopiedPromptId(id); setTimeout(() => setCopiedPromptId(null), 1400); };
    try {
      navigator.clipboard.writeText(text).then(doConfirm).catch(() => {
        // Fallback for restricted contexts
        const el = document.createElement("textarea");
        el.value = text; el.style.position = "fixed"; el.style.opacity = "0";
        document.body.appendChild(el); el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        doConfirm();
      });
    } catch { /* ignore */ }
  }

  // Settings
  const [settingsKeys, setSettingsKeys] = useState<ApiKeyInfo[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealedValue, setRevealedValue] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [imageProvider, setImageProvider] = useState<"google" | "openrouter">("google");
  const [savingProvider, setSavingProvider] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [textareaFocused, setTextareaFocused] = useState(false);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const tab = section === "video" ? "video" : "image";
  const imageModels = getImageModels();
  const videoModels = getVideoModels();
  const currentModels = tab === "image" ? imageModels : videoModels;
  const currentAspectRatios = selectedModel.aspectRatios ?? ASPECT_RATIOS;
  const currentSession = sessions.find(s => s.id === currentSessionId) ?? null;
  const generations = currentSession?.generations ?? [];
  const allAssets = sessions.flatMap(s =>
    s.generations.flatMap(g => [
      ...g.images.map(img => ({ img, gen: g, session: s, type: "image" as const })),
      ...(g.videoUrl ? [{ img: g.videoUrl, gen: g, session: s, type: "video" as const }] : []),
    ])
  );

  // ── Logger ───────────────────────────────────────────────────────────────────
  const log = {
    info:  (msg: string, data?: unknown) => console.log( `%c[Studio] ${msg}`, "color:#60a5fa;font-weight:600", ...(data !== undefined ? [data] : [])),
    ok:    (msg: string, data?: unknown) => console.log( `%c[Studio] ✓ ${msg}`, "color:#4ade80;font-weight:600", ...(data !== undefined ? [data] : [])),
    warn:  (msg: string, data?: unknown) => console.warn(`%c[Studio] ⚠ ${msg}`, "color:#fb923c;font-weight:600", ...(data !== undefined ? [data] : [])),
    error: (msg: string, data?: unknown) => console.error(`%c[Studio] ✕ ${msg}`, "color:#f87171;font-weight:600", ...(data !== undefined ? [data] : [])),
  };

  // ── Effects ──────────────────────────────────────────────────────────────────

  // Mark mounted so date formatting only runs client-side
  useEffect(() => { setMounted(true); }, []);

  // Sync URL when current session changes (image/video view)
  useEffect(() => {
    if (!mounted) return;
    if (section === "assets" || section === "settings") return;
    const url = currentSessionId ? `?session=${currentSessionId}` : window.location.pathname;
    window.history.pushState({}, "", url);
  }, [currentSessionId, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL when navigating to assets or settings
  useEffect(() => {
    if (!mounted) return;
    if (section !== "assets" && section !== "settings") return;
    window.history.pushState({}, "", `?view=${section}`);
  }, [section, mounted]);

  // Load persisted sessions on mount
  useEffect(() => {
    fetch("/api/sessions")
      .then(r => r.json())
      .then((data: { sessions?: Session[] }) => {
        if (data.sessions?.length) {
          setSessions(data.sessions);
          // Restore section (assets/settings) or session from URL
          const urlParams = new URLSearchParams(window.location.search);
          const urlView = urlParams.get("view");
          if (urlView === "assets" || urlView === "settings") {
            setSection(urlView as Section);
          } else {
            const urlId = urlParams.get("session");
            const match = data.sessions.find(s => s.id === urlId);
            setCurrentSessionId(match ? match.id : data.sessions[0].id);
          }
          // Mark all pre-existing assets as already seen — badge only shows for new ones
          const existingCount = data.sessions.flatMap(s => s.generations.flatMap(g => g.images)).length;
          setSeenAssetsCount(existingCount);
        } else {
          setSeenAssetsCount(0);
        }
      })
      .catch(() => { setSeenAssetsCount(0); });
  }, []);

  // Load persisted timeline projects on mount
  useEffect(() => {
    fetch("/api/timelines")
      .then(r => r.json())
      .then((data: { projects?: TLProject[] }) => {
        if (data.projects?.length) setTlProjects(data.projects);
      })
      .catch(() => {});
  }, []);

  // Scroll to bottom when chat grows or a new generation starts
  const activeGensCount = Object.keys(activeGens).length;
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [generations.length, activeGensCount]);

  // Keep hoverSlotRef in sync so the paste listener always sees the latest slot
  useEffect(() => { hoverSlotRef.current = hoverSlot; }, [hoverSlot]);

  // Apply theme, and remember it. A light mode you have to choose again on every
  // reload is not really a light mode.
  //
  // The write waits for the restore below to have run: both effects fire on
  // mount, this one first, and without the guard it would save the default dark
  // over the light the last visit chose, a moment before the restore reads it.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    if (!restored.current) return;
    try { localStorage.setItem("session-theme", theme); } catch {}
  }, [theme]);

  // ── Restore what the last visit chose, and fit the sidebar to the screen ────
  //
  // Runs once, after mount rather than in the initial state, because the server
  // renders this too and localStorage does not exist there.
  //
  // The sidebar is a third of an iPad in portrait, so on a narrow screen it
  // starts collapsed to its icon width — still there, still draggable back out,
  // but not eating the canvas before you have generated anything. A remembered
  // width wins over both: someone who dragged it has already decided.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("session-sidebar");
      const t = localStorage.getItem("session-theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
    restored.current = true;

    if (saved) { setSidebarWidth(Number(saved) || 272); return; }
    if (window.innerWidth < 1100) setSidebarWidth(76);
  }, []);

  useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);

  // Clear unseen badge when Assets section is opened
  useEffect(() => {
    if (section === "assets") setSeenAssetsCount(allAssets.length);
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load settings keys when settings section opens
  useEffect(() => {
    if (section !== "settings") return;
    fetch("/api/settings")
      .then(r => r.json())
      .then((d: { keys?: ApiKeyInfo[]; imageProvider?: "google" | "openrouter" }) => {
        if (d.keys) setSettingsKeys(d.keys);
        if (d.imageProvider) setImageProvider(d.imageProvider);
      })
      .catch(() => {});
  }, [section]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node))
        setShowModelDropdown(false);
      if (aspectDropdownRef.current && !aspectDropdownRef.current.contains(e.target as Node))
        setShowAspectDropdown(false);
      if (momentSecondsDropdownRef.current && !momentSecondsDropdownRef.current.contains(e.target as Node))
        setShowMomentSecondsDropdown(false);
      if (!(e.target as Element).closest?.('[data-slot-menu]')) setSlotMenu(null);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Keyboard navigation for lightbox
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!lightbox) return;
      if (e.key === "Escape") { setLightbox(null); return; }
      if (e.key === "ArrowLeft")  setLightbox(prev => prev && prev.idx > 0 ? { ...prev, idx: prev.idx - 1 } : prev);
      if (e.key === "ArrowRight") setLightbox(prev => prev && prev.idx < prev.urls.length - 1 ? { ...prev, idx: prev.idx + 1 } : prev);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightbox]);

  // Global paste → route to whichever slot the mouse is hovering over
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const slot = hoverSlotRef.current;
      if (!slot) return;
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      e.preventDefault();
      const preview = URL.createObjectURL(file);
      if (slot === "imageRef") { handleImageRef(file); }
      if (slot === "ref")     { setStyleImageFile(file);   setStyleImagePreview(preview); }
      if (slot === "content") { setContentImageFile(file); setContentImagePreview(preview); }
      if (slot === "start")   { setStartFrameFile(file);   setStartFramePreview(preview); }
      if (slot === "end")     { setEndFrameFile(file);     setEndFramePreview(preview); }
      if (slot === "effect")  { setEffectImageFile(file);  setEffectImagePreview(preview); }
      if (slot === "screen")  { setScreenImageFile(file);  setScreenImagePreview(preview); }
      if (slot === "moment")  { setMomentImageFile(file);  setMomentImagePreview(preview); }
      saveUserAsset(file); // paste = explicit user upload → save to assets
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function upsertSession(updated: Session) {
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [updated, ...prev];
    });
  }

  function handleImageRef(f: File | null) {
    setImageRefFile(f);
    setImageRefPreview(f ? URL.createObjectURL(f) : null);
  }

  function newSession() {
    setCurrentSessionId(null);
    setPrompt("");
    setError(null);
    window.history.pushState({}, "", window.location.pathname);
    // Note: active generations are not cancelled — they continue in their own sessions
  }

  function cancelActiveGen(genId: string) {
    log.warn("Generation cancelled by user", { genId });
    const handles = activeGensHandles.current[genId];
    if (handles) {
      handles.abortController?.abort();
      if (handles.pollInterval) clearInterval(handles.pollInterval);
      if (handles.elapsedInterval) clearInterval(handles.elapsedInterval);
      delete activeGensHandles.current[genId];
    }
    setActiveGens(prev => {
      const next = { ...prev };
      delete next[genId];
      return next;
    });
  }

  function startActiveGen(id: string, prompt: string, type: "image" | "video") {
    activeGensHandles.current[id] = {};
    setActiveGens(prev => ({ ...prev, [id]: { id, prompt, type, elapsed: 0 } }));
  }

  function finishActiveGen(id: string) {
    const handles = activeGensHandles.current[id];
    if (handles) {
      if (handles.pollInterval) clearInterval(handles.pollInterval);
      if (handles.elapsedInterval) clearInterval(handles.elapsedInterval);
      delete activeGensHandles.current[id];
    }
    setActiveGens(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updateActiveGenStatus(id: string, updates: Partial<ActiveGenDisplay>) {
    setActiveGens(prev => prev[id] ? { ...prev, [id]: { ...prev[id], ...updates } } : prev);
  }

  function switchToSection(s: Section) {
    if (s === section) return;
    setSection(s);
    if (s === "timeline") {
      setSelectedKfId(null);
      setTlPrompt("");
      setTlError(null);
      return;
    }
    if (s !== "assets") {
      const newTab = s === "video" ? "video" : "image";
      setSelectedModel(newTab === "image" ? imageModels[0] : videoModels[0]);
      setError(null);
      setGenType("prompt");
      setStyleImageFile(null); setStyleImagePreview(null);
      setContentImageFile(null); setContentImagePreview(null);
      setMomentImageFile(null); setMomentImagePreview(null);
    }
  }

  // Convert a File to base64 in the browser
  async function fileToBase64(file: File): Promise<{ mimeType: string; data: string }> {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return { mimeType: file.type || "image/png", data: btoa(binary) };
  }

  async function improvePrompt() {
    setImproving(true); setError(null);
    try {
      const contextFiles: File[] = [];
      if (tab === "video") {
        if (startFrameFile) contextFiles.push(startFrameFile);
        if (endFrameFile) contextFiles.push(endFrameFile);
      } else if (genType === "prompt") {
        if (imageRefFile) contextFiles.push(imageRefFile);
        if (effectImageFile) contextFiles.push(effectImageFile);
        if (screenImageFile) contextFiles.push(screenImageFile);
      } else if (genType === "moment" && momentImageFile) {
        contextFiles.push(momentImageFile);
      } else if (genType === "style-transfer" && styleImageFile) {
        contextFiles.push(styleImageFile);
      }
      const images = await Promise.all(contextFiles.map(fileToBase64));
      log.info(`Improving prompt (${tab})${images.length ? ` + ${images.length} image(s)` : ""}`, { prompt });

      const res = await fetch("/api/improve-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, type: tab, images }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      log.ok("Prompt improved", { original: prompt, improved: data.improved });
      setPrompt(data.improved);
    } catch (e: unknown) {
      log.error("Improve prompt failed", e instanceof Error ? e.message : e);
      setError(e instanceof Error ? e.message : "Failed to improve prompt");
    } finally { setImproving(false); }
  }

  // Save a completed generation to disk; returns updated session
  async function persistGeneration(
    sessionId: string,
    gen: Omit<Generation, "images">,
    base64Images: string[]
  ): Promise<Session> {
    const res = await fetch("/api/sessions/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, generation: { ...gen, images: [] }, images: base64Images }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    upsertSession(data.session);
    return data.session;
  }

  // ── Video polling ─────────────────────────────────────────────────────────────

  const pollStatus = useCallback((
    taskId: string,
    endpoint: string,
    ctx: { genId: string; sessionId: string; prompt: string; model: ModelConfig; aspectRatio: string; genType: GenType }
  ) => {
    const intervalId = setInterval(async () => {
      try {
        const qs = `taskId=${taskId}&endpoint=${endpoint}`;
        const res = await fetch(`/api/video-status?${qs}`);
        const data = await res.json();
        updateActiveGenStatus(ctx.genId, { videoStatus: data.status });
        log.info(`Video poll — ${data.status}`, { taskId, endpoint });

        if (data.status === "succeed") {
          log.ok("Video generation complete", { taskId, videoUrl: data.videoUrl });
          const saveRes = await fetch("/api/sessions/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: ctx.sessionId,
              generation: {
                id: ctx.genId,
                timestamp: new Date().toISOString(),
                prompt: ctx.prompt,
                genType: ctx.genType,
                model: ctx.model,
                aspectRatio: ctx.aspectRatio,
                images: [],
                videoUrl: data.videoUrl,
                videoStatus: "succeed",
              },
              images: [],
            }),
          }).then(r => r.json());
          if (saveRes.session) {
            setSessions(prev => {
              const idx = prev.findIndex(s => s.id === saveRes.session.id);
              if (idx >= 0) { const n = [...prev]; n[idx] = saveRes.session; return n; }
              return [saveRes.session, ...prev];
            });
          }
          finishActiveGen(ctx.genId);

        } else if (data.status === "failed") {
          log.error("Video generation failed on Kling servers", { taskId });
          setError("Video generation failed.");
          finishActiveGen(ctx.genId);
        }
      } catch (e) { log.warn("Poll error (will retry)", e instanceof Error ? e.message : e); }
    }, 5000);
    // Store per-gen poll interval
    if (activeGensHandles.current[ctx.genId]) {
      activeGensHandles.current[ctx.genId].pollInterval = intervalId;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Image compression (client-side, before upload) ────────────────────────────
  // Resizes to max 1024px and re-encodes as JPEG at 85% quality.
  // Keeps images well under the ~1MB payload limit PiAPI enforces.

  async function compressImage(file: File): Promise<File> {
    const MAX_PX = 1024;
    const QUALITY = 0.85;
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(file);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (!blob) return resolve(file);
          resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
        }, "image/jpeg", QUALITY);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
      img.src = url;
    });
  }

  // ── Generate ─────────────────────────────────────────────────────────────────

  async function generate() {
    if (tab === "image") {
      if (genType === "prompt" && !prompt.trim()) { setError("Please enter a prompt"); return; }
      if (genType === "style-transfer" && (!styleImageFile || !contentImageFile)) {
        setError("Upload both a Ref image and a Content image"); return;
      }
      if (genType === "moment" && !momentImageFile) {
        setError("Upload a moment image first"); return;
      }
    } else if (!prompt.trim()) {
      setError("Please enter a prompt"); return;
    }

    const genId = crypto.randomUUID();
    const sessionId = currentSessionId ?? crypto.randomUUID();
    if (!currentSessionId) setCurrentSessionId(sessionId);

    setError(null);
    const momentLabel = genType === "moment"
      ? `${momentSeconds}s ${momentDirection}${prompt.trim() ? ` — ${prompt.trim()}` : ""}`
      : null;
    const displayPrompt = genType === "style-transfer" ? (prompt || "Style Transfer") : momentLabel ?? prompt;
    startActiveGen(genId, displayPrompt, tab);
    log.info(`Generate ${tab} — ${selectedModel.name} [${aspectRatio}]`, { prompt, genType, sessionId });

    const fd = new FormData();
    fd.append("prompt", prompt);
    fd.append("modelId", selectedModel.id);
    fd.append("aspectRatio", aspectRatio);

    // ── Image generation ──────────────────────────────────────────────────────

    if (tab === "image") {
      fd.append("genType", genType);
      if (genType === "style-transfer") {
        if (styleImageFile) fd.append("styleImage", styleImageFile);
        if (contentImageFile) fd.append("contentImage", contentImageFile);
      } else if (genType === "moment") {
        if (momentImageFile) fd.append("momentImage", momentImageFile);
        fd.append("momentDirection", momentDirection);
        fd.append("momentSeconds", String(momentSeconds));
      } else if (genType === "character-transfer") {
        if (sceneFile) fd.append("sceneImage", sceneFile);
        charFiles.forEach((f, i) => { if (f) fd.append(`character${i + 1}`, f); });
        if (charKeepClothes) fd.append("keepClothes", "1");
        if (charKeepPose) fd.append("keepPose", "1");
      } else {
        if (imageRefFile) fd.append("imageRef", imageRefFile);
        if (effectImageFile) fd.append("effectImage", effectImageFile);
        if (screenImageFile) fd.append("screenImage", screenImageFile);
      }
      try {
        const abortController = new AbortController();
        activeGensHandles.current[genId] = { abortController };
        const res = await fetch("/api/generate-image", { method: "POST", body: fd, signal: abortController.signal });
        if (!res.ok && res.status === 0) return; // aborted
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const imgs: string[] = data.images ?? [];
        if (imgs.length === 0) {
          // Model returned no image — surface a useful reason and bail without saving
          const reason = data.text?.trim()
            ? `Model didn't generate an image and said: "${data.text.trim().slice(0, 220)}"`
            : "The model didn't return an image. Try rephrasing your prompt or check that your API key has image generation enabled.";
          log.warn("No images returned by model", { text: data.text, raw: data });
          setError(reason);
          return;
        }
        log.ok(`Image generated — ${imgs.length} image(s)`, { model: selectedModel.name, prompt });
        const genMomentOffset = genType === "moment"
          ? (momentDirection === "before" ? -momentSeconds : momentSeconds)
          : undefined;
        await persistGeneration(sessionId, {
          id: genId,
          timestamp: new Date().toISOString(),
          prompt: genType === "style-transfer" ? (prompt || "Style Transfer")
            : genType === "moment" ? (momentLabel ?? prompt)
            : prompt,
          genType,
          model: selectedModel,
          aspectRatio,
          momentOffset: genMomentOffset,
        }, imgs);
        log.ok("Session saved", { sessionId, images: imgs.length });
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") { log.warn("Image generation cancelled by user"); return; }
        log.error("Image generation failed", e instanceof Error ? e.message : e);
        setError(e instanceof Error ? e.message : "Image generation failed");
      } finally {
        finishActiveGen(genId);
      }

    // ── Video generation ──────────────────────────────────────────────────────

    } else {
      fd.append("duration", String(duration));
      fd.append("resolution", resolution);
      if (characterReplace && selectedModel.supportsCharacterReplace) {
        fd.append("characterReplace", "1");
        if (referenceVideoUrl) fd.append("referenceVideoUrl", referenceVideoUrl);
        // startFrameFile is the character image in replace mode
        if (startFrameFile) fd.append("startFrame", await compressImage(startFrameFile));
      } else {
        if (startFrameFile) fd.append("startFrame", await compressImage(startFrameFile));
        if (endFrameFile) fd.append("endFrame", await compressImage(endFrameFile));
      }
      try {
        const res = await fetch("/api/generate-video", { method: "POST", body: fd });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        log.ok(`Video task submitted — ${data.endpoint}`, { taskId: data.taskId, model: selectedModel.name });
        updateActiveGenStatus(genId, { videoStatus: "submitted" });
        // Start per-gen elapsed timer (use a local counter to avoid stale closure)
        let elapsedCount = 0;
        const elapsedInterval = setInterval(() => {
          elapsedCount += 1;
          updateActiveGenStatus(genId, { elapsed: elapsedCount });
        }, 1000);
        if (activeGensHandles.current[genId]) {
          activeGensHandles.current[genId].elapsedInterval = elapsedInterval;
        }
        pollStatus(data.taskId, data.endpoint ?? "text2video", {
          genId, sessionId, prompt, model: selectedModel, aspectRatio, genType,
        });
      } catch (e: unknown) {
        log.error("Video generation failed", e instanceof Error ? e.message : e);
        setError(e instanceof Error ? e.message : "Video generation failed");
        finishActiveGen(genId);
      }
    }
  }

  // ── Cost helpers ───────────────────────────────────────────────────────────────

  function calcPiAPICost(modelId: string, version: string | undefined, dur: number, res: string): string {
    // Seedance 2 — $0.15/sec
    if (modelId === "seedance-2") return (0.15 * dur).toFixed(2);
    // Kling o1 — fixed price table
    if (version === "o1") {
      const table: Record<string, Record<number, number>> = {
        "720p":  { 5: 0.39, 10: 0.78 },
        "1080p": { 5: 0.52, 10: 1.04 },
      };
      const cost = table[res]?.[dur];
      return cost != null ? cost.toFixed(2) : "?";
    }
    // Kling 3.0 Omni — per-second pricing
    const ratePerSec = res === "1080p" ? 0.15 : 0.10;
    return (ratePerSec * dur).toFixed(2);
  }

  // ── Style helpers ─────────────────────────────────────────────────────────────

  const pill = (active: boolean, accent = false): React.CSSProperties => ({
    padding: "0.3rem 0.85rem", borderRadius: 20, flexShrink: 0,
    border: `1px solid ${active || accent ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent)" : "var(--surface2)",
    color: active ? "var(--bg)" : accent ? "var(--accent)" : "var(--text-muted)",
    fontSize: 13, fontWeight: 500, cursor: "pointer",
    whiteSpace: "nowrap" as const, transition: "all 0.15s",
  });

  const vStatusColor = (st: string) =>
    st === "succeed" ? "var(--success)" : st === "failed" ? "var(--error)" : "var(--text-muted)";
  const vStatusBg = (st: string) =>
    st === "succeed" ? "rgba(22,163,74,0.1)" : st === "failed" ? "rgba(220,38,38,0.1)" : "var(--surface2)";

  const toolbarBtn = (active: boolean): React.CSSProperties => ({
    width: 52, height: 52, borderRadius: 12,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 3, border: `1px solid ${active ? "var(--border)" : "transparent"}`,
    background: active ? "var(--bg)" : "transparent",
    cursor: "pointer", transition: "all 0.15s",
    color: active ? "var(--text)" : "var(--text-muted)",
    boxShadow: active ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
  });

  // Build a descriptive filename for downloads
  function downloadName(gen: Generation, index: number) {
    const slug = gen.prompt.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "gen";
    const date = new Date(gen.timestamp).toISOString().slice(0, 10);
    const model = gen.model.id.replace(/[^a-z0-9]/gi, "-");
    return `${model}_${slug}_${date}${gen.images.length > 1 ? `_${index + 1}` : ""}.png`;
  }

  // Settings helpers
  async function saveApiKey(keyId: string) {
    setSavingKey(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyId, value: editValue.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSettingsKeys(prev => prev.map(k =>
        k.id === keyId ? { ...k, masked: data.masked, set: data.set } : k
      ));
      setEditingKey(null);
      setEditValue("");
    } catch (e) {
      log.error("Failed to save API key", e instanceof Error ? e.message : e);
    } finally { setSavingKey(false); }
  }

  async function saveImageProvider(provider: "google" | "openrouter") {
    if (provider === imageProvider) return;
    setSavingProvider(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "IMAGE_PROVIDER", value: provider }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setImageProvider(provider);
    } catch (e) {
      log.error("Failed to switch image provider", e instanceof Error ? e.message : e);
    } finally { setSavingProvider(false); }
  }

  async function revealApiKey(keyId: string) {
    if (revealedKey === keyId) { setRevealedKey(null); setRevealedValue(""); return; }
    try {
      const res = await fetch(`/api/settings?reveal=${keyId}`);
      const data = await res.json();
      setRevealedKey(keyId);
      setRevealedValue(data.value ?? "");
    } catch { setRevealedKey(keyId); setRevealedValue("(error)"); }
  }

  // iOS-style day label — only called after mount so `new Date()` is stable
  function dayLabel(dateStr: string) {
    if (!mounted) return "";
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    const diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
    if (diff < 7) return d.toLocaleDateString([], { weekday: "long" });
    if (d.getFullYear() === today.getFullYear())
      return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  }

  // Fetch a public image path and return a File (for drag-to-slot)
  async function urlToFile(src: string, name: string): Promise<File> {
    const res = await fetch(src);
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || "image/png" });
  }

  // Save a user-uploaded image into the assets library under "Added by user"
  async function saveUserAsset(file: File) {
    if (!currentSessionId) return; // Never auto-create a session just for an upload
    try {
      const { mimeType, data } = await fileToBase64(file);
      const sId = currentSessionId;
      const gen: Generation = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        prompt: "Uploaded image",
        genType: "user-upload",
        model: { id: "user-upload", name: "Added by user", provider: "", type: "image", enabled: true } as ModelConfig,
        aspectRatio: "1:1",
        images: [],
      };
      const res = await fetch("/api/sessions/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sId, generation: gen, images: [`data:${mimeType};base64,${data}`] }),
      });
      if (!res.ok) return;
      const saved = await res.json();
      if (saved.session) {
        upsertSession(saved.session);
      }
    } catch { /* ignore */ }
  }

  // Handle a generated image or file drop onto a slot
  async function handleSlotDrop(e: React.DragEvent, slot: SlotKey) {
    e.preventDefault();

    let file: File | null = null;

    // Internal drag from a generated image
    const src = e.dataTransfer.getData("text/x-gen-img");
    if (src) {
      const filename = src.split("/").pop() ?? "image.png";
      file = await urlToFile(src, filename);
    }

    // File drop from desktop / OS
    if (!file) {
      const dropped = e.dataTransfer.files?.[0];
      if (dropped?.type.startsWith("image/")) file = dropped;
    }

    if (!file) return;
    const preview = URL.createObjectURL(file);
    if (slot === "imageRef") { handleImageRef(file); }
    if (slot === "ref")     { setStyleImageFile(file);   setStyleImagePreview(preview); }
    if (slot === "content") { setContentImageFile(file); setContentImagePreview(preview); }
    if (slot === "start")   { setStartFrameFile(file);   setStartFramePreview(preview); }
    if (slot === "end")     { setEndFrameFile(file);     setEndFramePreview(preview); }
    if (slot === "effect")  { setEffectImageFile(file);  setEffectImagePreview(preview); }
    if (slot === "screen")  { setScreenImageFile(file);  setScreenImagePreview(preview); }
    if (slot === "moment")  { setMomentImageFile(file);  setMomentImagePreview(preview); }
    if (slot === "scene")   { setSceneFile(file);        setScenePreview(preview); saveUserAsset(file); }
    if (slot.startsWith("char")) {
      const idx = parseInt(slot.slice(4));
      if (!isNaN(idx)) setCharSlot(idx, file);
    }
  }

  // ── Slot renderer — drop-up menu on click, thumbnail when filled ──

  type SlotKey = "ref" | "content" | "start" | "end" | "imageRef" | "effect" | "screen" | "moment" | "scene" | "char0" | "char1" | "char2" | "char3" | "char4";

  // Open webcam and wire the capture result to the right slot state
  function openWebcamForSlot(sk: SlotKey | string) {
    webcamHandlers.current.set(sk, (dataUrl: string, file: File) => {
      if (sk === "ref")      { setStyleImageFile(file);   setStyleImagePreview(dataUrl); }
      else if (sk === "content") { setContentImageFile(file); setContentImagePreview(dataUrl); }
      else if (sk === "scene")   { setSceneFile(file);        setScenePreview(dataUrl); }
      else if (sk === "moment")  { setMomentImageFile(file);  setMomentImagePreview(dataUrl); }
      else if (sk === "start")   { setStartFrameFile(file);   setStartFramePreview(dataUrl); }
      else if (sk === "end")     { setEndFrameFile(file);     setEndFramePreview(dataUrl); }
      else if (sk === "effect")  { setEffectImageFile(file);  setEffectImagePreview(dataUrl); }
      else if (sk === "screen")  { setScreenImageFile(file);  setScreenImagePreview(dataUrl); }
      else if (sk === "imageRef"){ handleImageRef(file); }
      else if (sk.startsWith("char")) {
        const idx = parseInt(sk.slice(4));
        if (!isNaN(idx)) setCharSlot(idx, file);
      }
      else if (sk === "tl-kf-ref") { setTlKfRefUrl(dataUrl); }
    });
    setWebcamTarget(sk);
  }

  function renderSlot(cfg: {
    preview: string | null;
    isDragOver: boolean;
    pillLabel: string;
    thumbLabel: string;
    slotKey: SlotKey;
    onDevice: () => void;
    onAsset?: () => void;
    onClear: () => void;
    accentColor?: string;
    onWebcam?: () => void;
  }) {
    const { preview, pillLabel, thumbLabel, slotKey, onDevice, onAsset, onClear, onWebcam } = cfg;
    const isOpen = slotMenu === slotKey;
    const toggleMenu = (e: React.MouseEvent) => { e.stopPropagation(); setSlotMenu(prev => prev === slotKey ? null : slotKey); };

    const slotBtnStyle = {
      width: "100%", textAlign: "left" as const, padding: "0.45rem 0.65rem",
      borderRadius: 7, border: "none", background: "transparent",
      color: "var(--text)", fontSize: 12, cursor: "pointer",
      display: "flex", alignItems: "center", gap: 8,
    };

    const dropUp = isOpen && (
      <div data-slot-menu="true" onMouseDown={e => e.stopPropagation()} style={{
        position: "absolute", bottom: "calc(100% + 6px)", left: 0,
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "0.3rem",
        zIndex: 400, boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        minWidth: 170,
      }}>
        <button onClick={e => { e.stopPropagation(); onDevice(); setSlotMenu(null); }} style={slotBtnStyle}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        ><span style={{display:"flex",alignItems:"center",gap:6}}>{IC.upload()}<span>Upload from device</span></span></button>
        <button onClick={e => { e.stopPropagation(); openWebcamForSlot(slotKey); setSlotMenu(null); }} style={slotBtnStyle}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        ><span style={{display:"flex",alignItems:"center",gap:6}}><span>📷</span><span>Use webcam</span></span></button>
        {onAsset && (
          <button onClick={e => { e.stopPropagation(); onAsset(); setSlotMenu(null); }} style={slotBtnStyle}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          ><span style={{display:"flex",alignItems:"center",gap:6}}>{IC.grid4()}<span>From assets</span></span></button>
        )}
      </div>
    );

    if (preview) {
      return (
        <div style={{ position: "relative", flexShrink: 0 }}>
          {dropUp}
          <div onClick={toggleMenu} style={{
            width: 44, height: 44, borderRadius: 10, overflow: "hidden", cursor: "pointer",
            border: isOpen ? "2px solid var(--accent)" : "2px solid var(--border)",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <button onClick={e => { e.stopPropagation(); onClear(); }} style={{
            position: "absolute", top: -5, right: -5, width: 15, height: 15,
            borderRadius: "50%", background: "var(--surface)", border: "1px solid var(--border)",
            color: "var(--text-muted)", fontSize: 8, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1,
          }}>✕</button>
          <div style={{ fontSize: 9, color: "var(--text-muted)", opacity: 0.5, textAlign: "center", marginTop: 3, lineHeight: 1 }}>
            {thumbLabel}
          </div>
        </div>
      );
    }

    return (
      <div style={{ position: "relative", flexShrink: 0 }} suppressHydrationWarning>
        {dropUp}
        <button onClick={toggleMenu} style={pill(isOpen)}>{pillLabel}</button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div suppressHydrationWarning style={{ display: "flex", height: "100vh", background: "var(--bg)", overflow: "hidden" }}>

      {/* ── LEFT SIDEBAR — sessions list ─────────────────────────── */}
      <aside style={{
        width: `${sidebarWidth}px`, flexShrink: 0, display: "flex", flexDirection: "column",
        borderRight: "1px solid var(--border)", background: "var(--surface)",
        position: "relative",
      }}>

        {/* Header */}
        {(() => {
          const compact = sidebarWidth < 190;
          const slim    = sidebarWidth < 230;
          return (
            <div style={{ padding: compact ? "0.9rem 0.625rem" : "1.25rem 1.125rem 1rem", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: compact ? "center" : "space-between" }}>
                {!compact && (
                  <div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 400, letterSpacing: "-0.02em", color: "var(--text)", lineHeight: 1.1 }}>
                      Sessions
                    </div>
                  </div>
                )}
                <button onClick={newSession} style={{
                  padding: slim ? "0.28rem 0.6rem" : "0.28rem 0.75rem", borderRadius: 20,
                  border: "1px solid var(--border)", background: "var(--surface2)",
                  color: "var(--text-muted)", fontSize: 12, fontWeight: 500, cursor: "pointer",
                  flexShrink: 0,
                }}>
                  {slim ? "+" : "+ New Session"}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Sessions list */}
        <div style={{ flex: 1, overflowY: "auto", padding: sidebarWidth < 190 ? "0.5rem 0.375rem" : "0.625rem" }}>
          {sessions.filter(s => !s.deleted).length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12, marginTop: "3rem", opacity: 0.4, lineHeight: 1.8 }}>
              {sidebarWidth < 190 ? "+" : <>Your sessions<br />will appear here</>}
            </div>
          ) : (
            sessions.filter(s => !s.deleted).map(session => {
              const isActive = session.id === currentSessionId;
              const thumb = session.generations.find(g => g.images.length > 0)?.images[0];
              const when = new Date(session.createdAt);
              const compact = sidebarWidth < 190;
              return (
                <div
                  key={session.id}
                  onClick={() => { setCurrentSessionId(session.id); if (section === "assets" || section === "settings") switchToSection("image"); }}
                  title={compact ? (session.title || "Session") : undefined}
                  className="session-item"
                  style={{
                    display: "flex", alignItems: compact ? "center" : "flex-start",
                    justifyContent: compact ? "center" : "flex-start",
                    gap: 10, padding: compact ? "0.375rem" : "0.7rem 0.75rem",
                    borderRadius: 12, marginBottom: "0.25rem", cursor: "pointer",
                    background: isActive ? "var(--surface2)" : "transparent",
                    border: `1px solid ${isActive ? "var(--border)" : "transparent"}`,
                    transition: "all 0.12s", position: "relative",
                  }}
                >
                  {/* Thumbnail */}
                  <div style={{
                    width: compact ? 42 : 38, height: compact ? 42 : 38,
                    borderRadius: 9, flexShrink: 0,
                    background: "var(--border)", overflow: "hidden",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                    ) : (
                      <span style={{ fontSize: 14, opacity: 0.3 }}>✦</span>
                    )}
                  </div>

                  {/* Text — hidden in compact mode */}
                  {!compact && (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                          fontSize: 12, fontWeight: 500, color: "var(--text)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                        {session.title || "Session"}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          {session.generations.length} gen{session.generations.length !== 1 ? "s" : ""}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", opacity: 0.4 }}>·</span>
                        <span suppressHydrationWarning style={{ fontSize: 10, color: "var(--text-muted)", opacity: 0.45 }}>
                          {mounted ? when.toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Delete button — appears on hover */}
                  <button
                    className="session-delete-btn"
                    title="Delete session"
                    onClick={e => {
                      e.stopPropagation();
                      if (!confirm("Remove this session from the sidebar?\nYour images and videos will remain in Assets.")) return;
                      fetch("/api/sessions/delete", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id }) });
                      setSessions(prev => prev.map(s => s.id === session.id ? { ...s, deleted: true } : s));
                      if (currentSessionId === session.id) setCurrentSessionId(null);
                    }}
                    style={{
                      position: "absolute", top: compact ? "50%" : 6, right: 6,
                      transform: compact ? "translateY(-50%)" : "none",
                      width: 18, height: 18, borderRadius: "50%",
                      background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text-muted)", fontSize: 11, lineHeight: 1,
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: 0, transition: "opacity 0.15s",
                      padding: 0, flexShrink: 0,
                    }}
                  >×</button>
                </div>
              );
            })
          )}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={e => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = sidebarWidth;
            const onMove = (ev: MouseEvent) => {
              const next = Math.min(480, Math.max(58, startW + ev.clientX - startX));
              setSidebarWidth(next);
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
              /* Remember it: a width you set by hand is a decision, and it
                 outranks the screen-size default on the next visit. */
              try { localStorage.setItem("session-sidebar", String(sidebarWidthRef.current)); } catch {}
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          style={{
            position: "absolute", top: 0, right: -3, bottom: 0, width: 6,
            cursor: "col-resize", zIndex: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {/* Subtle drag dots */}
          <div style={{
            width: 2, borderRadius: 2, height: 32,
            background: "var(--border)", opacity: 0.5,
            pointerEvents: "none",
          }} />
        </div>
      </aside>

      {/* ── MAIN CANVAS ──────────────────────────────────────────── */}
      <main style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Scrollable chat area */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 185 }}>

          {/* Error banner */}
          {error && (
            <div style={{
              margin: "1.25rem 1.5rem 0",
              background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)",
              borderRadius: 10, padding: "0.75rem 1rem", color: "var(--error)", fontSize: 13,
            }}>{error}</div>
          )}

          {/* ── ASSETS VIEW ─────────────────────────────────────────── */}
          {section === "assets" && (() => {
            // Unique models across all assets for filter pills
            const assetModels = Array.from(
              new Map(allAssets.map(({ gen }) => [gen.model.id, gen.model])).values()
            );

            // Filtered list
            const filtered = allAssets.filter(({ gen }) => {
              if (assetsFilter !== "all" && gen.model.id !== assetsFilter) return false;
              if (assetsSearch) {
                const q = assetsSearch.toLowerCase();
                return gen.prompt.toLowerCase().includes(q) || gen.model.name.toLowerCase().includes(q);
              }
              return true;
            });

            // Group by calendar day (newest first)
            const byDay: Record<string, typeof filtered> = {};
            for (const item of filtered) {
              const key = new Date(item.gen.timestamp).toDateString();
              if (!byDay[key]) byDay[key] = [];
              byDay[key].push(item);
            }
            const sortedDays = Object.keys(byDay).sort(
              (a, b) => new Date(b).getTime() - new Date(a).getTime()
            );

            return (
              <div style={{ padding: "1.5rem" }}>

                {/* Search bar */}
                {allAssets.length > 0 && (
                  <div style={{ position: "relative", marginBottom: "0.875rem" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", opacity: 0.5, pointerEvents: "none" }}>{IC.search()}</span>
                    <input
                      type="text"
                      placeholder="Search assets…"
                      value={assetsSearch}
                      onChange={e => setAssetsSearch(e.target.value)}
                      suppressHydrationWarning
                      style={{
                        width: "100%", boxSizing: "border-box",
                        paddingLeft: 36, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                        background: "var(--surface)", border: "1px solid var(--border)",
                        borderRadius: 10, color: "var(--text)", fontSize: 13, outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                )}
                {/* Header + filter pills */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.25rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", flexShrink: 0 }}>
                    Assets
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.45, flexShrink: 0 }}>
                    {filtered.length}{filtered.length !== allAssets.length ? ` / ${allAssets.length}` : ""}
                  </span>

                  {allAssets.length > 0 && (
                    <>
                      <div style={{ flex: 1 }} />
                      {/* All pill */}
                      <button
                        onClick={() => setAssetsFilter("all")}
                        style={{
                          padding: "0.22rem 0.75rem", borderRadius: 20, flexShrink: 0,
                          border: `1px solid ${assetsFilter === "all" ? "var(--accent)" : "var(--border)"}`,
                          background: assetsFilter === "all" ? "var(--accent)" : "var(--surface2)",
                          color: assetsFilter === "all" ? "var(--bg)" : "var(--text-muted)",
                          fontSize: 12, fontWeight: 500, cursor: "pointer",
                        }}
                      >All</button>
                      {assetModels.map(m => (
                        <button
                          key={m.id}
                          onClick={() => setAssetsFilter(assetsFilter === m.id ? "all" : m.id)}
                          style={{
                            padding: "0.22rem 0.75rem", borderRadius: 20, flexShrink: 0,
                            border: `1px solid ${assetsFilter === m.id ? "var(--accent)" : "var(--border)"}`,
                            background: assetsFilter === m.id ? "var(--accent)" : "var(--surface2)",
                            color: assetsFilter === m.id ? "var(--bg)" : "var(--text-muted)",
                            fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
                          }}
                        >{m.name}</button>
                      ))}
                    </>
                  )}
                </div>

                {filtered.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "40vh", color: "var(--text-muted)", fontSize: 13, gap: 10 }}>
                    <div style={{ fontSize: 40, opacity: 0.2 }}>🗂</div>
                    <div style={{ opacity: 0.4 }}>
                      {allAssets.length === 0 ? "Generated images will appear here" : "No images match this filter"}
                    </div>
                  </div>
                ) : (
                  sortedDays.map(day => (
                    <div key={day} style={{ marginBottom: "2rem" }}>
                      {/* iOS-style day header */}
                      <div suppressHydrationWarning style={{
                        fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                        letterSpacing: "0.06em", textTransform: "uppercase",
                        marginBottom: "0.625rem", opacity: 0.55,
                      }}>
                        {dayLabel(day)}
                        <span style={{ fontWeight: 400, marginLeft: 8, opacity: 0.6 }}>
                          · {byDay[day].length} image{byDay[day].length !== 1 ? "s" : ""}
                        </span>
                      </div>

                      {/* Grid for this day */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                        {/* session comes along too: the delete button below needs
                            to know which session's folder the file lives in. */}
                        {byDay[day].map(({ img, gen, type, session }, i) => (
                          <div key={i} style={{ position: "relative", borderRadius: 12, overflow: "hidden", cursor: "pointer" }}
                            onClick={() => {
                              const idx = filtered.findIndex(a => a.img === img);
                              setLightbox({ urls: filtered.map(a => a.img), prompts: filtered.map(a => a.gen.prompt), types: filtered.map(a => a.type), idx });
                            }}>
                            {type === "video" ? (
                              <video src={img} style={{ width: "100%", display: "block", borderRadius: 12 }} controls onClick={e => e.stopPropagation()} />
                            ) : (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img src={img} alt="" style={{ width: "100%", display: "block", borderRadius: 12 }} />
                            )}
                            {/* Hover overlay */}
                            <div style={{
                              position: "absolute", inset: 0, borderRadius: 12,
                              background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)",
                              opacity: 0, transition: "opacity 0.18s",
                            }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "0"; }}
                            >
                              <div style={{
                                position: "absolute", bottom: 0, left: 0, right: 0,
                                padding: "1.25rem 0.625rem 0.625rem",
                                display: "flex", flexDirection: "column", gap: 6,
                              }}>
                                {/* Prompt row */}
                                {gen.prompt && gen.genType !== "user-upload" && (
                                  <div style={{
                                    fontSize: 10, color: "rgba(255,255,255,0.85)", lineHeight: 1.4,
                                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                                    overflow: "hidden",
                                  }}>
                                    {gen.prompt}
                                  </div>
                                )}
                                {/* Bottom row: meta + buttons */}
                                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                                  <div>
                                    <div suppressHydrationWarning style={{ fontSize: 10, color: "rgba(255,255,255,0.75)", fontWeight: 600 }}>
                                      {mounted ? new Date(gen.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                                    </div>
                                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>
                                      {gen.model.name}
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", gap: 5 }}>
                                    {/* Delete asset */}
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        if (!confirm("Permanently delete this image/video? This cannot be undone.")) return;
                                        fetch("/api/sessions/delete?asset=1", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id, genId: gen.id }) });
                                        setSessions(prev => prev.map(s => s.id === session.id ? { ...s, generations: s.generations.filter(g => g.id !== gen.id) } : s));
                                      }}
                                      title="Delete"
                                      style={{
                                        width: 28, height: 28, borderRadius: "50%",
                                        background: "rgba(220,50,50,0.55)", backdropFilter: "blur(6px)",
                                        border: "1px solid rgba(255,255,255,0.15)",
                                        color: "white", cursor: "pointer", fontSize: 13,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                      }}
                                    >{IC.close(11)}</button>
                                    {/* Download asset */}
                                    <a
                                      href={img}
                                      download={downloadName(gen, i)}
                                      onClick={e => e.stopPropagation()}
                                      title="Download"
                                      style={{
                                        width: 28, height: 28, borderRadius: "50%",
                                        background: "rgba(255,255,255,0.18)", backdropFilter: "blur(6px)",
                                        border: "1px solid rgba(255,255,255,0.2)",
                                        color: "white", textDecoration: "none", fontSize: 13,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                      }}
                                    >{IC.down()}</a>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })()}

          {/* ── SETTINGS VIEW ───────────────────────────────────────── */}
          {section === "settings" && (
            <div style={{ padding: "2rem 2rem 4rem", maxWidth: 680, margin: "0 auto", width: "100%" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: "0.25rem", letterSpacing: "-0.03em" }}>Settings</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: "2.5rem" }}>API keys and model configuration</div>

              {/* ── API KEYS ─────────────────────────────────────────── */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "0.875rem" }}>
                API Keys
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: "2.5rem" }}>
                {settingsKeys.map(k => {
                  const isEditing = editingKey === k.id;
                  const isRevealed = revealedKey === k.id;
                  return (
                    <div key={k.id} style={{
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 14, padding: "1rem 1.25rem",
                    }}>
                      {/* Top row — label + status */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{k.label}</span>
                          <span style={{
                            marginLeft: 10, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                            background: k.set ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.1)",
                            color: k.set ? "var(--success)" : "var(--error)",
                          }}>
                            {k.set ? "✓ Set" : "Not set"}
                          </span>
                        </div>
                        <a href={k.docsUrl} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: "var(--text-muted)", textDecoration: "none", opacity: 0.5 }}>
                          {k.provider} ↗
                        </a>
                      </div>

                      {/* Hint */}
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, opacity: 0.6 }}>{k.hint}</div>

                      {/* Value row */}
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            autoFocus
                            type="text"
                            placeholder="Paste new key…"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") saveApiKey(k.id);
                              if (e.key === "Escape") { setEditingKey(null); setEditValue(""); }
                            }}
                            style={{
                              flex: 1, background: "var(--surface2)", border: "1px solid var(--accent)",
                              borderRadius: 8, padding: "0.4rem 0.75rem", color: "var(--text)",
                              fontSize: 13, outline: "none", fontFamily: "monospace",
                            }}
                          />
                          <button
                            onClick={() => saveApiKey(k.id)}
                            disabled={savingKey}
                            style={{
                              padding: "0.4rem 1rem", borderRadius: 8, cursor: savingKey ? "not-allowed" : "pointer",
                              background: "var(--accent)", border: "none", color: "var(--bg)",
                              fontSize: 12, fontWeight: 600,
                            }}
                          >{savingKey ? "Saving…" : "Save"}</button>
                          <button
                            onClick={() => { setEditingKey(null); setEditValue(""); }}
                            style={{
                              padding: "0.4rem 0.75rem", borderRadius: 8, cursor: "pointer",
                              background: "var(--surface2)", border: "1px solid var(--border)",
                              color: "var(--text-muted)", fontSize: 12,
                            }}
                          >Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <code style={{
                            flex: 1, fontSize: 12, fontFamily: "monospace",
                            color: k.set ? "var(--text-muted)" : "var(--error)",
                            background: "var(--surface2)", borderRadius: 6,
                            padding: "0.35rem 0.625rem", letterSpacing: "0.04em",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {k.set
                              ? (isRevealed ? revealedValue : k.masked)
                              : "No key configured"}
                          </code>
                          {k.set && (
                            <button
                              onClick={() => revealApiKey(k.id)}
                              title={isRevealed ? "Hide" : "Reveal"}
                              style={{
                                padding: "0.35rem 0.625rem", borderRadius: 6,
                                background: "var(--surface2)", border: "1px solid var(--border)",
                                color: "var(--text-muted)", fontSize: 12, cursor: "pointer", flexShrink: 0,
                              }}
                            >{isRevealed ? "Hide" : "Show"}</button>
                          )}
                          {isRevealed && revealedValue && (
                            <button
                              onClick={() => { navigator.clipboard.writeText(revealedValue); }}
                              title="Copy to clipboard"
                              style={{
                                padding: "0.35rem 0.625rem", borderRadius: 6,
                                background: "var(--surface2)", border: "1px solid var(--border)",
                                color: "var(--text-muted)", fontSize: 12, cursor: "pointer", flexShrink: 0,
                              }}
                            >Copy</button>
                          )}
                          <button
                            onClick={() => { setEditingKey(k.id); setEditValue(""); setRevealedKey(null); }}
                            style={{
                              padding: "0.35rem 0.75rem", borderRadius: 6,
                              background: "var(--surface2)", border: "1px solid var(--border)",
                              color: "var(--text-muted)", fontSize: 12, cursor: "pointer", flexShrink: 0,
                            }}
                          >{k.set ? "Replace" : "Add key"}</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── ACTIVE PROVIDER ──────────────────────────────────── */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "0.875rem" }}>
                Image Generation Provider
              </div>
              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "2.5rem",
              }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, opacity: 0.6 }}>
                  Which backend handles Nano Banana (Gemini) image generation. GPT Image 2 always uses PiAPI regardless of this setting.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {([
                    { id: "google" as const, label: "Google AI", keySet: settingsKeys.find(k => k.id === "GOOGLE_AI_API_KEY")?.set },
                    { id: "openrouter" as const, label: "OpenRouter", keySet: settingsKeys.find(k => k.id === "OPENROUTER_API_KEY")?.set },
                  ]).map(opt => {
                    const active = imageProvider === opt.id;
                    const disabled = !opt.keySet || savingProvider;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => opt.keySet && saveImageProvider(opt.id)}
                        disabled={disabled}
                        title={!opt.keySet ? `Set the ${opt.label} API key first` : undefined}
                        style={{
                          flex: 1, padding: "0.6rem 1rem", borderRadius: 10,
                          border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                          background: active ? "rgba(74,222,128,0.1)" : "var(--surface2)",
                          color: active ? "var(--success)" : (opt.keySet ? "var(--text)" : "var(--text-muted)"),
                          fontSize: 13, fontWeight: 600,
                          cursor: disabled && !active ? "not-allowed" : "pointer",
                          opacity: !opt.keySet ? 0.5 : 1,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        }}
                      >
                        {active && "✓ "}{opt.label}
                        {!opt.keySet && <span style={{ fontSize: 10, opacity: 0.7 }}>(no key)</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── MODELS ───────────────────────────────────────────── */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "0.875rem" }}>
                Models
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {MODELS.map(m => (
                  <div key={m.id} style={{
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 12, padding: "0.875rem 1.125rem",
                    display: "flex", alignItems: "center", gap: 14,
                    opacity: m.enabled ? 1 : 0.45,
                  }}>
                    {/* Type badge */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: m.type === "video" ? "rgba(139,92,246,0.15)" : "rgba(59,130,246,0.12)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 16,
                    }}>
                      {m.type === "video" ? "▷" : "⬡"}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{m.name}</span>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", opacity: 0.5 }}>{m.provider}</span>
                        {m.apiModel && (
                          <code style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface2)", padding: "1px 6px", borderRadius: 4 }}>
                            {m.apiModel}
                          </code>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, opacity: 0.6 }}>{m.description}</div>
                    </div>

                    {/* Capability tags */}
                    <div style={{ display: "flex", gap: 5, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {m.supportsImageRef && (
                        <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: "var(--surface2)", color: "var(--text-muted)" }}>Ref</span>
                      )}
                      {m.supportsStartEndFrame && (
                        <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: "var(--surface2)", color: "var(--text-muted)" }}>Start</span>
                      )}
                      {m.supportsEndFrame && (
                        <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: "var(--surface2)", color: "var(--text-muted)" }}>End</span>
                      )}
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                        background: m.enabled ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.1)",
                        color: m.enabled ? "var(--success)" : "var(--error)",
                      }}>
                        {m.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── CHAT VIEW ───────────────────────────────────────────── */}
          {section !== "assets" && section !== "settings" && (
            <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "2.5rem" }}>

              {/* Empty state */}
              {generations.length === 0 && activeGensCount === 0 && (
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", minHeight: "55vh",
                  color: "var(--text-muted)", fontSize: 13, gap: 12,
                }}>
                  <div style={{ fontSize: 42, opacity: 0.2 }}>✦</div>
                  <div style={{ opacity: 0.4 }}>
                    {tab === "video"
                      ? "Upload frames and describe your animation"
                      : "Describe an image below to generate"}
                  </div>
                </div>
              )}

              {/* Completed generations */}
              {generations.map(gen => (
                <div key={gen.id} style={{ maxWidth: 660, margin: "0 auto", width: "100%" }}>

                  {/* Images */}
                  {gen.images.length > 0 && (
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: gen.images.length > 1 ? "1fr 1fr" : "1fr",
                      gap: 6, borderRadius: 16, overflow: "hidden",
                    }}>
                      {gen.images.map((img, i) => (
                        <div key={i} style={{ position: "relative" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img}
                            alt={`gen-${i}`}
                            draggable
                            onDragStart={e => {
                              e.dataTransfer.setData("text/x-gen-img", img);
                              e.dataTransfer.effectAllowed = "copy";
                              // Small thumbnail drag ghost (64×64) centered under cursor
                              const ghost = document.createElement("img");
                              ghost.src = img;
                              ghost.style.cssText = "width:64px;height:64px;object-fit:cover;border-radius:8px;position:fixed;top:-9999px;left:-9999px;pointer-events:none;";
                              document.body.appendChild(ghost);
                              e.dataTransfer.setDragImage(ghost, 32, 32);
                              requestAnimationFrame(() => document.body.removeChild(ghost));
                            }}
                            style={{ width: "100%", display: "block", cursor: "grab" }}
                            title="Drag to Ref, Content, Start or End frame slots"
                          />
                          {/* Expand button */}
                          <button onClick={() => { const items = generations.flatMap(g => g.images.map(u => ({ url: u, prompt: g.prompt }))); const idx = items.findIndex(it => it.url === img); setLightbox({ urls: items.map(it => it.url), prompts: items.map(it => it.prompt), types: items.map(() => "image" as const), idx }); }} title="View full size" style={{
                            position: "absolute", top: 10, right: 10,
                            width: 30, height: 30, borderRadius: "50%",
                            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
                            color: "white", border: "none", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13,
                          }}>{IC.expand()}</button>
                          {/* Download button */}
                          <a href={img} download={downloadName(gen, i)} title="Download" style={{
                            position: "absolute", bottom: 10, right: 10,
                            width: 30, height: 30, borderRadius: "50%",
                            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
                            color: "white", textDecoration: "none",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, fontWeight: 600,
                          }}>{IC.down()}</a>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Video */}
                  {gen.videoUrl && (
                    <div>
                      <video src={gen.videoUrl} controls style={{ width: "100%", borderRadius: 14 }} />
                      <a href={gen.videoUrl} target="_blank" rel="noopener noreferrer" download style={{
                        display: "block", marginTop: 8, textAlign: "center", padding: "0.5rem",
                        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
                        color: "var(--text-muted)", textDecoration: "none", fontSize: 12,
                      }}><span style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center"}}>{IC.down()}<span>Download video</span></span></a>
                    </div>
                  )}

                  {/* Prompt + meta */}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, flex: 1, display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                      {gen.momentOffset !== undefined && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, flexShrink: 0,
                          background: gen.momentOffset < 0 ? "rgba(245,158,11,0.15)" : "rgba(245,158,11,0.15)",
                          color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)",
                          whiteSpace: "nowrap",
                        }}>
                          <span style={{display:"flex",alignItems:"center",gap:4}}>{gen.momentOffset! < 0 ? IC.rewind() : IC.fastFwd()} {Math.abs(gen.momentOffset!)}s {gen.momentOffset! < 0 ? "before" : "after"}</span>
                        </span>
                      )}
                      <span
                        onClick={() => copyPrompt(gen.prompt, gen.id)}
                        onMouseEnter={() => gen.prompt && setHoveredPromptId(gen.id)}
                        onMouseLeave={() => setHoveredPromptId(null)}
                        title={gen.prompt ? "Copy prompt" : undefined}
                        style={{ cursor: gen.prompt ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 5, position: "relative" }}
                      >
                        <span>{gen.genType === "style-transfer" && !gen.prompt ? "Style Transfer" : gen.prompt}</span>
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
                          opacity: hoveredPromptId === gen.id ? 0.55 : 0,
                          transition: "opacity 0.15s",
                          fontSize: 10, fontWeight: 500,
                        }}>
                          <span>Copy prompt</span>{IC.copy(10)}
                        </span>
                        {copiedPromptId === gen.id && (
                          <span style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", pointerEvents: "none" }}>Copied!</span>
                        )}
                      </span>
                    </div>
                    <div suppressHydrationWarning style={{ fontSize: 10, color: "var(--text-muted)", opacity: 0.5, flexShrink: 0, textAlign: "right", lineHeight: 1.6 }}>
                      {gen.model.name}<br />
                      {mounted ? new Date(gen.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                    </div>
                  </div>
                </div>
              ))}

              {/* In-progress generations — one card per active gen (concurrent) */}
              {Object.values(activeGens).map(ag => (
                <div key={ag.id} style={{ maxWidth: 660, margin: "0 auto", width: "100%" }}>
                  <div style={{
                    height: 300, borderRadius: 16,
                    background: "var(--surface2)",
                    animation: "pulse 1.5s ease-in-out infinite",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexDirection: "column", gap: 10, overflow: "hidden", position: "relative",
                  }}>
                    <div style={{ fontSize: 28, opacity: 0.2 }}>✦</div>

                    {/* Video progress bar + timer */}
                    {ag.type === "video" && (
                      <>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.5 }}>
                          {ag.videoStatus ?? "submitting"} · {Math.floor(ag.elapsed / 60)}:{String(ag.elapsed % 60).padStart(2, "0")}
                        </div>
                        <div style={{
                          position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
                          background: "var(--border)",
                        }}>
                          <div style={{
                            height: "100%", background: "var(--accent)", opacity: 0.6,
                            animation: "shimmer 2s ease-in-out infinite",
                            width: "40%",
                          }} />
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", opacity: 0.5, lineHeight: 1.6, flex: 1 }}>
                      {ag.prompt}
                    </div>
                    <button
                      onClick={() => cancelActiveGen(ag.id)}
                      style={{
                        flexShrink: 0, padding: "0.25rem 0.75rem", borderRadius: 20,
                        border: "1px solid var(--border)", background: "transparent",
                        color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { (e.target as HTMLElement).style.outline = "1px solid var(--error)"; (e.target as HTMLElement).style.color = "var(--error)"; }}
                      onMouseLeave={e => { (e.target as HTMLElement).style.outline = "none"; (e.target as HTMLElement).style.color = "var(--text-muted)"; }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}

              <div ref={chatBottomRef} />
            </div>
          )}
        </div>

        {/* ── BOTTOM BAR ─────────────────────────────────────────── */}
        {section !== "assets" && section !== "settings" && section !== "timeline" && (
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            padding: "1rem 1.5rem 1.5rem",
            background: "linear-gradient(to top, var(--bg) 80%, transparent)",
          }}>
            <div style={{ maxWidth: 960, margin: "0 auto" }}>

              {/* Moment image strip */}
              {tab === "image" && genType === "moment" && momentImagePreview && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ position: "relative" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={momentImagePreview} style={{ height: 48, width: 48, borderRadius: 8, objectFit: "cover", border: "2px solid #f59e0b" }} alt="moment" />
                    <div style={{ position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)", fontSize: 8, fontWeight: 700, background: "#f59e0b", color: "#fff", padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>Moment</div>
                    <button onClick={() => { setMomentImageFile(null); setMomentImagePreview(null); }} style={{
                      position: "absolute", top: -7, right: -7, width: 18, height: 18,
                      borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)",
                      color: "var(--text-muted)", fontSize: 10, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>✕</button>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Generating <strong style={{ color: "#f59e0b" }}>{momentSeconds}s {momentDirection}</strong> this moment — describe additional context or leave blank
                  </span>
                </div>
              )}

              {/* Image ref + effect strip */}
              {tab === "image" && genType === "prompt" && (imageRefPreview || effectImagePreview || screenImagePreview) && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                  {imageRefPreview && (
                    <div style={{ position: "relative" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageRefPreview} style={{ height: 40, width: 40, borderRadius: 8, objectFit: "cover", border: "1px solid var(--accent)" }} alt="ref" />
                      <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", fontSize: 8, fontWeight: 700, background: "var(--accent)", color: "var(--bg)", padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>Ref</div>
                      <button onClick={() => handleImageRef(null)} style={{
                        position: "absolute", top: -7, right: -7, width: 18, height: 18,
                        borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)",
                        color: "var(--text-muted)", fontSize: 10, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>✕</button>
                    </div>
                  )}
                  {effectImagePreview && (
                    <div style={{ position: "relative" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={effectImagePreview} style={{ height: 40, width: 40, borderRadius: 8, objectFit: "cover", border: "1px solid #a78bfa" }} alt="effect" />
                      <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", fontSize: 8, fontWeight: 700, background: "#a78bfa", color: "#fff", padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>Effect</div>
                      <button onClick={() => { setEffectImageFile(null); setEffectImagePreview(null); }} style={{
                        position: "absolute", top: -7, right: -7, width: 18, height: 18,
                        borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)",
                        color: "var(--text-muted)", fontSize: 10, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>✕</button>
                    </div>
                  )}
                  {screenImagePreview && (
                    <div style={{ position: "relative" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={screenImagePreview} style={{ height: 40, width: 40, borderRadius: 8, objectFit: "cover", border: "1px solid #34d399" }} alt="screen" />
                      <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", fontSize: 8, fontWeight: 700, background: "#34d399", color: "#000", padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>Screen</div>
                      <button onClick={() => { setScreenImageFile(null); setScreenImagePreview(null); }} style={{
                        position: "absolute", top: -7, right: -7, width: 18, height: 18,
                        borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)",
                        color: "var(--text-muted)", fontSize: 10, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>✕</button>
                    </div>
                  )}
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {imageRefPreview && effectImagePreview && screenImagePreview
                      ? "Ref + Effect + Screen attached"
                      : imageRefPreview && screenImagePreview
                      ? "Reference + Screen attached"
                      : effectImagePreview && screenImagePreview
                      ? "Effect + Screen attached"
                      : screenImagePreview
                      ? "Screen attached — will render this on the device screen in the scene"
                      : imageRefPreview && effectImagePreview
                      ? "Reference + Effect attached"
                      : imageRefPreview
                      ? "Reference attached — art direction & lighting will be matched"
                      : "Effect attached — will analyze and apply the visual treatment"}
                  </span>
                </div>
              )}

              {/* Style transfer strip */}
              {tab === "image" && genType === "style-transfer" && (styleImagePreview || contentImagePreview) && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                  {styleImagePreview && (
                    <div style={{ position: "relative" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={styleImagePreview} style={{ height: 40, width: 40, borderRadius: 8, objectFit: "cover", border: "1px solid var(--accent)" }} alt="ref" />
                      <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", fontSize: 8, fontWeight: 700, background: "var(--accent)", color: "var(--bg)", padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>Ref</div>
                      <button onClick={() => { setStyleImageFile(null); setStyleImagePreview(null); }} style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    </div>
                  )}
                  {contentImagePreview && (
                    <div style={{ position: "relative" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={contentImagePreview} style={{ height: 40, width: 40, borderRadius: 8, objectFit: "cover", border: "1px solid var(--border)" }} alt="content" />
                      <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", fontSize: 8, fontWeight: 700, background: "var(--surface2)", color: "var(--text-muted)", padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>Content</div>
                      <button onClick={() => { setContentImageFile(null); setContentImagePreview(null); }} style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: "50%", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    </div>
                  )}
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {styleImagePreview && contentImagePreview
                      ? "Style Ref + Content attached"
                      : styleImagePreview
                      ? "Style reference attached"
                      : "Content image attached"}
                  </span>
                </div>
              )}

              {/* Prompt textarea */}
              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 18, padding: "0.875rem 1.125rem", marginBottom: "0.75rem",
                display: "flex", alignItems: "flex-end", gap: 10,
              }}>
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={e => {
                    setPrompt(e.target.value);
                    if (textareaFocused && textareaRef.current) {
                      textareaRef.current.style.height = "auto";
                      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
                    }
                  }}
                  onFocus={() => {
                    setTextareaFocused(true);
                    if (textareaRef.current) {
                      textareaRef.current.style.height = "auto";
                      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
                    }
                  }}
                  onBlur={() => {
                    setTextareaFocused(false);
                    if (textareaRef.current) textareaRef.current.style.height = "";
                  }}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
                  suppressHydrationWarning
                  placeholder={
                    tab === "video"
                      ? "Describe a video and click generate..."
                      : genType === "style-transfer"
                      ? "Describe additional details (optional)..."
                      : "Describe an image and click generate..."
                  }
                  rows={2}
                  style={{
                    flex: 1, background: "transparent", border: "none", outline: "none",
                    color: "var(--text)", fontSize: 14, resize: "none", fontFamily: "inherit", lineHeight: 1.6,
                    overflow: "hidden", transition: "height 0.1s ease",
                  }}
                />

                {/* Generate button — always active; concurrent generations are allowed */}
                <button onClick={generate} title="Generate (⌘↵)" style={{
                  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                  background: "var(--accent)",
                  border: "1px solid transparent",
                  color: "var(--bg)",
                  fontSize: 18, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
                }}>
                  ✦
                </button>
              </div>

              {/* Controls row */}
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>

                {/* Model dropdown */}
                <div ref={modelDropdownRef} style={{ position: "relative" }}>
                  <button onClick={() => setShowModelDropdown(v => !v)} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "0.3rem 0.875rem", borderRadius: 20,
                    border: "1px solid var(--border)", background: "var(--surface)",
                    color: "var(--text)", fontSize: 13, fontWeight: 500, cursor: "pointer", flexShrink: 0,
                  }}>
                    {selectedModel.name}
                    <span style={{ fontSize: 9, opacity: 0.5 }}>▾</span>
                  </button>
                  {showModelDropdown && (
                    <div style={{
                      position: "absolute", bottom: "calc(100% + 8px)", left: 0,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 14, padding: "0.4rem", zIndex: 200,
                      minWidth: 210, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    }}>
                      {currentModels.map(m => (
                        <div key={m.id} onClick={() => {
                          setSelectedModel(m);
                          setShowModelDropdown(false);
                          // Clear end frame if new model doesn't support it
                          if (!m.supportsEndFrame) { setEndFrameFile(null); setEndFramePreview(null); }
                          // Clear character replace if new model doesn't support it
                          if (!m.supportsCharacterReplace) { setCharacterReplace(false); setReferenceVideoUrl(""); }
                          // Reset duration/resolution to valid values for new model
                          if (m.durations && !m.durations.includes(duration)) setDuration(m.durations[0]);
                          if (m.resolutions && !m.resolutions.includes(resolution)) setResolution(m.resolutions[0]);
                        }} style={{
                          padding: "0.55rem 0.875rem", borderRadius: 9, cursor: "pointer",
                          background: m.id === selectedModel.id ? "var(--surface2)" : "transparent",
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{m.name}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{m.description}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />

                {/* Mode pills (image) */}
                {tab === "image" && (
                  <>
                    {([
                      { id: "prompt",             label: "Image Prompt",   tip: "Describe what you want and the AI generates it from scratch." },
                      { id: "style-transfer",     label: "Style Transfer", tip: "Give a Style image + a Content image — AI repaints your content in that style." },
                      { id: "character-transfer", label: "👤 Characters",  tip: "Drop in 1–5 character photos and an optional scene — AI places them together." },
                      { id: "moment",             label: "⏱ Moment",       tip: "Upload a photo and pick a time offset — AI imagines the scene before or after." },
                    ] as { id: GenType; label: string; tip: string }[]).map(({ id, label, tip }) => (
                      <div key={id} style={{ position: "relative", flexShrink: 0 }}
                        onMouseEnter={() => setActiveTip(id)}
                        onMouseLeave={() => setActiveTip(null)}
                      >
                        <button onClick={() => setGenType(id)} style={pill(genType === id)}>{label}</button>
                        {activeTip === id && (
                          <div style={{
                            position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
                            background: "var(--surface2)", border: "1px solid var(--border)",
                            borderRadius: 8, padding: "6px 10px",
                            fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5,
                            whiteSpace: "nowrap", pointerEvents: "none", zIndex: 50,
                            boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                          }}>
                            {tip}
                          </div>
                        )}
                      </div>
                    ))}
                    {genType === "style-transfer" && (
                      <>
                        <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />
                        <input ref={styleImageInputRef} type="file" accept="image/*" style={{ display: "none" }}
                          onChange={e => { const f = e.target.files?.[0] ?? null; setStyleImageFile(f); setStyleImagePreview(f ? URL.createObjectURL(f) : null); if (f) saveUserAsset(f); }} />
                        <input ref={contentImageInputRef} type="file" accept="image/*" style={{ display: "none" }}
                          onChange={e => { const f = e.target.files?.[0] ?? null; setContentImageFile(f); setContentImagePreview(f ? URL.createObjectURL(f) : null); if (f) saveUserAsset(f); }} />
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}
                          onMouseEnter={() => setHoverSlot("ref")}
                          onMouseLeave={() => setHoverSlot(null)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => handleSlotDrop(e, "ref")}
                        >
                          {renderSlot({ preview: styleImagePreview, isDragOver: false, pillLabel: "Ref", thumbLabel: "Ref", slotKey: "ref", onDevice: () => styleImageInputRef.current?.click(), onAsset: allAssets.length > 0 ? () => setAssetPickerSlot("ref") : undefined, onClear: () => { setStyleImageFile(null); setStyleImagePreview(null); } })}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}
                          onMouseEnter={() => setHoverSlot("content")}
                          onMouseLeave={() => setHoverSlot(null)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => handleSlotDrop(e, "content")}
                        >
                          {renderSlot({ preview: contentImagePreview, isDragOver: false, pillLabel: "Content", thumbLabel: "Content", slotKey: "content", onDevice: () => contentImageInputRef.current?.click(), onAsset: allAssets.length > 0 ? () => setAssetPickerSlot("content") : undefined, onClear: () => { setContentImageFile(null); setContentImagePreview(null); } })}
                        </div>
                      </>
                    )}

                    {/* ── Character Transfer controls ── */}
                    {genType === "character-transfer" && (
                      <>
                        <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />
                        {/* Hidden file inputs */}
                        <input ref={sceneInputRef} type="file" accept="image/*" style={{ display: "none" }}
                          onChange={e => { const f = e.target.files?.[0] ?? null; setSceneFile(f); setScenePreview(f ? URL.createObjectURL(f) : null); if (f) saveUserAsset(f); e.target.value = ""; }} />
                        <input ref={charInputRef} type="file" accept="image/*" style={{ display: "none" }}
                          onChange={e => { const f = e.target.files?.[0] ?? null; setCharSlot(activeCharIdx.current, f); e.target.value = ""; }} />
                        {/* Scene slot (optional) */}
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}
                          onMouseEnter={() => setHoverSlot("scene")}
                          onMouseLeave={() => setHoverSlot(null)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => handleSlotDrop(e, "scene")}
                        >
                          {renderSlot({ preview: scenePreview, isDragOver: false, pillLabel: "Scene", thumbLabel: "Scene", slotKey: "scene", onDevice: () => sceneInputRef.current?.click(), onAsset: allAssets.length > 0 ? () => setAssetPickerSlot("scene") : undefined, onClear: () => { setSceneFile(null); setScenePreview(null); } })}
                        </div>
                        {/* Character slots */}
                        {charFiles.map((_, i) => {
                          const slotKey = `char${i}` as SlotKey;
                          return (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}
                              onMouseEnter={() => setHoverSlot(slotKey)}
                              onMouseLeave={() => setHoverSlot(null)}
                              onDragOver={e => e.preventDefault()}
                              onDrop={e => handleSlotDrop(e, slotKey)}
                            >
                              {renderSlot({ preview: charPreviews[i] ?? null, isDragOver: false, pillLabel: `Char ${i + 1}`, thumbLabel: `Char ${i + 1}`, slotKey, accentColor: "#f472b6", onDevice: () => { activeCharIdx.current = i; charInputRef.current?.click(); }, onAsset: allAssets.length > 0 ? () => { activeCharIdx.current = i; setAssetPickerSlot(slotKey); } : undefined, onClear: () => setCharSlot(i, null) })}
                            </div>
                          );
                        })}
                        {/* Add character button */}
                        {charFiles.length < 5 && (
                          <button onClick={() => { setCharFiles(p => [...p, null]); setCharPreviews(p => [...p, null]); }} style={{ ...pill(false), padding: "0 8px", fontSize: 16, lineHeight: 1 }} title="Add character">+</button>
                        )}
                        {/* Keep original clothes toggle */}
                        <button
                          onClick={() => setCharKeepClothes(v => !v)}
                          title="Keep the character's own clothing instead of the scene's clothing style"
                          style={pill(charKeepClothes)}
                        >
                          {charKeepClothes ? "✓ " : ""}Keep clothes
                        </button>
                        {/* Keep original pose toggle */}
                        <button
                          onClick={() => setCharKeepPose(v => !v)}
                          title="Keep the character's own pose instead of matching the scene's pose"
                          style={pill(charKeepPose)}
                        >
                          {charKeepPose ? "✓ " : ""}Keep pose
                        </button>
                      </>
                    )}

                    {/* ── Moment controls ── */}
                    {genType === "moment" && (
                      <>
                        <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />
                        <input ref={momentImageInputRef} type="file" accept="image/*" style={{ display: "none" }}
                          onChange={e => { const f = e.target.files?.[0] ?? null; setMomentImageFile(f); setMomentImagePreview(f ? URL.createObjectURL(f) : null); if (f) saveUserAsset(f); }} />
                        {/* Moment image slot */}
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}
                          onMouseEnter={() => setHoverSlot("moment" as never)}
                          onMouseLeave={() => setHoverSlot(null)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => handleSlotDrop(e, "moment" as never)}
                        >
                          {renderSlot({ preview: momentImagePreview, isDragOver: false, pillLabel: "Moment", thumbLabel: "Moment", slotKey: "moment", onDevice: () => momentImageInputRef.current?.click(), onAsset: allAssets.length > 0 ? () => setAssetPickerSlot("moment") : undefined, onClear: () => { setMomentImageFile(null); setMomentImagePreview(null); }, accentColor: "#f59e0b" })}
                        </div>
                        {/* Direction + Seconds — single compact drop-up */}
                        <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />
                        <div ref={momentSecondsDropdownRef} style={{ position: "relative" }}>
                          <button
                            onClick={() => { setShowMomentSecondsDropdown(v => !v); setMomentCustomInput(""); }}
                            style={{ ...pill(showMomentSecondsDropdown), display: "flex", alignItems: "center", gap: 5 }}
                          >
                            <span style={{display:"flex",alignItems:"center",gap:4}}>{momentDirection === "before" ? IC.rewind() : IC.fastFwd()} {momentSeconds}s {IC.arrowR(10)}</span>
                          </button>
                          {showMomentSecondsDropdown && (
                            <div style={{
                              position: "absolute", bottom: "calc(100% + 8px)", left: 0,
                              background: "var(--surface)", border: "1px solid var(--border)",
                              borderRadius: 14, padding: "0.625rem", zIndex: 200,
                              minWidth: 190, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                            }}>
                              {/* Before / After toggle */}
                              <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
                                {(["before", "after"] as const).map(d => (
                                  <button key={d} onClick={() => setMomentDirection(d)} style={{
                                    flex: 1, padding: "0.3rem 0", borderRadius: 20,
                                    border: `1px solid ${momentDirection === d ? "#f59e0b" : "var(--border)"}`,
                                    background: momentDirection === d ? "#f59e0b" : "var(--surface2)",
                                    color: momentDirection === d ? "#fff" : "var(--text-muted)",
                                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                                  }}><span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>{d === "before" ? IC.rewind() : IC.fastFwd()} {d === "before" ? "Before" : "After"}</span></button>
                                ))}
                              </div>
                              {/* Presets */}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                                {[1, 2, 5, 10, 30, 60].map(s => (
                                  <button key={s} onClick={() => { setMomentSeconds(s); setShowMomentSecondsDropdown(false); }} style={{
                                    padding: "0.3rem 0.65rem", borderRadius: 20,
                                    border: `1px solid ${momentSeconds === s ? "var(--accent)" : "var(--border)"}`,
                                    background: momentSeconds === s ? "var(--accent)" : "var(--surface2)",
                                    color: momentSeconds === s ? "var(--bg)" : "var(--text-muted)",
                                    fontSize: 12, fontWeight: 500, cursor: "pointer",
                                  }}>{s}s</button>
                                ))}
                              </div>
                              {/* Custom input — plain text, no spinners */}
                              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                                <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, opacity: 0.55 }}>Custom seconds</div>
                                <div style={{ display: "flex", gap: 5 }}>
                                  <input
                                    autoFocus
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    placeholder="e.g. 45"
                                    value={momentCustomInput}
                                    onChange={e => setMomentCustomInput(e.target.value.replace(/\D/g, ""))}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") {
                                        const v = parseInt(momentCustomInput);
                                        if (v > 0) { setMomentSeconds(v); setShowMomentSecondsDropdown(false); }
                                      }
                                      if (e.key === "Escape") setShowMomentSecondsDropdown(false);
                                    }}
                                    style={{
                                      flex: 1, background: "var(--surface2)", border: "1px solid var(--border)",
                                      borderRadius: 8, padding: "0.35rem 0.6rem", color: "var(--text)",
                                      fontSize: 12, outline: "none", width: 0,
                                    }}
                                  />
                                  <button
                                    onClick={() => { const v = parseInt(momentCustomInput); if (v > 0) { setMomentSeconds(v); setShowMomentSecondsDropdown(false); } }}
                                    style={{
                                      padding: "0.35rem 0.6rem", borderRadius: 8, cursor: "pointer",
                                      background: "var(--accent)", border: "none",
                                      color: "var(--bg)", fontSize: 11, fontWeight: 600, flexShrink: 0,
                                    }}
                                  >Set</button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />
                  </>
                )}

                {/* Aspect ratio drop-up */}
                <div ref={aspectDropdownRef} style={{ position: "relative" }}>
                  <button onClick={() => setShowAspectDropdown(v => !v)} style={{ ...pill(showAspectDropdown), display: "flex", alignItems: "center", gap: 5 }}>
                    {aspectRatio}
                    <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
                  </button>
                  {showAspectDropdown && (
                    <div style={{
                      position: "absolute", bottom: "calc(100% + 8px)", left: 0,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 12, padding: "0.4rem", zIndex: 200,
                      minWidth: 130, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    }}>
                      {currentAspectRatios.map(ar => (
                        <div key={ar.value} onClick={() => { setAspectRatio(ar.value); setShowAspectDropdown(false); }} style={{
                          padding: "0.45rem 0.875rem", borderRadius: 8, cursor: "pointer",
                          fontSize: 13, fontWeight: 500,
                          background: ar.value === aspectRatio ? "var(--surface2)" : "transparent",
                          color: ar.value === aspectRatio ? "var(--text)" : "var(--text-muted)",
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                        }}>
                          <span>{ar.label}</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ar.width}×{ar.height}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Video controls */}
                {tab === "video" && (
                  <>
                    <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />
                    <input ref={startFrameInputRef} type="file" accept="image/*" style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0] ?? null; setStartFrameFile(f); setStartFramePreview(f ? URL.createObjectURL(f) : null); if (f) saveUserAsset(f); }} />
                    <input ref={endFrameInputRef} type="file" accept="image/*" style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0] ?? null; setEndFrameFile(f); setEndFramePreview(f ? URL.createObjectURL(f) : null); if (f) saveUserAsset(f); }} />

                    {/* Character replace toggle — only for Seedance 2 */}
                    {selectedModel.supportsCharacterReplace && (
                      <button
                        onClick={() => { setCharacterReplace(v => !v); setEndFrameFile(null); setEndFramePreview(null); }}
                        style={{ ...pill(characterReplace), gap: 4 }}
                        title="Replace a character in an existing video"
                      >
                        <span style={{ fontSize: 13 }}>🎭</span> Replace
                      </button>
                    )}

                    {characterReplace && selectedModel.supportsCharacterReplace ? (
                      /* ── Character replacement slots ── */
                      <>
                        {/* Video URL input */}
                        <input
                          type="text"
                          placeholder="Paste video URL to edit…"
                          value={referenceVideoUrl}
                          onChange={e => setReferenceVideoUrl(e.target.value)}
                          style={{
                            background: "var(--surface-raised)",
                            border: `1px solid ${referenceVideoUrl ? "var(--accent)" : "var(--border)"}`,
                            borderRadius: 6,
                            padding: "3px 8px",
                            fontSize: 12,
                            color: "var(--text)",
                            outline: "none",
                            width: 190,
                            flexShrink: 0,
                          }}
                        />
                        {/* Character image slot */}
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}
                          onMouseEnter={() => setHoverSlot("start")}
                          onMouseLeave={() => setHoverSlot(null)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => handleSlotDrop(e, "start")}
                        >
                          {renderSlot({ preview: startFramePreview, isDragOver: false, pillLabel: "Character", thumbLabel: "Char", slotKey: "start", onDevice: () => startFrameInputRef.current?.click(), onAsset: allAssets.length > 0 ? () => setAssetPickerSlot("start") : undefined, onClear: () => { setStartFrameFile(null); setStartFramePreview(null); }, accentColor: "#f59e0b" })}
                        </div>
                      </>
                    ) : (
                      /* ── Normal start / end frame slots ── */
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}
                          onMouseEnter={() => setHoverSlot("start")}
                          onMouseLeave={() => setHoverSlot(null)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => handleSlotDrop(e, "start")}
                        >
                          {renderSlot({ preview: startFramePreview, isDragOver: false, pillLabel: "Start frame", thumbLabel: "Start", slotKey: "start", onDevice: () => startFrameInputRef.current?.click(), onAsset: allAssets.length > 0 ? () => setAssetPickerSlot("start") : undefined, onClear: () => { setStartFrameFile(null); setStartFramePreview(null); } })}
                        </div>
                        {selectedModel.supportsEndFrame && (
                          <div style={{ display: "flex", alignItems: "center", gap: 2 }}
                            onMouseEnter={() => setHoverSlot("end")}
                            onMouseLeave={() => setHoverSlot(null)}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => handleSlotDrop(e, "end")}
                          >
                            {renderSlot({ preview: endFramePreview, isDragOver: false, pillLabel: "End frame", thumbLabel: "End", slotKey: "end", onDevice: () => endFrameInputRef.current?.click(), onAsset: allAssets.length > 0 ? () => setAssetPickerSlot("end") : undefined, onClear: () => { setEndFrameFile(null); setEndFramePreview(null); } })}
                          </div>
                        )}
                      </>
                    )}

                    <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />
                    {/* Duration buttons — hidden in character replace mode (duration is ignored by Seedance) */}
                    {!characterReplace && (selectedModel.durations ?? [5, 10]).map(d => (
                      <button key={d} onClick={() => setDuration(d)} style={pill(duration === d)}>{d}s</button>
                    ))}
                    {selectedModel.resolutions && !characterReplace && (<>
                      <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />
                      {selectedModel.resolutions.map(r => (
                        <button key={r} onClick={() => setResolution(r)} style={pill(resolution === r)}>{r}</button>
                      ))}
                      <div style={{ fontSize: 12, color: "var(--text-muted)", paddingLeft: 2, whiteSpace: "nowrap" }}>
                        ~${calcPiAPICost(selectedModel.id, selectedModel.piAPIVersion, duration, resolution)}
                      </div>
                    </>)}
                  </>
                )}

                <div style={{ flex: 1 }} />

                {/* Image ref + Effect attach */}
                {tab === "image" && genType === "prompt" && (
                  <>
                    <input ref={screenImageInputRef} type="file" accept="image/*" style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0] ?? null; setScreenImageFile(f); setScreenImagePreview(f ? URL.createObjectURL(f) : null); if (f) saveUserAsset(f); }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}
                      onMouseEnter={() => setHoverSlot("screen")}
                      onMouseLeave={() => setHoverSlot(null)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleSlotDrop(e, "screen")}
                    >
                      {renderSlot({ preview: screenImagePreview, isDragOver: false, pillLabel: "Screen", thumbLabel: "Screen", slotKey: "screen", onDevice: () => screenImageInputRef.current?.click(), onAsset: allAssets.length > 0 ? () => setAssetPickerSlot("screen") : undefined, onClear: () => { setScreenImageFile(null); setScreenImagePreview(null); }, accentColor: "#34d399" })}
                    </div>
                    <input ref={effectImageInputRef} type="file" accept="image/*" style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0] ?? null; setEffectImageFile(f); setEffectImagePreview(f ? URL.createObjectURL(f) : null); if (f) saveUserAsset(f); }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}
                      onMouseEnter={() => setHoverSlot("effect")}
                      onMouseLeave={() => setHoverSlot(null)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleSlotDrop(e, "effect")}
                    >
                      {renderSlot({ preview: effectImagePreview, isDragOver: false, pillLabel: "Effect", thumbLabel: "Effect", slotKey: "effect", onDevice: () => effectImageInputRef.current?.click(), onAsset: allAssets.length > 0 ? () => setAssetPickerSlot("effect") : undefined, onClear: () => { setEffectImageFile(null); setEffectImagePreview(null); }, accentColor: "#a78bfa" })}
                    </div>
                    <input ref={imageRefInputRef} type="file" accept="image/*" style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0] ?? null; handleImageRef(f); if (f) saveUserAsset(f); }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}
                      onMouseEnter={() => setHoverSlot("imageRef")}
                      onMouseLeave={() => setHoverSlot(null)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleSlotDrop(e, "imageRef")}
                    >
                      {renderSlot({ preview: imageRefPreview, isDragOver: false, pillLabel: "Ref", thumbLabel: "Ref", slotKey: "imageRef", onDevice: () => imageRefInputRef.current?.click(), onAsset: allAssets.length > 0 ? () => setAssetPickerSlot("imageRef") : undefined, onClear: () => handleImageRef(null) })}
                    </div>
                  </>
                )}

                {/* Improve prompt — right-aligned in controls row */}
                {(() => {
                  const hasCtx = tab === "video" ? !!(startFrameFile || endFrameFile) : !!(imageRefFile || styleImageFile);
                  const canImprove = !improving && (!!prompt.trim() || (tab === "video" && hasCtx));
                  return (canImprove || improving) ? (
                    <button onClick={improvePrompt} disabled={improving}
                      style={{
                        marginLeft: "auto", flexShrink: 0,
                        padding: "0.3rem 0.85rem", borderRadius: 20,
                        border: "1px solid var(--border)", background: "var(--surface2)",
                        color: "var(--text-muted)", fontSize: 13, fontWeight: 500,
                        cursor: improving ? "default" : "pointer", whiteSpace: "nowrap",
                        transition: "0.15s", opacity: improving ? 0.5 : 1,
                      }}
                    >{improving ? "Improving…" : "Improve prompt"}</button>
                  ) : null;
                })()}

              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── RIGHT TOOLBAR ────────────────────────────────────────── */}
      <aside style={{
        width: 68, flexShrink: 0, display: "flex", flexDirection: "column",
        alignItems: "center", paddingTop: "1.25rem", gap: 6,
        borderLeft: "1px solid var(--border)", background: "var(--surface)",
      }}>
        {(["image", "video"] as Section[]).map(s => {
          return (
            <button key={s} onClick={() => switchToSection(s)} style={toolbarBtn(section === s)}>
              <span style={{ lineHeight: 1 }}>{s === "image" ? IC.imgIcon() : IC.play()}</span>
              <span style={{ fontSize: 10, fontWeight: 500 }}>{s === "image" ? "Image" : "Animate"}</span>
            </button>
          );
        })}

        {/* Assets button — badge sits on the icon itself */}
        {(() => {
          const newCount = seenAssetsCount !== null ? Math.max(0, allAssets.length - seenAssetsCount) : 0;
          return (
            <div style={{ position: "relative" }}>
              <button onClick={() => switchToSection("assets")} style={toolbarBtn(section === "assets")}>
                <span style={{ lineHeight: 1 }}>{IC.grid4()}</span>
                <span style={{ fontSize: 10, fontWeight: 500 }}>Assets</span>
              </button>
              {newCount > 0 && (
                <div style={{
                  position: "absolute", top: 5, right: 5,
                  background: "var(--accent)", color: "var(--bg)",
                  fontSize: 8, fontWeight: 700, borderRadius: 8,
                  padding: "1px 4px", minWidth: 14, textAlign: "center",
                  lineHeight: 1.5, pointerEvents: "none",
                }}>
                  {newCount}
                </div>
              )}
            </div>
          );
        })()}


        <button onClick={() => switchToSection("settings")} style={toolbarBtn(section === "settings")}>
          <span style={{ lineHeight: 1 }}>{IC.gear()}</span>
          <span style={{ fontSize: 10, fontWeight: 500 }}>Settings</span>
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          style={{ ...toolbarBtn(false), marginBottom: "1rem", color: "var(--text-muted)" }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>{theme === "dark" ? "○" : "●"}</span>
          <span style={{ fontSize: 10, fontWeight: 500 }}>{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
      </aside>

      {/* ── WEBCAM CAPTURE MODAL ─────────────────────────────────── */}
      {webcamTarget && (
        <WebcamCapture
          onCapture={(dataUrl, file) => {
            const handler = webcamHandlers.current.get(webcamTarget);
            if (handler) handler(dataUrl, file);
            setWebcamTarget(null);
          }}
          onClose={() => setWebcamTarget(null)}
        />
      )}

      {/* ── ASSET PICKER MODAL ───────────────────────────────────── */}
      {assetPickerSlot && (
        <div
          onClick={() => setAssetPickerSlot(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 900,
            background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 20, padding: "1.5rem",
            width: "min(780px, 90vw)", maxHeight: "80vh",
            display: "flex", flexDirection: "column", gap: 14,
            boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
                  Pick from Assets
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, opacity: 0.6 }}>
                  {allAssets.filter(a => a.type === "image").length} image{allAssets.filter(a => a.type === "image").length !== 1 ? "s" : ""} · click to select
                </div>
              </div>
              <button
                onClick={() => setAssetPickerSlot(null)}
                style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  color: "var(--text-muted)", cursor: "pointer", fontSize: 14,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >✕</button>
            </div>

            {/* Asset grid */}
            <div style={{ overflowY: "auto", flex: 1 }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 8,
              }}>
                {allAssets.filter(a => a.type === "image").map(({ img, gen }, i) => (
                  <div
                    key={i}
                    title={gen.prompt || gen.model.name}
                    onClick={async () => {
                      if (assetPickerSlot === ("tl-kf" as never)) { tlKfPickCallback.current?.(img); setAssetPickerSlot(null); return; }
                      if (assetPickerSlot === ("tl-kf-ref" as never)) { tlKfRefCallback.current?.(img); setAssetPickerSlot(null); return; }
                      const file = await urlToFile(img, img.split("/").pop() ?? "image.png");
                      const preview = URL.createObjectURL(file);
                      if (assetPickerSlot === "start")   { setStartFrameFile(file);   setStartFramePreview(preview); }
                      if (assetPickerSlot === "end")     { setEndFrameFile(file);     setEndFramePreview(preview); }
                      if (assetPickerSlot === "imageRef"){ handleImageRef(file); }
                      if (assetPickerSlot === "effect")  { setEffectImageFile(file);  setEffectImagePreview(preview); }
                      if (assetPickerSlot === "screen")  { setScreenImageFile(file);  setScreenImagePreview(preview); }
                      if (assetPickerSlot === "ref")     { setStyleImageFile(file);   setStyleImagePreview(preview); }
                      if (assetPickerSlot === "content") { setContentImageFile(file); setContentImagePreview(preview); }
                      if (assetPickerSlot === "moment")  { setMomentImageFile(file);  setMomentImagePreview(preview); }
                      if (assetPickerSlot === "scene")   { setSceneFile(file);        setScenePreview(preview); }
                      if (assetPickerSlot?.startsWith("char")) {
                        const idx = parseInt(assetPickerSlot.slice(4));
                        if (!isNaN(idx)) setCharSlot(idx, file);
                      }
                      setAssetPickerSlot(null);
                    }}
                    style={{
                      borderRadius: 10, overflow: "hidden", cursor: "pointer",
                      border: "2px solid transparent", transition: "border-color 0.12s",
                      position: "relative",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.outline = "2px solid var(--accent)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.outline = "none"; }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt="" style={{ width: "100%", display: "block" }} />
                    <div style={{
                      position: "absolute", bottom: 0, left: 0, right: 0,
                      padding: "1.25rem 0.5rem 0.4rem",
                      background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%)",
                      fontSize: 9, color: "rgba(255,255,255,0.65)", lineHeight: 1.3,
                    }}>
                      {gen.model.name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TIMELINE SECTION ─────────────────────────────────────── */}
      {section === "timeline" && (() => {
        const currentTl = tlProjects.find(p => p.id === currentTlId) ?? null;
        const selectedKf = currentTl?.keyframes.find(k => k.id === selectedKfId) ?? null;
        const imageModels = getImageModels();

        // ── Helpers ──────────────────────────────────────────────────────────

        function saveTl(project: TLProject) {
          setTlProjects(prev => {
            const idx = prev.findIndex(p => p.id === project.id);
            if (idx >= 0) { const n = [...prev]; n[idx] = project; return n; }
            return [project, ...prev];
          });
          fetch("/api/timelines/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project }) });
        }

        function newProject() {
          const p: TLProject = {
            id: crypto.randomUUID(), name: "Untitled timeline",
            durationMs: 10000, keyframes: [], transitions: [], createdAt: new Date().toISOString(),
          };
          saveTl(p);
          setCurrentTlId(p.id);
          setSelectedKfId(null);
        }

        function addKeyframe(e: React.MouseEvent<HTMLDivElement>) {
          if (!currentTl) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
          const raw = Math.round((x / rect.width) * currentTl.durationMs);
          const timeMs = Math.round(raw / 100) * 100;
          if (currentTl.keyframes.some(k => Math.abs(k.timeMs - timeMs) < 300)) return;
          const kf: TLKeyframe = { id: crypto.randomUUID(), timeMs, image: null, prompt: "" };
          const updated = { ...currentTl, keyframes: [...currentTl.keyframes, kf].sort((a, b) => a.timeMs - b.timeMs) };
          saveTl(updated);
          setSelectedKfId(kf.id);
          setTlPrompt("");
          setTlError(null);
        }

        function removeKeyframe(kfId: string) {
          if (!currentTl) return;
          const updated = {
            ...currentTl,
            keyframes: currentTl.keyframes.filter(k => k.id !== kfId),
            transitions: currentTl.transitions.filter(t => t.fromId !== kfId && t.toId !== kfId),
          };
          saveTl(updated);
          if (selectedKfId === kfId) { setSelectedKfId(null); setTlPrompt(""); }
          fetch("/api/timelines/keyframe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: currentTl.id, keyframeId: kfId }) });
        }

        async function generateKfImage(model: ModelConfig) {
          if (!currentTl || !selectedKfId) return;
          const needsPrompt = tlGenMode === "generate";
          if (needsPrompt && !tlPrompt.trim()) { setTlError("Please enter a prompt"); return; }
          const needsRef = tlGenMode === "style" || tlGenMode === "character" || tlGenMode === "moment";
          if (needsRef && !tlKfRefUrl) { setTlError("Pick a reference image first"); return; }
          setTlGenerating(true); setTlError(null);
          try {
            const fd = new FormData();
            fd.set("modelId", model.id); fd.set("aspectRatio", "16:9");
            if (tlGenMode === "style") {
              fd.set("prompt", tlPrompt || ""); fd.set("genType", "style-transfer");
              const refFile = await urlToFile(tlKfRefUrl!, "style-ref.png");
              fd.append("styleImage", refFile);
              // Use existing kf image as content, or the style ref itself
              const selectedKfImg = currentTl.keyframes.find(k => k.id === selectedKfId)?.image;
              const contentFile = selectedKfImg ? await urlToFile(selectedKfImg, "content.png") : refFile;
              fd.append("contentImage", contentFile);
            } else if (tlGenMode === "character") {
              fd.set("prompt", tlPrompt || "A cinematic scene"); fd.set("genType", "character-transfer");
              const refFile = await urlToFile(tlKfRefUrl!, "character.png");
              fd.append("character1", refFile);
            } else if (tlGenMode === "moment") {
              fd.set("prompt", tlPrompt || ""); fd.set("genType", "moment");
              const refFile = await urlToFile(tlKfRefUrl!, "moment.png");
              fd.append("momentImage", refFile);
              fd.set("momentDirection", "after"); fd.set("momentSeconds", "3");
            } else {
              fd.set("prompt", tlPrompt); fd.set("genType", "prompt");
            }
            const res = await fetch("/api/generate-image", { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok || !data.images?.[0]) throw new Error(data.error || "No image returned");
            const saveRes = await fetch("/api/timelines/keyframe", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId: currentTl.id, keyframeId: selectedKfId, image: data.images[0] }),
            });
            const saved = await saveRes.json();
            const updated = { ...currentTl, keyframes: currentTl.keyframes.map(k => k.id === selectedKfId ? { ...k, image: saved.path, prompt: tlPrompt } : k) };
            saveTl(updated);
          } catch (e) { setTlError(e instanceof Error ? e.message : "Failed"); }
          finally { setTlGenerating(false); }
        }

        function assignAssetToKf(imgUrl: string) {
          if (!currentTl || !selectedKfId) return;
          const updated = { ...currentTl, keyframes: currentTl.keyframes.map(k => k.id === selectedKfId ? { ...k, image: imgUrl } : k) };
          saveTl(updated);
        }
        tlKfPickCallback.current = assignAssetToKf;
        tlKfRefCallback.current = (imgUrl: string) => { setTlKfRefUrl(imgUrl); };

        async function generateClip(fromKf: TLKeyframe, toKf: TLKeyframe) {
          if (!currentTl || !fromKf.image || !toKf.image) return;
          const clipKey = `${fromKf.id}-${toKf.id}`;
          setTlClips(p => ({ ...p, [clipKey]: "generating" }));
          const addOrUpdateTrans = (status: string, videoUrl?: string) => {
            setTlProjects(prev => prev.map(p => {
              if (p.id !== currentTl.id) return p;
              const existing = p.transitions.find(t => t.fromId === fromKf.id && t.toId === toKf.id);
              const transitions = existing
                ? p.transitions.map(t => t.fromId === fromKf.id && t.toId === toKf.id ? { ...t, status: status as TLTransition["status"], videoUrl: videoUrl ?? t.videoUrl } : t)
                : [...p.transitions, { fromId: fromKf.id, toId: toKf.id, videoUrl: videoUrl ?? null, status: status as TLTransition["status"] }];
              return { ...p, transitions };
            }));
          };
          try {
            const videoModels = getVideoModels();
            const klingModel = videoModels.find(m => m.id.includes("kling")) ?? videoModels[0];
            const durSec = Math.min(10, Math.max(2, Math.round((toKf.timeMs - fromKf.timeMs) / 1000)));
            const [startFile, endFile] = await Promise.all([
              urlToFile(fromKf.image, "start.png"),
              urlToFile(toKf.image, "end.png"),
            ]);
            const fd = new FormData();
            fd.set("prompt", "Smooth cinematic transition between two scenes");
            fd.set("model", JSON.stringify(klingModel));
            fd.set("duration", String(durSec));
            fd.set("aspectRatio", "16:9");
            fd.set("startFrame", startFile);
            if (klingModel.supportsEndFrame) fd.set("endFrame", endFile);
            const res = await fetch("/api/generate-video", { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Clip generation failed");
            addOrUpdateTrans("generating", undefined);
            // Poll for video
            const taskId = data.taskId; const endpoint = data.endpoint ?? "piapi";
            const pollId = setInterval(async () => {
              try {
                const sr = await fetch(`/api/video-status?taskId=${taskId}&endpoint=${endpoint}`);
                const sd = await sr.json();
                if (sd.status === "succeed" && sd.videoUrl) {
                  clearInterval(pollId);
                  const saveRes = await fetch("/api/timelines/keyframe", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectId: currentTl.id, keyframeId: clipKey, videoUrl: sd.videoUrl, isTransition: true }),
                  });
                  const saved = await saveRes.json();
                  addOrUpdateTrans("done", saved.path);
                  setTlClips(p => ({ ...p, [clipKey]: "done" }));
                  // Persist updated project
                  setTlProjects(prev => {
                    const proj = prev.find(p => p.id === currentTl.id);
                    if (proj) fetch("/api/timelines/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: proj }) });
                    return prev;
                  });
                } else if (sd.status === "failed") {
                  clearInterval(pollId);
                  addOrUpdateTrans("idle");
                  setTlClips(p => { const n = { ...p }; delete n[clipKey]; return n; });
                }
              } catch { /* retry */ }
            }, 5000);
          } catch (e) {
            setTlError(e instanceof Error ? e.message : "Clip failed");
            setTlClips(p => { const n = { ...p }; delete n[clipKey]; return n; });
          }
        }

        const tlBtnStyle = (active = false): React.CSSProperties => ({
          padding: "0.35rem 0.9rem", borderRadius: 20, border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
          background: active ? "var(--accent)" : "var(--surface2)", color: active ? "var(--bg)" : "var(--text-muted)",
          fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" as const,
        });

        const durOptions = [5000, 10000, 15000, 20000, 30000, 60000];

        // ── Preview mode ─────────────────────────────────────────────────────
        if (tlPreview && currentTl) {
          const frames = currentTl.keyframes;
          const curKf = frames[tlPreviewIdx] ?? null;
          const transition = tlPreviewIdx < frames.length - 1
            ? currentTl.transitions.find(t => t.fromId === frames[tlPreviewIdx]?.id && t.toId === frames[tlPreviewIdx + 1]?.id)
            : undefined;
          return (
            <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              {/* Close */}
              <button onClick={() => setTlPreview(false)} style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.1)", border: "none", color: "white", borderRadius: "50%", width: 36, height: 36, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>{IC.close()}</button>
              {/* Frame */}
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
                {curKf?.image
                  ? <img src={curKf.image} alt="" style={{ maxWidth: "85vw", maxHeight: "75vh", borderRadius: 12, objectFit: "contain" }} />
                  : <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>No image for this keyframe</div>
                }
              </div>
              {/* Clip below frame */}
              {transition?.videoUrl && (
                <video src={transition.videoUrl} autoPlay muted style={{ width: "85vw", maxHeight: "20vh", borderRadius: 8, marginBottom: 8 }} />
              )}
              {/* Navigation */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 0 24px", color: "white" }}>
                <button onClick={() => setTlPreviewIdx(i => Math.max(0, i - 1))} disabled={tlPreviewIdx === 0} style={{ ...tlBtnStyle(), color: "white", opacity: tlPreviewIdx === 0 ? 0.3 : 1 }}>{IC.arrowL(14)} Prev</button>
                <span style={{ fontSize: 12, opacity: 0.5 }}>{tlPreviewIdx + 1} / {frames.length}</span>
                <button onClick={() => setTlPreviewIdx(i => Math.min(frames.length - 1, i + 1))} disabled={tlPreviewIdx >= frames.length - 1} style={{ ...tlBtnStyle(), color: "white", opacity: tlPreviewIdx >= frames.length - 1 ? 0.3 : 1 }}>Next {IC.arrowR(14)}</button>
              </div>
            </div>
          );
        }

        // ── Project list ──────────────────────────────────────────────────────
        if (!currentTlId) return (
          <div style={{ position: "fixed", left: sidebarWidth, right: 68, top: 0, bottom: 0, zIndex: 10, background: "var(--bg)", overflowY: "auto", padding: "2rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2rem" }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.03em" }}>Timeline</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Build a scene frame by frame, generate transitions, export a movie.</div>
              </div>
              <button onClick={newProject} style={{ padding: "0.5rem 1.1rem", borderRadius: 20, background: "var(--accent)", border: "none", color: "var(--bg)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ New Timeline</button>
            </div>
            {tlProjects.length === 0 ? (
              <div style={{ textAlign: "center", padding: "5rem 0", color: "var(--text-muted)", opacity: 0.4 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎬</div>
                <div>No timelines yet. Create your first one.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                {tlProjects.map(p => {
                  const thumb = p.keyframes.find(k => k.image)?.image;
                  return (
                    <div key={p.id} onClick={() => { setCurrentTlId(p.id); setSelectedKfId(null); setTlPrompt(""); }}
                      style={{ borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", overflow: "hidden", transition: "border-color 0.15s" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"}
                    >
                      <div style={{ height: 110, background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                        {thumb
                          ? <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : <span style={{ fontSize: 28, opacity: 0.2 }}>🎬</span>
                        }
                      </div>
                      <div style={{ padding: "0.75rem 0.9rem 0.85rem" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.keyframes.length} keyframe{p.keyframes.length !== 1 ? "s" : ""} · {p.durationMs / 1000}s</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );

        // ── Editor ────────────────────────────────────────────────────────────
        const sortedKfs = [...(currentTl?.keyframes ?? [])].sort((a, b) => a.timeMs - b.timeMs);

        return (
          <div style={{ position: "fixed", left: sidebarWidth, right: 68, top: 0, bottom: 0, zIndex: 10, background: "var(--bg)", display: "flex", flexDirection: "column" }}>

            {/* Header */}
            <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <button onClick={() => { setCurrentTlId(null); setSelectedKfId(null); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0 4px", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>{IC.arrowL(14)} <span>All timelines</span></button>
              <div style={{ width: 1, height: 16, background: "var(--border)" }} />
              <input
                value={currentTl?.name ?? ""}
                onChange={e => { if (currentTl) saveTl({ ...currentTl, name: e.target.value }); }}
                style={{ background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 14, fontWeight: 600, flex: 1 }}
              />
              {/* Duration */}
              <select value={currentTl?.durationMs ?? 10000}
                onChange={e => { if (currentTl) saveTl({ ...currentTl, durationMs: Number(e.target.value) }); }}
                style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 8, padding: "0.2rem 0.5rem", fontSize: 12, cursor: "pointer" }}>
                {durOptions.map(d => <option key={d} value={d}>{d / 1000}s</option>)}
              </select>
              {/* Preview */}
              {sortedKfs.length > 0 && (
                <button onClick={() => { setTlPreview(true); setTlPreviewIdx(0); }}
                  style={{ padding: "0.3rem 0.9rem", borderRadius: 20, background: "var(--accent)", border: "none", color: "var(--bg)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                  {IC.play(12)} Preview
                </button>
              )}
              {/* Delete project */}
              <button onClick={() => {
                if (!confirm("Delete this timeline? This cannot be undone.")) return;
                fetch("/api/timelines/save", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: currentTl?.id }) });
                setTlProjects(prev => prev.filter(p => p.id !== currentTlId));
                setCurrentTlId(null);
              }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", opacity: 0.5, padding: "0 4px" }}>{IC.close(13)}</button>
            </div>

            {/* Main scrollable area */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>

              {/* Film strip */}
              <div style={{ padding: "1.25rem 1.25rem 0.75rem", overflowX: "auto" }}>
                <div style={{ display: "flex", alignItems: "stretch", gap: 0, minWidth: "max-content" }}>
                  {sortedKfs.length === 0 && (
                    <div style={{ color: "var(--text-muted)", fontSize: 12, opacity: 0.4, padding: "1rem 0" }}>
                      Click on the timeline bar below to add your first keyframe.
                    </div>
                  )}
                  {sortedKfs.map((kf, i) => {
                    const isSelected = kf.id === selectedKfId;
                    const nextKf = sortedKfs[i + 1];
                    const clipKey = nextKf ? `${kf.id}-${nextKf.id}` : null;
                    const trans = nextKf ? currentTl?.transitions.find(t => t.fromId === kf.id && t.toId === nextKf.id) : null;
                    const clipStatus = clipKey ? tlClips[clipKey] : null;

                    return (
                      <div key={kf.id} style={{ display: "flex", alignItems: "center" }}>
                        {/* Keyframe card */}
                        <div onClick={() => { setSelectedKfId(isSelected ? null : kf.id); setTlPrompt(kf.prompt || ""); setTlError(null); }}
                          style={{
                            width: 120, borderRadius: 10, overflow: "hidden", cursor: "pointer", flexShrink: 0,
                            border: `2px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                            background: "var(--surface)", transition: "border-color 0.15s",
                          }}>
                          {/* Thumbnail */}
                          <div style={{ height: 75, background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                            {kf.image
                              ? <img src={kf.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              : <span style={{ fontSize: 22, opacity: 0.18 }}>+</span>
                            }
                            {/* Remove btn */}
                            <button onClick={e => { e.stopPropagation(); removeKeyframe(kf.id); }}
                              style={{ position: "absolute", top: 3, right: 3, width: 18, height: 18, borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "none", color: "white", fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0 }}
                              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = "1"}
                              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = "0"}
                            >{IC.close(8)}</button>
                          </div>
                          <div style={{ padding: "4px 6px 5px", fontSize: 9, color: "var(--text-muted)", textAlign: "center" }}>
                            {(kf.timeMs / 1000).toFixed(1)}s
                          </div>
                        </div>

                        {/* Connector / Generate clip */}
                        {nextKf && (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 6px", gap: 4, flexShrink: 0 }}>
                            {trans?.videoUrl ? (
                              <video src={trans.videoUrl} style={{ width: 60, height: 34, objectFit: "cover", borderRadius: 6 }} muted loop autoPlay />
                            ) : (
                              <div style={{ width: 60, height: 2, background: "var(--border)", borderRadius: 1 }} />
                            )}
                            {kf.image && nextKf.image && !trans?.videoUrl && (
                              <button
                                disabled={clipStatus === "generating"}
                                onClick={e => { e.stopPropagation(); generateClip(kf, nextKf); }}
                                style={{ ...tlBtnStyle(), padding: "2px 7px", fontSize: 9, opacity: clipStatus === "generating" ? 0.5 : 1 }}
                              >
                                {clipStatus === "generating" ? "…" : "▶ Clip"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Keyframe generation panel */}
              {selectedKf && (
                <div style={{ margin: "0 1.25rem 1rem", padding: "1rem 1.1rem", borderRadius: 12, border: "1px solid var(--accent)", background: "var(--surface)", flexShrink: 0 }}>
                  {/* Header row: title + mode tabs */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Keyframe · {(selectedKf.timeMs / 1000).toFixed(1)}s
                    </div>
                    <div style={{ display: "flex", gap: 3 }}>
                      {(["generate", "style", "character", "moment"] as const).map(m => {
                        const labels = { generate: "✦ Gen", style: "🎨 Style", character: "👤 Char", moment: "⏱ Moment" };
                        return (
                          <button key={m} onClick={() => { setTlGenMode(m); setTlKfRefUrl(null); setTlError(null); }}
                            style={{ background: tlGenMode === m ? "var(--accent)" : "transparent", border: `1px solid ${tlGenMode === m ? "var(--accent)" : "var(--border)"}`, color: tlGenMode === m ? "#000" : "var(--text-muted)", borderRadius: 6, fontSize: 9, fontWeight: 600, padding: "2px 7px", cursor: "pointer", whiteSpace: "nowrap" }}>
                            {labels[m]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Reference image slot for style/character/moment */}
                  {(tlGenMode === "style" || tlGenMode === "character" || tlGenMode === "moment") && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {tlGenMode === "style" ? "Style ref:" : tlGenMode === "character" ? "Character:" : "Moment ref:"}
                      </div>
                      {tlKfRefUrl ? (
                        <div style={{ position: "relative", display: "inline-flex" }}>
                          <img src={tlKfRefUrl} alt="" style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 6, border: "1px solid var(--accent)" }} />
                          <button onClick={() => setTlKfRefUrl(null)} style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: "#1a1d2e", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 5 }}>
                          <button style={{ ...tlBtnStyle(), fontSize: 11 }} onClick={() => setAssetPickerSlot("tl-kf-ref" as never)}>
                            📁 Assets
                          </button>
                          <button style={{ ...tlBtnStyle(), fontSize: 11 }} onClick={() => openWebcamForSlot("tl-kf-ref")}>
                            📷 Webcam
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <textarea
                    value={tlPrompt}
                    onChange={e => setTlPrompt(e.target.value)}
                    placeholder={tlGenMode === "style" ? "Optional style notes…" : tlGenMode === "character" ? "Describe the scene…" : tlGenMode === "moment" ? "Describe what happens next…" : "Describe this frame…"}
                    rows={2}
                    style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 13, padding: "0.5rem 0.7rem", resize: "none", outline: "none", boxSizing: "border-box", marginBottom: 8 }}
                  />
                  {tlError && <div style={{ fontSize: 11, color: "#f87171", marginBottom: 6 }}>{tlError}</div>}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {tlGenMode === "generate" && allAssets.filter(a => a.type === "image").length > 0 && (
                      <button style={{ ...tlBtnStyle(), fontSize: 11 }}
                        onClick={() => setAssetPickerSlot("tl-kf" as never)}>
                        📁 From assets
                      </button>
                    )}
                    {imageModels.slice(0, 4).map(m => (
                      <button key={m.id} disabled={tlGenerating} onClick={() => generateKfImage(m)}
                        style={{ ...tlBtnStyle(false), opacity: tlGenerating ? 0.5 : 1, fontSize: 11 }}>
                        {tlGenerating ? "Generating…" : `Generate · ${m.name}`}
                      </button>
                    ))}
                  </div>
                  {/* Show current image */}
                  {selectedKf.image && (
                    <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                      <img src={selectedKf.image} alt="" style={{ width: 80, height: 50, objectFit: "cover", borderRadius: 6 }} />
                      <button onClick={() => { if (!currentTl) return; saveTl({ ...currentTl, keyframes: currentTl.keyframes.map(k => k.id === selectedKfId ? { ...k, image: null } : k) }); }} style={{ ...tlBtnStyle(), fontSize: 10, color: "#f87171" }}>Remove image</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Timeline bar ── */}
            <div style={{ flexShrink: 0, background: "#0d0f1a", borderTop: "1px solid rgba(255,255,255,0.06)", padding: "0.65rem 1.25rem 1rem", overflow: "visible" }}>
              {/* Meta row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: "0.04em" }}>
                  {currentTl?.keyframes.length ?? 0} keyframe{(currentTl?.keyframes.length ?? 0) !== 1 ? "s" : ""} · click track to add
                </span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{(currentTl?.durationMs ?? 10000) / 1000}s</span>
              </div>

              {/* Track */}
              <div
                ref={tlBarRef}
                onClick={addKeyframe}
                onMouseMove={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const ms = Math.round(pct * (currentTl?.durationMs ?? 10000));
                  const secs = Math.floor(ms / 1000);
                  const label = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
                  if (tlTooltipRef.current) {
                    tlTooltipRef.current.textContent = label;
                    tlTooltipRef.current.style.left = `${e.clientX - rect.left}px`;
                    tlTooltipRef.current.style.opacity = "1";
                  }
                }}
                onMouseLeave={() => { if (tlTooltipRef.current) tlTooltipRef.current.style.opacity = "0"; }}
                style={{
                  position: "relative",
                  height: 80,
                  background: "rgba(255,255,255,0.035)",
                  borderRadius: 14,
                  cursor: "crosshair",
                  border: "1px solid rgba(255,255,255,0.07)",
                  overflow: "visible",
                }}
              >
                {/* Hover time tooltip */}
                <div ref={tlTooltipRef} style={{
                  position: "absolute", bottom: "calc(100% + 10px)", transform: "translateX(-50%)",
                  background: "rgba(10,12,24,0.92)", backdropFilter: "blur(10px)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
                  padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "white",
                  pointerEvents: "none", opacity: 0, transition: "opacity 0.1s",
                  whiteSpace: "nowrap", zIndex: 20,
                }} />

                {/* Subtle tick marks */}
                {Array.from({ length: Math.floor((currentTl?.durationMs ?? 10000) / 1000) + 1 }).map((_, i) => {
                  const pct = (i / ((currentTl?.durationMs ?? 10000) / 1000)) * 100;
                  if (pct > 99) return null;
                  return (
                    <div key={i} style={{ position: "absolute", left: `${pct}%`, bottom: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 0, pointerEvents: "none" }}>
                      <div style={{ width: 1, height: 5, background: "rgba(255,255,255,0.1)" }} />
                      {i % 2 === 0 && <span style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", marginTop: 1, userSelect: "none" }}>{i}s</span>}
                    </div>
                  );
                })}

                {/* Track center line */}
                <div style={{ position: "absolute", left: "1%", right: "1%", top: "50%", height: 1, background: "rgba(255,255,255,0.06)", transform: "translateY(-50%)", pointerEvents: "none" }} />

                {/* Keyframe thumbnails */}
                {sortedKfs.map((kf, idx) => {
                  const pct = (kf.timeMs / (currentTl?.durationMs ?? 10000)) * 100;
                  const isSelected = kf.id === selectedKfId;
                  const dotColors = ["#22d3ee", "#fbbf24", "#f472b6", "#a78bfa", "#34d399", "#fb923c", "#60a5fa", "#e879f9"];
                  const dotColor = dotColors[idx % dotColors.length];
                  return (
                    <div key={kf.id}
                      style={{ position: "absolute", left: `${pct}%`, top: "50%", transform: "translate(-50%, -50%)", zIndex: tlHoverKfId === kf.id ? 8 : isSelected ? 4 : 2, userSelect: "none" }}
                      onMouseEnter={() => { if (tlHoverTimer.current) clearTimeout(tlHoverTimer.current); setTlHoverKfId(kf.id); }}
                      onMouseLeave={() => { tlHoverTimer.current = setTimeout(() => setTlHoverKfId(null), 180); }}
                      onMouseDown={e => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        e.preventDefault();
                        const outerEl = e.currentTarget;
                        const trackEl = tlBarRef.current;
                        if (!trackEl || !currentTl) return;
                        const trackRect = trackEl.getBoundingClientRect();
                        const startX = e.clientX;
                        const startTimeMs = kf.timeMs;
                        let moved = false;
                        outerEl.style.zIndex = "6";
                        const onMove = (me: MouseEvent) => {
                          const dx = me.clientX - startX;
                          if (!moved && Math.abs(dx) < 5) return;
                          moved = true;
                          me.preventDefault();
                          outerEl.style.cursor = "grabbing";
                          const rawPct = startTimeMs / currentTl.durationMs + dx / trackRect.width;
                          outerEl.style.left = `${Math.max(0, Math.min(100, rawPct * 100))}%`;
                        };
                        const onUp = (me: MouseEvent) => {
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                          outerEl.style.zIndex = isSelected ? "4" : "2";
                          outerEl.style.cursor = "";
                          if (!moved) return;
                          window.addEventListener("click", ev => ev.stopPropagation(), { once: true, capture: true });
                          const dx = me.clientX - startX;
                          const rawMs = Math.round((startTimeMs + (dx / trackRect.width) * currentTl.durationMs) / 100) * 100;
                          const newTimeMs = Math.max(0, Math.min(currentTl.durationMs, rawMs));
                          const clash = currentTl.keyframes.some(k => k.id !== kf.id && Math.abs(k.timeMs - newTimeMs) < 300);
                          if (!clash) {
                            saveTl({ ...currentTl, keyframes: currentTl.keyframes.map(k => k.id === kf.id ? { ...k, timeMs: newTimeMs } : k).sort((a, b) => a.timeMs - b.timeMs) });
                          } else {
                            outerEl.style.left = `${(startTimeMs / currentTl.durationMs) * 100}%`;
                          }
                        };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                      }}
                    >
                      {/* Drop-up menu on hover */}
                      {tlHoverKfId === kf.id && (
                        <div
                          onClick={e => e.stopPropagation()}
                          onMouseEnter={() => { if (tlHoverTimer.current) clearTimeout(tlHoverTimer.current); }}
                          onMouseLeave={() => { tlHoverTimer.current = setTimeout(() => setTlHoverKfId(null), 80); }}
                          style={{ position: "absolute", bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)", background: "rgba(10,12,24,0.97)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "0.35rem", display: "flex", flexDirection: "column", gap: 1, zIndex: 30, minWidth: 156, boxShadow: "0 16px 48px rgba(0,0,0,0.8)", whiteSpace: "nowrap" }}
                        >
                          <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", padding: "3px 10px 5px", textTransform: "uppercase" }}>{(kf.timeMs / 1000).toFixed(1)}s</div>
                          {([
                            { icon: "📁", label: "From assets", action: () => { setSelectedKfId(kf.id); setTlPrompt(kf.prompt || ""); setTlGenMode("generate"); setTlKfRefUrl(null); setAssetPickerSlot("tl-kf" as never); } },
                            { icon: "✦", label: "Generate", action: () => { setSelectedKfId(kf.id); setTlPrompt(kf.prompt || ""); setTlGenMode("generate"); setTlKfRefUrl(null); setTlError(null); } },
                            { icon: "🎨", label: "Style transfer", action: () => { setSelectedKfId(kf.id); setTlPrompt(kf.prompt || ""); setTlGenMode("style"); setTlKfRefUrl(null); setTlError(null); } },
                            { icon: "👤", label: "Character", action: () => { setSelectedKfId(kf.id); setTlPrompt(kf.prompt || ""); setTlGenMode("character"); setTlKfRefUrl(null); setTlError(null); } },
                            { icon: "⏱", label: "Moment", action: () => { setSelectedKfId(kf.id); setTlPrompt(kf.prompt || ""); setTlGenMode("moment"); setTlKfRefUrl(null); setTlError(null); } },
                          ] as { icon: string; label: string; action: () => void }[]).map(item => (
                            <button key={item.label} onClick={() => { item.action(); setTlHoverKfId(null); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.8)", cursor: "pointer", fontSize: 12, textAlign: "left", padding: "5px 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 8, width: "100%" }} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)"; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}>
                              <span style={{ width: 18, textAlign: "center", fontSize: item.icon === "✦" ? 10 : 14 }}>{item.icon}</span>{item.label}
                            </button>
                          ))}
                          <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "3px 4px" }} />
                          <button onClick={() => { removeKeyframe(kf.id); setTlHoverKfId(null); }} style={{ background: "none", border: "none", color: "rgba(248,113,113,0.75)", cursor: "pointer", fontSize: 12, textAlign: "left", padding: "5px 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 8, width: "100%" }} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(248,113,113,0.08)"; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}>
                            <span style={{ width: 18, textAlign: "center" }}>✕</span>Remove keyframe
                          </button>
                          <div style={{ position: "absolute", bottom: -4, left: "50%", transform: "translateX(-50%) rotate(45deg)", width: 7, height: 7, background: "rgba(10,12,24,0.97)", borderRight: "1px solid rgba(255,255,255,0.1)", borderBottom: "1px solid rgba(255,255,255,0.1)" }} />
                        </div>
                      )}
                      {/* Thumbnail card */}
                      <div
                        onClick={e => { e.stopPropagation(); setSelectedKfId(isSelected ? null : kf.id); setTlPrompt(kf.prompt || ""); setTlError(null); }}
                        style={{
                          width: 82, height: 52,
                          borderRadius: 8, overflow: "hidden",
                          border: `2px solid ${isSelected ? "#fbbf24" : "rgba(255,255,255,0.12)"}`,
                          boxShadow: isSelected
                            ? "0 0 0 2px rgba(251,191,36,0.35), 0 6px 20px rgba(0,0,0,0.7)"
                            : "0 3px 12px rgba(0,0,0,0.6)",
                          cursor: "grab",
                          background: "#1a1d2e",
                          transition: "border-color 0.15s, box-shadow 0.15s",
                          flexShrink: 0,
                        }}
                      >
                        {kf.image
                          ? <img src={kf.image} alt="" draggable={false} onDragStart={e => e.preventDefault()} style={{ width: "100%", height: "100%", objectFit: "cover", userSelect: "none" }} />
                          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, opacity: 0.15 }}>+</div>
                        }
                      </div>
                      {/* Colored dot below card */}
                      <div style={{
                        position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)",
                        width: 7, height: 7, borderRadius: "50%",
                        background: dotColor, boxShadow: `0 0 8px ${dotColor}99`,
                      }} />
                    </div>
                  );
                })}

                {/* Playhead (shows on selected keyframe) */}
                {selectedKfId && currentTl && (() => {
                  const kf = currentTl.keyframes.find(k => k.id === selectedKfId);
                  if (!kf) return null;
                  const pct = (kf.timeMs / currentTl.durationMs) * 100;
                  return (
                    <div style={{ position: "absolute", left: `${pct}%`, top: -2, bottom: -2, transform: "translateX(-50%)", pointerEvents: "none", zIndex: 5 }}>
                      <div style={{ position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "7px solid #22d3ee" }} />
                      <div style={{ position: "absolute", top: 6, bottom: 0, left: "50%", transform: "translateX(-50%)", width: 1, background: "rgba(34,211,238,0.5)" }} />
                    </div>
                  );
                })()}

                {/* Empty state */}
                {sortedKfs.length === 0 && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "rgba(255,255,255,0.18)", pointerEvents: "none", gap: 6 }}>
                    <span style={{ opacity: 0.5 }}>✦</span> Click anywhere to place your first keyframe
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── LIGHTBOX ─────────────────────────────────────────────── */}
      {lightbox && (() => {
        const { urls, prompts, types, idx } = lightbox;
        const isVideo = types[idx] === "video";
        const navBtn = (dir: "prev" | "next") => {
          const disabled = dir === "prev" ? idx === 0 : idx === urls.length - 1;
          if (disabled) return null;
          return (
            <button
              onClick={e => { e.stopPropagation(); setLightbox({ urls, prompts, types, idx: dir === "prev" ? idx - 1 : idx + 1 }); }}
              style={{
                position: "fixed", top: "50%", transform: "translateY(-50%)",
                [dir === "prev" ? "left" : "right"]: 20,
                width: 44, height: 44, borderRadius: "50%",
                background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.18)",
                color: "white", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.22)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.12)"; }}
            >{dir === "prev" ? IC.arrowL() : IC.arrowR()}</button>
          );
        };
        return (
          <div
            onClick={() => setLightbox(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 1000,
              background: "rgba(0,0,0,0.88)", backdropFilter: "blur(12px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "zoom-out",
            }}
          >
            {navBtn("prev")}
            {/* Image + prompt hover overlay */}
            <div onClick={e => e.stopPropagation()} style={{ position: "relative", cursor: "default", lineHeight: 0 }}
              onMouseEnter={e => { const ov = (e.currentTarget as HTMLElement).querySelector(".lb-prompt") as HTMLElement | null; if (ov) ov.style.opacity = "1"; }}
              onMouseLeave={e => { const ov = (e.currentTarget as HTMLElement).querySelector(".lb-prompt") as HTMLElement | null; if (ov) ov.style.opacity = "0"; }}
            >
              {isVideo ? (
                <video
                  src={urls[idx]}
                  controls
                  autoPlay
                  style={{ maxWidth: "88vw", maxHeight: "88vh", borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", display: "block" }}
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={urls[idx]}
                  alt="Full size"
                  style={{ maxWidth: "88vw", maxHeight: "88vh", borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", display: "block" }}
                />
              )}
              {!isVideo && prompts[idx] && (
                <div className="lb-prompt" style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 100%)",
                  borderRadius: "0 0 16px 16px",
                  padding: "3rem 1.25rem 1.125rem",
                  opacity: 0, transition: "opacity 0.2s",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                    <div style={{ color: "rgba(255,255,255,0.9)", fontSize: 12, lineHeight: 1.55, fontWeight: 400, flex: 1 }}>
                      {prompts[idx]}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); copyPrompt(prompts[idx], `lb-${idx}`); }}
                      style={{
                        flexShrink: 0, height: 30, borderRadius: 20,
                        background: "rgba(255,255,255,0.15)", backdropFilter: "blur(6px)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        color: "white", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "0 10px 0 8px", fontSize: 11, fontWeight: 500,
                      }}
                    >
                      {copiedPromptId === `lb-${idx}`
                        ? <><span style={{ fontSize: 10, fontWeight: 700 }}>✓</span><span>Copied!</span></>
                        : <>{IC.copy(11)}<span>Copy prompt</span></>
                      }
                    </button>
                  </div>
                </div>
              )}
            </div>
            {navBtn("next")}
            {/* Counter */}
            {urls.length > 1 && (
              <div onClick={e => e.stopPropagation()} style={{
                position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
                background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: 500,
                padding: "4px 14px", borderRadius: 20,
              }}>{idx + 1} / {urls.length}</div>
            )}
            {/* Close button */}
            <button
              onClick={() => setLightbox(null)}
              style={{
                position: "fixed", top: 20, right: 20,
                width: 40, height: 40, borderRadius: "50%",
                background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.18)",
                color: "white", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.22)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.12)"; }}
            >{IC.close()}</button>
          </div>
        );
      })()}

    </div>
  );
}

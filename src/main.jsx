import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  FileAudio,
  Film,
  Image as ImageIcon,
  Loader2,
  Music2,
  Play,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud,
  Volume2,
  VolumeX
} from "lucide-react";
import "./styles.css";

const defaultSettings = {
  aspect: "reel",
  resolution: "full",
  fps: 30,
  background: "#111214",
  visualOptimize: "off",
  audioDenoise: "off",
  vocalMode: "none",
  musicVolume: 0.82,
  outputName: "auto-reel"
};

const defaultScene = {
  duration: 4,
  fit: "cover",
  motion: "zoomIn",
  transitionEffect: "fade",
  transition: 0.25,
  trimStart: 0
};

function App() {
  const [visuals, setVisuals] = useState([]);
  const [audio, setAudio] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [batch, setBatch] = useState({
    duration: 4,
    fit: "cover",
    motion: "zoomIn",
    transitionEffect: "fade",
    transition: 0.25
  });
  const [isDragging, setDragging] = useState(false);
  const [isUploading, setUploading] = useState(false);
  const [isRendering, setRendering] = useState(false);
  const [renderResult, setRenderResult] = useState(null);
  const [message, setMessage] = useState("");
  const inputRef = useRef(null);

  const totalDuration = useMemo(
    () => visuals.reduce((sum, item) => sum + Number(item.duration || 0), 0),
    [visuals]
  );
  const outputSize = useMemo(() => getOutputSize(settings.aspect, settings.resolution), [settings.aspect, settings.resolution]);
  const musicVolumePercent = Math.round(settings.musicVolume * 100);

  async function uploadFiles(files) {
    const accepted = Array.from(files || []);
    if (!accepted.length) return;

    const form = new FormData();
    accepted.forEach((file) => form.append("files", file));
    setUploading(true);
    setMessage("");
    setRenderResult(null);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: form
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "上傳失敗");

      const addedVisuals = data.files
        .filter((file) => file.kind === "image" || file.kind === "video")
        .map((file) => ({
          ...file,
          duration: file.kind === "video" ? roundDuration(file.duration || 5) : defaultScene.duration,
          fit: defaultScene.fit,
          motion: file.kind === "image" ? defaultScene.motion : "still",
          transitionEffect: defaultScene.transitionEffect,
          transition: defaultScene.transition,
          trimStart: 0
        }));

      const addedAudio = data.files.filter((file) => file.kind === "audio");

      setVisuals((items) => [...items, ...addedVisuals]);
      setAudio((items) => [...items, ...addedAudio]);
      setMessage(`${data.files.length} 個素材已加入`);
    } catch (error) {
      setMessage(error.message || "上傳失敗");
    } finally {
      setUploading(false);
    }
  }

  async function renderVideo() {
    if (!visuals.length || isRendering) return;
    setRendering(true);
    setMessage("");
    setRenderResult(null);

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          visuals: visuals.map(({ id, duration, fit, motion, transitionEffect, transition, trimStart }) => ({
            id,
            duration: Number(duration),
            fit,
            motion,
            transitionEffect,
            transition: Number(transition),
            trimStart: Number(trimStart || 0)
          })),
          audio: audio.map(({ id }) => ({ id })),
          settings
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "輸出失敗");
      setRenderResult(data);
      setMessage("影片已完成");
    } catch (error) {
      setMessage(error.message || "輸出失敗");
    } finally {
      setRendering(false);
    }
  }

  function applyBatch(scope) {
    setVisuals((items) =>
      items.map((item) => {
        if (scope === "images" && item.kind !== "image") return item;
        if (scope === "videos" && item.kind !== "video") return item;
        return {
          ...item,
          duration: Number(batch.duration),
          fit: batch.fit,
          motion: item.kind === "image" ? batch.motion : "still",
          transitionEffect: batch.transitionEffect,
          transition: Number(batch.transition)
        };
      })
    );
  }

  function updateScene(id, patch) {
    setVisuals((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function moveScene(id, offset) {
    setVisuals((items) => {
      const index = items.findIndex((item) => item.id === id);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;
      const copy = [...items];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      return copy;
    });
  }

  function removeScene(id) {
    setVisuals((items) => items.filter((item) => item.id !== id));
  }

  function removeAudio(id) {
    setAudio((items) => items.filter((item) => item.id !== id));
  }

  function changeMusicVolume(percent) {
    const nextPercent = clampNumber(Number(percent), 0, 200);
    setSettings((current) => ({
      ...current,
      musicVolume: Math.round(nextPercent) / 100
    }));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local Reel Builder</p>
          <h1>Auto Reel</h1>
        </div>
        <button className="primary-action" onClick={renderVideo} disabled={!visuals.length || isRendering}>
          {isRendering ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
          <span>{isRendering ? "輸出中" : "產生影片"}</span>
        </button>
      </header>

      <section className="workspace">
        <aside className="side-panel">
          <div
            className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              uploadFiles(event.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
          >
            <UploadCloud size={28} />
            <strong>{isUploading ? "加入素材中" : "丟入素材"}</strong>
            <span>圖片、影片、音樂</span>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              onChange={(event) => uploadFiles(event.target.files)}
            />
          </div>

          <ControlGroup title="批次設定" icon={<Settings2 size={16} />}>
            <label>
              停留秒數
              <input
                type="number"
                min="0.4"
                max="120"
                step="0.1"
                value={batch.duration}
                onChange={(event) => setBatch({ ...batch, duration: event.target.value })}
              />
            </label>
            <label>
              畫面填滿
              <select value={batch.fit} onChange={(event) => setBatch({ ...batch, fit: event.target.value })}>
                <option value="cover">裁切填滿</option>
                <option value="contain">完整留邊</option>
              </select>
            </label>
            <label>
              圖片動態
              <select value={batch.motion} onChange={(event) => setBatch({ ...batch, motion: event.target.value })}>
                <option value="zoomIn">慢速推近</option>
                <option value="zoomOut">慢速拉遠</option>
                <option value="panLeft">向左平移</option>
                <option value="panRight">向右平移</option>
                <option value="panUp">向上平移</option>
                <option value="panDown">向下平移</option>
                <option value="still">靜止</option>
              </select>
            </label>
            <label>
              轉場效果
              <select value={batch.transitionEffect} onChange={(event) => setBatch({ ...batch, transitionEffect: event.target.value })}>
                <option value="fade">柔和淡化</option>
                <option value="dipBlack">淡入黑場</option>
                <option value="flashWhite">白閃</option>
                <option value="none">無</option>
              </select>
            </label>
            <label>
              轉場秒數
              <input
                type="number"
                min="0"
                max="1.2"
                step="0.05"
                value={batch.transition}
                onChange={(event) => setBatch({ ...batch, transition: event.target.value })}
              />
            </label>
            <div className="button-row">
              <button onClick={() => applyBatch("all")}>套用全部</button>
              <button onClick={() => applyBatch("images")}>只套圖片</button>
            </div>
          </ControlGroup>

          <ControlGroup title="輸出" icon={<Sparkles size={16} />}>
            <label>
              比例
              <select value={settings.aspect} onChange={(event) => setSettings({ ...settings, aspect: event.target.value })}>
                <option value="reel">9:16 Reel</option>
                <option value="square">1:1 方形</option>
                <option value="wide">16:9 橫式</option>
              </select>
            </label>
            <label>
              解析度
              <select
                value={settings.resolution}
                onChange={(event) => setSettings({ ...settings, resolution: event.target.value })}
              >
                <option value="full">Full</option>
                <option value="standard">Standard</option>
                <option value="preview">Preview</option>
              </select>
            </label>
            <div className="dimension-hint">
              <span>目前尺寸</span>
              <strong>
                {outputSize.width} x {outputSize.height}
              </strong>
            </div>
            <label>
              畫面自動優化
              <select
                value={settings.visualOptimize}
                onChange={(event) => setSettings({ ...settings, visualOptimize: event.target.value })}
              >
                <option value="off">關閉</option>
                <option value="natural">自然</option>
                <option value="bright">提亮</option>
                <option value="vivid">鮮明</option>
              </select>
            </label>
            <label>
              檔名前綴
              <input
                value={settings.outputName}
                onChange={(event) => setSettings({ ...settings, outputName: event.target.value })}
              />
            </label>
          </ControlGroup>
        </aside>

        <section className="scene-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Scenes</p>
              <h2>素材卡片</h2>
            </div>
            <div className="summary">
              <span>{visuals.length} 個畫面</span>
              <span>{formatSeconds(totalDuration)}</span>
            </div>
          </div>

          {visuals.length === 0 ? (
            <div className="empty-state">
              <Plus size={32} />
              <strong>等待素材</strong>
              <span>加入圖片或影片後，每個素材會變成一張可設定的卡片。</span>
            </div>
          ) : (
            <div className="scene-list">
              {visuals.map((scene, index) => (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  index={index}
                  canMoveUp={index > 0}
                  canMoveDown={index < visuals.length - 1}
                  onChange={(patch) => updateScene(scene.id, patch)}
                  onMove={(offset) => moveScene(scene.id, offset)}
                  onRemove={() => removeScene(scene.id)}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="result-panel">
          <ControlGroup title="音樂" icon={<Music2 size={16} />}>
            <MusicVolumeControl percent={musicVolumePercent} onChange={changeMusicVolume} />
            <AudioProcessingControls settings={settings} onChange={setSettings} />
            {audio.length ? (
              <div className="audio-list">
                {audio.map((item, index) => (
                  <div className="audio-item" key={item.id}>
                    <FileAudio size={18} />
                    <div>
                      <strong>{item.originalName}</strong>
                      <span>Track {index + 1}</span>
                    </div>
                    <button className="icon-button" onClick={() => removeAudio(item.id)} aria-label="移除音樂">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="quiet">尚未加入音樂；仍可輸出無配樂影片。</p>
            )}
          </ControlGroup>

          <div className="render-status">
            <div className="status-icon">
              {isRendering ? <Loader2 className="spin" size={24} /> : renderResult ? <CheckCircle2 size={24} /> : <Film size={24} />}
            </div>
            <div>
              <strong>{renderResult ? "完成" : isRendering ? "正在合成" : "準備輸出"}</strong>
              <span>{message || "9:16 預設，MP4 / H.264"}</span>
            </div>
          </div>

          {renderResult && (
            <div className="output-block">
              <video src={renderResult.url} controls />
              <a className="download-link" href={renderResult.url} download>
                <Download size={18} />
                <span>下載 MP4</span>
              </a>
              <dl>
                <div>
                  <dt>長度</dt>
                  <dd>{formatSeconds(renderResult.duration)}</dd>
                </div>
                <div>
                  <dt>畫面</dt>
                  <dd>
                    {renderResult.width} x {renderResult.height}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function MusicVolumeControl({ percent, onChange }) {
  return (
    <div className="volume-control">
      <div className="volume-head">
        <span>輸出音量</span>
        <strong>{percent}%</strong>
      </div>
      <input
        aria-label="音樂輸出音量"
        type="range"
        min="0"
        max="200"
        step="1"
        value={percent}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="volume-presets">
        <button type="button" onClick={() => onChange(0)}>
          <VolumeX size={15} />
          <span>靜音</span>
        </button>
        <button type="button" onClick={() => onChange(25)}>
          <Volume2 size={15} />
          <span>25%</span>
        </button>
        <button type="button" onClick={() => onChange(50)}>
          <Volume2 size={15} />
          <span>50%</span>
        </button>
        <button type="button" onClick={() => onChange(100)}>
          <Volume2 size={15} />
          <span>100%</span>
        </button>
        <button type="button" onClick={() => onChange(150)}>
          <Volume2 size={15} />
          <span>150%</span>
        </button>
      </div>
      <label className="compact-label">
        精準百分比
        <input
          type="number"
          min="0"
          max="200"
          step="1"
          value={percent}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function AudioProcessingControls({ settings, onChange }) {
  return (
    <div className="processing-grid">
      <label>
        自動降噪
        <select value={settings.audioDenoise} onChange={(event) => onChange({ ...settings, audioDenoise: event.target.value })}>
          <option value="off">關閉</option>
          <option value="light">輕度</option>
          <option value="medium">中度</option>
          <option value="strong">強度</option>
        </select>
      </label>
      <label>
        人聲處理
        <select value={settings.vocalMode} onChange={(event) => onChange({ ...settings, vocalMode: event.target.value })}>
          <option value="none">不處理</option>
          <option value="remove">去除人聲</option>
          <option value="enhance">強化人聲</option>
        </select>
      </label>
    </div>
  );
}

function ControlGroup({ title, icon, children }) {
  return (
    <section className="control-group">
      <div className="group-title">
        {icon}
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function SceneCard({ scene, index, canMoveUp, canMoveDown, onChange, onMove, onRemove }) {
  const isImage = scene.kind === "image";
  const previewUrl = `/api/uploads/${encodeURIComponent(scene.storedName)}`;

  return (
    <article className="scene-card">
      <div className="scene-order">{String(index + 1).padStart(2, "0")}</div>
      <div className="thumb">
        {isImage ? (
          <img src={previewUrl} alt="" />
        ) : (
          <video src={previewUrl} muted />
        )}
        <span>{isImage ? <ImageIcon size={14} /> : <Film size={14} />}</span>
      </div>
      <div className="scene-main">
        <div className="scene-title">
          <strong>{scene.originalName}</strong>
          <span>{scene.width && scene.height ? `${scene.width} x ${scene.height}` : scene.kind}</span>
        </div>
        <div className="scene-controls">
          <label>
            秒數
            <input
              type="number"
              min="0.4"
              max="120"
              step="0.1"
              value={scene.duration}
              onChange={(event) => onChange({ duration: event.target.value })}
            />
          </label>
          {scene.kind === "video" && (
            <label>
              起點
              <input
                type="number"
                min="0"
                step="0.1"
                value={scene.trimStart}
                onChange={(event) => onChange({ trimStart: event.target.value })}
              />
            </label>
          )}
          <label>
            填滿
            <select value={scene.fit} onChange={(event) => onChange({ fit: event.target.value })}>
              <option value="cover">裁切</option>
              <option value="contain">留邊</option>
            </select>
          </label>
          {isImage && (
            <label>
              動態
              <select value={scene.motion} onChange={(event) => onChange({ motion: event.target.value })}>
                <option value="zoomIn">推近</option>
                <option value="zoomOut">拉遠</option>
                <option value="panLeft">左移</option>
                <option value="panRight">右移</option>
                <option value="panUp">上移</option>
                <option value="panDown">下移</option>
                <option value="still">靜止</option>
              </select>
            </label>
          )}
          <label>
            轉場
            <select value={scene.transitionEffect} onChange={(event) => onChange({ transitionEffect: event.target.value })}>
              <option value="fade">淡化</option>
              <option value="dipBlack">黑場</option>
              <option value="flashWhite">白閃</option>
              <option value="none">無</option>
            </select>
          </label>
          <label>
            轉場秒數
            <input
              type="number"
              min="0"
              max="1.2"
              step="0.05"
              value={scene.transition}
              onChange={(event) => onChange({ transition: event.target.value })}
            />
          </label>
        </div>
      </div>
      <div className="scene-actions">
        <button className="icon-button" onClick={() => onMove(-1)} disabled={!canMoveUp} aria-label="往上">
          <ArrowUp size={16} />
        </button>
        <button className="icon-button" onClick={() => onMove(1)} disabled={!canMoveDown} aria-label="往下">
          <ArrowDown size={16} />
        </button>
        <button className="icon-button danger" onClick={onRemove} aria-label="移除">
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function roundDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 5;
  return Math.max(0.4, Math.min(30, Math.round(number * 10) / 10));
}

function formatSeconds(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function getOutputSize(aspect, resolution) {
  const sizes = {
    reel: {
      preview: { width: 540, height: 960 },
      standard: { width: 720, height: 1280 },
      full: { width: 1080, height: 1920 }
    },
    square: {
      preview: { width: 720, height: 720 },
      standard: { width: 1080, height: 1080 },
      full: { width: 1440, height: 1440 }
    },
    wide: {
      preview: { width: 960, height: 540 },
      standard: { width: 1280, height: 720 },
      full: { width: 1920, height: 1080 }
    }
  };

  return sizes[aspect]?.[resolution] || sizes.reel.full;
}

createRoot(document.getElementById("root")).render(<App />);
